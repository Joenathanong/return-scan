import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireAdmin, badRequest, notFound, writeAudit,
} from "@/lib/api";
import {
  bersihkanKode, bersihkanNama, pisahBarcode, NAMA_MAKS, type JenisBarcode,
} from "@/lib/produk";

export const runtime = "nodejs";

/**
 * PATCH /api/produk/[sku] — ubah nama, status aktif, atau daftar barcode.
 *
 * SKU sendiri TIDAK bisa diubah. Ia adalah primary key sekaligus nilai yang
 * sudah ter-snapshot di ribuan baris hasil scan; menggantinya akan memutus
 * hubungan antara data lama dan masternya. Kalau kodenya memang salah,
 * nonaktifkan yang lama lalu buat yang baru.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    // Next.js sudah men-decode segmen dinamis. Men-decode sekali lagi akan
    // melempar URIError untuk SKU yang memuat tanda "%", dan diam-diam
    // mengubah nilai untuk yang memuat pola "%xx".
    const { sku: skuMentah } = await params;
    const sku = bersihkanKode(skuMentah);

    const target = await prisma.produk.findUnique({
      where: { sku },
      select: { sku: true, nama: true, active: true },
    });
    if (!target) throw notFound("Produk tidak ditemukan.");

    const body = (await req.json()) as {
      nama?: string; active?: boolean;
      barcodes?: string[]; barcodesBpom?: string[];
    };

    const data: { nama?: string; active?: boolean; updatedBy?: string } = {};

    if (body.nama !== undefined) {
      const nama = bersihkanNama(body.nama);
      if (!nama) throw badRequest("Nama produk wajib diisi.");
      if (nama.length > NAMA_MAKS) throw badRequest("Nama produk terlalu panjang.");
      // Hanya tulis kalau memang berubah — lihat catatan updatedAt di
      // /api/produk/impor. Menulis nilai yang sama akan menggeser updatedAt
      // dan memaksa setiap PDT mengunduh ulang baris ini tanpa alasan.
      if (nama !== target.nama) data.nama = nama;
    }
    if (body.active !== undefined && Boolean(body.active) !== target.active) {
      data.active = Boolean(body.active);
    }

    const jejak: string[] = [];

    if (Object.keys(data).length > 0) {
      data.updatedBy = me.id;
      await prisma.produk.update({ where: { sku }, data });
      if (data.nama) jejak.push(`nama → "${data.nama}"`);
      if (data.active !== undefined) jejak.push(data.active ? "diaktifkan" : "dinonaktifkan");
    }

    // ── Barcode ───────────────────────────────────────────────────────────
    //
    // Barcode yang dilepas TIDAK dihapus, hanya di-`active: false`.
    // Alasannya sama persis dengan alasan produk tidak boleh dihapus:
    // cache di setiap PDT disinkronkan lewat `updatedAt`, dan baris yang
    // hilang dari tabel tidak akan pernah muncul di sinkron delta — PDT
    // akan terus memetakan barcode itu ke SKU lama sampai kapan pun.
    const bentrok: string[] = [];
    const dipindah: string[] = [];

    if (Array.isArray(body.barcodes) || Array.isArray(body.barcodesBpom)) {
      // Kedua daftar diurus bersama-sama, bukan bergiliran. Kalau dipisah,
      // memindahkan satu kode dari kolom Barcode ke kolom Barcode BPOM akan
      // terbaca sebagai "dilepas" oleh putaran pertama lalu "ditambah" oleh
      // putaran kedua — dan di antara keduanya kode itu sempat tidak dimiliki
      // siapa pun.
      const dimintaProduk = pisahBarcode((body.barcodes ?? []).join(","));
      const dimintaBpom = pisahBarcode((body.barcodesBpom ?? []).join(","));

      const tumpang = dimintaProduk.filter((x) => dimintaBpom.includes(x));
      if (tumpang.length > 0) {
        throw badRequest(
          `Kode ${tumpang.join(", ")} diisi di kolom Barcode sekaligus Barcode BPOM. ` +
            "Satu kode fisik hanya punya satu arti — pilih salah satu."
        );
      }

      const jenisDiminta = new Map<string, JenisBarcode>([
        ...dimintaProduk.map((b) => [b, "PRODUK" as JenisBarcode] as const),
        ...dimintaBpom.map((b) => [b, "BPOM" as JenisBarcode] as const),
      ]);
      const diminta = [...jenisDiminta.keys()];

      // Semua baris yang menyangkut permintaan ini: yang sekarang milik SKU
      // ini (aktif maupun tidak), plus yang diminta tapi mungkin milik SKU lain.
      const terkait = await prisma.produkBarcode.findMany({
        where:
          diminta.length > 0
            ? { OR: [{ sku }, { barcode: { in: diminta } }] }
            : { sku },
        select: { barcode: true, sku: true, active: true, jenis: true },
      });
      const peta = new Map(terkait.map((b) => [b.barcode, b]));

      let ditambah = 0;

      let jenisDiubah = 0;

      for (const barcode of diminta) {
        const ada = peta.get(barcode);
        const jenis = jenisDiminta.get(barcode) ?? "PRODUK";

        if (!ada) {
          await prisma.produkBarcode.create({ data: { barcode, jenis, sku } });
          ditambah++;
          continue;
        }
        if (ada.sku === sku) {
          if (!ada.active) {
            await prisma.produkBarcode.update({
              where: { barcode },
              data: { active: true, jenis },
            });
            ditambah++;
          } else if (ada.jenis !== jenis) {
            // Kode yang sama dipindahkan antar kolom pada SKU yang sama —
            // koreksi salah tempat, bukan penambahan.
            await prisma.produkBarcode.update({ where: { barcode }, data: { jenis } });
            jenisDiubah++;
          }
          continue;
        }
        if (ada.active) {
          // Masih dipakai SKU lain. TIDAK diambil alih: barcode yang
          // berpindah pemilik diam-diam membuat hasil scan sebelum dan
          // sesudahnya menunjuk produk berbeda tanpa jejak apa pun.
          bentrok.push(barcode);
          continue;
        }
        // Milik SKU lain tapi sudah dilepas — boleh diambil alih, dan
        // perpindahannya dicatat di audit supaya tidak diam-diam.
        await prisma.produkBarcode.update({
          where: { barcode },
          data: { sku, jenis, active: true },
        });
        dipindah.push(`${barcode} (dari ${ada.sku})`);
      }

      const dilepas = terkait
        .filter((b) => b.sku === sku && b.active && !diminta.includes(b.barcode))
        .map((b) => b.barcode);

      if (dilepas.length > 0) {
        await prisma.produkBarcode.updateMany({
          where: { sku, barcode: { in: dilepas } },
          data: { active: false },
        });
      }

      if (ditambah > 0) jejak.push(`+${ditambah} barcode`);
      if (jenisDiubah > 0) jejak.push(`${jenisDiubah} barcode pindah jenis`);
      if (dipindah.length > 0) jejak.push(`pindah: ${dipindah.join(", ")}`);
      if (dilepas.length > 0) jejak.push(`-${dilepas.length} barcode`);
    }

    if (jejak.length === 0 && bentrok.length === 0) {
      return { ok: true, tidakAdaPerubahan: true };
    }

    await writeAudit(me.id, me.name, "PRODUK_UBAH", `${sku}: ${jejak.join(", ") || "—"}`);

    if (bentrok.length > 0) {
      // Bukan error: perubahan lain sudah tersimpan. Klien menampilkannya
      // sebagai peringatan supaya admin tahu persis apa yang tidak masuk.
      return { ok: true, bentrok };
    }
    return { ok: true };
  });
}

/**
 * Produk TIDAK bisa dihapus, hanya dinonaktifkan.
 *
 * Dua alasan. Pertama, hasil scan menyimpan salinan SKU dan namanya, jadi
 * menghapus master tidak mengembalikan ruang apa pun tapi membuat halaman
 * admin tidak bisa lagi menjelaskan kode yang muncul di laporan lama.
 * Kedua — dan ini yang menentukan — cache di setiap PDT disinkronkan
 * berdasarkan `updatedAt`. Baris yang DIHAPUS tidak pernah muncul di
 * sinkron delta, sehingga PDT akan terus memakainya selamanya.
 * `active = false` justru terkirim, dan cache-nya ikut bersih.
 */
export async function DELETE() {
  return handle(async () => {
    await requireAdmin();
    throw badRequest(
      "Produk tidak bisa dihapus, hanya dinonaktifkan — supaya perubahannya " +
        "sampai ke cache PDT dan laporan lama tetap bisa dibaca."
    );
  });
}
