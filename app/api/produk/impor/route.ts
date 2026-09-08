import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireAdmin, badRequest, writeAudit } from "@/lib/api";
import {
  bersihkanKode, bersihkanNama, pisahBarcode, periksaBaris, PESAN_TOLAK,
  bentrokJenis, type BarisProduk, type JenisBarcode,
} from "@/lib/produk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Satu potong impor. Klien mengirim file-nya sepotong demi sepotong. */
const MAKS_PER_POTONG = 500;

interface Hasil {
  dibuat: number;
  namaDiperbarui: number;
  tidakBerubah: number;
  barcodeBaru: number;
  barcodeDipindah: number;
  /** Kode yang berpindah antara kolom Barcode dan Barcode BPOM. */
  barcodeUbahJenis: number;
  barcodeBentrok: { barcode: string; sku: string; miliknya: string }[];
  ditolak: { sku: string; alasan: string }[];
}

/**
 * POST /api/produk/impor — simpan satu potong hasil pembacaan file Excel.
 *
 * KENAPA FILE-NYA DIBACA DI PERAMBAN, BUKAN DI SINI:
 * file master produk gampang mencapai puluhan ribu baris. Mengirim .xlsx
 * mentah ke fungsi serverless berarti menabrak batas ukuran body dan batas
 * memori Vercel, dan kalau gagal di tengah, admin tidak tahu baris mana
 * yang sudah masuk. Peramban membaca dan memeriksa file lebih dulu,
 * menampilkan pratinjau, lalu mengirim potongan JSON yang sudah bersih.
 * Kalau satu potong gagal, yang perlu diulang hanya potongan itu.
 *
 * KENAPA `updatedAt` DIJAGA MATI-MATIAN:
 * kolom itu satu-satunya dasar sinkron cache PDT. Impor yang menulis ulang
 * seluruh baris — walau isinya sama persis — akan menggeser `updatedAt`
 * semuanya, dan setiap PDT lalu mengunduh ULANG seluruh master pada login
 * berikutnya. Sekali impor rutin bulanan bisa menghabiskan kuota TiDB
 * seharian. Karena itu di bawah ini nama hanya ditulis kalau BERBEDA.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();

    const body = (await req.json()) as { rows?: unknown };
    if (!Array.isArray(body.rows)) throw badRequest("Data impor tidak terbaca.");
    if (body.rows.length === 0) throw badRequest("Potongan impor kosong.");
    if (body.rows.length > MAKS_PER_POTONG) {
      throw badRequest(`Maksimal ${MAKS_PER_POTONG} baris per kiriman.`);
    }

    const hasil: Hasil = {
      dibuat: 0,
      namaDiperbarui: 0,
      tidakBerubah: 0,
      barcodeBaru: 0,
      barcodeDipindah: 0,
      barcodeUbahJenis: 0,
      barcodeBentrok: [],
      ditolak: [],
    };

    // ── Bersihkan & gabungkan baris kembar dalam satu potongan ────────────
    // File master sering menulis satu SKU di beberapa baris, satu baris per
    // barcode. Digabung di sini supaya tidak saling menimpa saat disimpan.
    const perSku = new Map<string, BarisProduk>();

    for (const mentah of body.rows as Record<string, unknown>[]) {
      const kumpulkan = (v: unknown): string[] =>
        Array.isArray(v) ? pisahBarcode((v as unknown[]).join(",")) : pisahBarcode(v);

      const baris: BarisProduk = {
        sku: bersihkanKode(mentah.sku),
        nama: bersihkanNama(mentah.nama),
        barcodes: kumpulkan(mentah.barcodes),
        barcodesBpom: kumpulkan(mentah.barcodesBpom),
      };

      const salah = periksaBaris(baris);
      if (salah) {
        hasil.ditolak.push({ sku: baris.sku || "(kosong)", alasan: PESAN_TOLAK[salah] });
        continue;
      }

      const tumpang = bentrokJenis(baris);
      if (tumpang.length > 0) {
        hasil.ditolak.push({
          sku: baris.sku,
          alasan: `${tumpang.join(", ")} diisi di kolom Barcode sekaligus Barcode BPOM`,
        });
        continue;
      }

      const ada = perSku.get(baris.sku);
      if (ada) {
        for (const b of baris.barcodes) {
          if (!ada.barcodes.includes(b)) ada.barcodes.push(b);
        }
        for (const b of baris.barcodesBpom) {
          if (!ada.barcodesBpom.includes(b)) ada.barcodesBpom.push(b);
        }
        // Nama dari baris pertama yang menang — baris berikutnya untuk SKU
        // yang sama biasanya hanya mengulang, dan kalaupun berbeda, tidak
        // ada dasar untuk memilih yang belakangan.
      } else {
        perSku.set(baris.sku, baris);
      }
    }

    const skuList = [...perSku.keys()];
    if (skuList.length === 0) return { ...hasil, diproses: 0 };

    // ── Produk ────────────────────────────────────────────────────────────
    const sudahAda = await prisma.produk.findMany({
      where: { sku: { in: skuList } },
      select: { sku: true, nama: true, active: true },
    });
    const petaAda = new Map(sudahAda.map((p) => [p.sku, p]));

    const baru = skuList.filter((s) => !petaAda.has(s));
    if (baru.length > 0) {
      // Hitungnya dari `count` yang dikembalikan database, bukan dari
      // panjang daftar yang diminta. Dengan `skipDuplicates`, keduanya bisa
      // berbeda ketika impor lain berjalan bersamaan — dan laporan yang
      // mengklaim lebih banyak daripada yang benar-benar masuk adalah
      // laporan yang menyesatkan.
      const { count } = await prisma.produk.createMany({
        data: baru.map((s) => ({
          sku: s,
          nama: perSku.get(s)!.nama,
          updatedBy: me.id,
        })),
        skipDuplicates: true,
      });
      hasil.dibuat = count;
    }

    for (const [sku, p] of petaAda) {
      const namaBaru = perSku.get(sku)!.nama;
      // Impor mengaktifkan kembali SKU yang sebelumnya dinonaktifkan —
      // munculnya lagi di file master adalah pernyataan bahwa ia dipakai.
      const perluAktifkan = !p.active;
      const perluNama = namaBaru !== p.nama;

      if (!perluNama && !perluAktifkan) {
        hasil.tidakBerubah++;
        continue;
      }
      await prisma.produk.update({
        where: { sku },
        data: {
          ...(perluNama ? { nama: namaBaru } : {}),
          ...(perluAktifkan ? { active: true } : {}),
          updatedBy: me.id,
        },
      });
      if (perluNama) hasil.namaDiperbarui++;
    }

    // ── Barcode ───────────────────────────────────────────────────────────
    // Barcode dagang dan barcode BPOM diproses BERSAMA dalam satu jalur.
    // Keduanya menghuni tabel yang sama dan bersaing memperebutkan kode yang
    // sama; memisahkannya jadi dua putaran berarti bentrok antar-jenis di
    // dalam satu berkas tidak akan pernah terlihat.
    const semuaBarcode = [...perSku.values()].flatMap((b) => [
      ...b.barcodes, ...b.barcodesBpom,
    ]);
    if (semuaBarcode.length > 0) {
      const barcodeAda = await prisma.produkBarcode.findMany({
        where: { barcode: { in: semuaBarcode } },
        select: { barcode: true, sku: true, active: true, jenis: true },
      });
      const petaBarcode = new Map(barcodeAda.map((b) => [b.barcode, b]));

      const tambah: { barcode: string; sku: string; jenis: JenisBarcode }[] = [];
      const ambilAlih: { barcode: string; sku: string; jenis: JenisBarcode }[] = [];
      const ubahJenis: { barcode: string; jenis: JenisBarcode }[] = [];

      /**
       * Siapa yang sudah mengklaim tiap barcode DI DALAM potongan ini.
       *
       * Tanpa peta ini, dua SKU yang mengklaim barcode sama dan sama-sama
       * belum ada di database akan lolos berdua ke `tambah`; `skipDuplicates`
       * lalu menyimpan salah satu tanpa memberi tahu siapa pun, dan admin
       * tidak pernah tahu file masternya bertentangan dengan dirinya sendiri.
       */
      const diklaim = new Map<string, string>();

      for (const [sku, baris] of perSku) {
        const berjenis: { barcode: string; jenis: JenisBarcode }[] = [
          ...baris.barcodes.map((b) => ({ barcode: b, jenis: "PRODUK" as JenisBarcode })),
          ...baris.barcodesBpom.map((b) => ({ barcode: b, jenis: "BPOM" as JenisBarcode })),
        ];

        for (const { barcode, jenis } of berjenis) {
          const pengklaim = diklaim.get(barcode);
          if (pengklaim !== undefined) {
            if (pengklaim !== sku) {
              hasil.barcodeBentrok.push({ barcode, sku, miliknya: pengklaim });
            }
            continue;
          }

          const pemilik = petaBarcode.get(barcode);
          if (pemilik === undefined) {
            tambah.push({ barcode, sku, jenis });
            diklaim.set(barcode, sku);
          } else if (pemilik.sku === sku) {
            // Sudah benar. Kalau sempat dilepas, dipasang kembali; kalau
            // jenisnya berbeda, itu koreksi salah tempat di file master.
            if (!pemilik.active) ambilAlih.push({ barcode, sku, jenis });
            else if (pemilik.jenis !== jenis) ubahJenis.push({ barcode, jenis });
            diklaim.set(barcode, sku);
          } else if (pemilik.active) {
            // Masih dipakai SKU lain. TIDAK dipindahkan otomatis:
            // pemindahan diam-diam membuat hasil scan sebelum dan sesudah
            // impor menunjuk produk berbeda tanpa jejak. Dilaporkan ke
            // admin untuk diputuskan manual.
            hasil.barcodeBentrok.push({ barcode, sku, miliknya: pemilik.sku });
          } else {
            // Pemilik lamanya sudah melepas barcode ini — boleh diambil.
            ambilAlih.push({ barcode, sku, jenis });
            diklaim.set(barcode, sku);
          }
        }
      }

      if (tambah.length > 0) {
        const { count } = await prisma.produkBarcode.createMany({
          data: tambah,
          skipDuplicates: true,
        });
        hasil.barcodeBaru = count;
      }
      for (const { barcode, sku, jenis } of ambilAlih) {
        // Dijaga `active: false` di klausa where: kalau di antara pembacaan
        // dan penulisan ada impor lain yang mengaktifkannya untuk SKU lain,
        // baris ini tidak jadi menimpanya.
        const { count } = await prisma.produkBarcode.updateMany({
          where: { barcode, active: false },
          data: { sku, jenis, active: true },
        });
        if (count > 0) hasil.barcodeDipindah++;
      }
      for (const { barcode, jenis } of ubahJenis) {
        await prisma.produkBarcode.update({ where: { barcode }, data: { jenis } });
        hasil.barcodeUbahJenis++;
      }
    }

    await writeAudit(
      me.id, me.name, "PRODUK_IMPOR",
      `${skuList.length} SKU: ${hasil.dibuat} baru, ${hasil.namaDiperbarui} nama diperbarui, ` +
        `${hasil.barcodeBaru} barcode baru, ${hasil.barcodeDipindah} barcode diambil alih`
    );

    return { ...hasil, diproses: skuList.length };
  });
}
