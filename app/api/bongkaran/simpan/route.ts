import { NextRequest } from "next/server";
import { prisma, withRetry, isUniqueViolation } from "@/lib/db";
import {
  handle, requireBongkaran, badRequest, notFound, cleanResi, writeAudit,
} from "@/lib/api";
import { todayWIB } from "@/lib/date";
import {
  periksaItem, isKondisi, butuhBarcode, bacaBatch, isKamera, type ItemMasuk,
} from "@/lib/bongkaran";
import { bersihkanKode, bersihkanNama } from "@/lib/produk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas kewajaran, bukan batas teknis: satu resi berisi 200 barang berbeda
 *  hampir pasti berarti operator lupa menekan Simpan sejak tadi. */
const MAKS_ITEM = 200;

/** Selisih waktu barang terhadap resi. 12 jam sudah jauh melewati satu shift. */
const MAKS_OFFSET_MS = 12 * 60 * 60 * 1000;

interface Badan {
  /** Draft dari /api/bongkaran/mulai. */
  bongkaranId?: string;
  /** Jalur luring: dipakai kalau /mulai gagal karena jaringan putus. */
  noResi?: string;
  scannedAtKlien?: string;
  /** Kunci idempoten jalur luring — lihat catatan di schema.prisma. */
  klienKunci?: string;
  /** Nomor kamera CCTV, hanya dipakai di jalur luring. */
  kamera?: number;
  items?: ItemMasuk[];
}

/**
 * POST /api/bongkaran/simpan
 *
 * Dua jalur masuk:
 *
 *   1. NORMAL — { bongkaranId, items }. Draft sudah dibuat saat resi
 *      di-scan, lengkap dengan stempel waktu server. Ini jalur yang dipakai
 *      99% waktu.
 *
 *   2. LURING — { noResi, scannedAtKlien, items }. Dipakai HANYA kalau
 *      /api/bongkaran/mulai gagal karena jaringan putus di gudang. Barisnya
 *      ditandai `waktu_dari_klien = true` dan muncul dengan ikon peringatan
 *      di dashboard. Menandainya penting: jam PDT tidak bisa dipercaya, dan
 *      data yang tidak bisa dipercaya harus terlihat berbeda dari yang bisa,
 *      bukan disamarkan supaya laporannya kelihatan rapi.
 *
 * WAKTU PER BARANG: klien mengirim `offsetMs` — jarak milidetik dari saat
 * resi di-scan. Server menghitung `scannedAt_resi + offsetMs`. Yang datang
 * dari klien hanyalah DURASI, bukan jam dinding, jadi PDT yang jamnya
 * meleset dua jam tetap menghasilkan urutan dan jarak waktu yang benar.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireBongkaran();
    const body = (await req.json()) as Badan;

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw badRequest("Belum ada barang yang diisi.");
    if (items.length > MAKS_ITEM) {
      throw badRequest(`Maksimal ${MAKS_ITEM} barang dalam satu resi.`);
    }

    // ── Validasi SEMUA barang dulu, sebelum menyentuh database ────────────
    // Aturannya sama persis dengan yang dipakai layar scan untuk menyalakan
    // tombol Simpan, jadi sampai di sini seharusnya tidak ada yang gagal.
    // Kalau toh gagal, tidak ada satu pun baris yang terlanjur tertulis.
    items.forEach((it, i) => {
      const salah = periksaItem(it, i + 1);
      if (salah) throw badRequest(salah);
    });

    // ── Tentukan induknya ─────────────────────────────────────────────────
    let induk: { id: string; noResi: string; scannedAt: Date; date: string };

    if (body.bongkaranId) {
      const draft = await prisma.bongkaran.findUnique({
        where: { id: body.bongkaranId },
        select: {
          id: true, noResi: true, scannedAt: true, date: true,
          status: true, scannedById: true,
        },
      });
      if (!draft) throw notFound("Draft bongkaran tidak ditemukan.");
      if (draft.scannedById !== me.id) {
        throw badRequest("Draft ini milik operator lain.");
      }
      if (draft.status !== "draft") {
        throw badRequest(
          draft.status === "final"
            ? "Resi ini sudah pernah disimpan. Scan ulang resinya kalau mau menambah barang."
            : "Draft ini sudah dibatalkan."
        );
      }
      induk = draft;
    } else {
      const noResi = cleanResi(body.noResi);
      if (!noResi) throw badRequest("Nomor resi wajib diisi.");
      if (noResi.length > 64) throw badRequest("Nomor resi terlalu panjang.");

      const jam = new Date(String(body.scannedAtKlien ?? ""));
      if (Number.isNaN(jam.getTime())) {
        throw badRequest("Waktu scan dari perangkat tidak terbaca.");
      }

      const klienKunci = String(body.klienKunci ?? "").trim().slice(0, 64) || null;

      // Jalur luring tidak lewat /mulai, jadi kameranya ikut di sini.
      const kameraLuring = Number(body.kamera);
      if (!isKamera(kameraLuring)) {
        throw badRequest("Nomor kamera belum dipilih. Pilih kamera dulu di layar Bongkaran.");
      }

      // Kiriman ulang setelah balasan hilang di jaringan: kembalikan hasil
      // yang SUDAH tersimpan, jangan buat resi kedua. Tanpa ini, duplikatnya
      // terlihat persis seperti koli kedua yang sah dan tidak ada cara
      // membedakannya kemudian.
      if (klienKunci) {
        const sudah = await prisma.bongkaran.findUnique({
          where: { klienKunci },
          select: {
            id: true, noResi: true, scannedAt: true, date: true,
            _count: { select: { items: true } },
          },
        });
        if (sudah) {
          return {
            ok: true,
            id: sudah.id,
            noResi: sudah.noResi,
            jumlahBarang: sudah._count.items,
            scannedAt: sudah.scannedAt.toISOString(),
            tanggal: sudah.date,
            kiriminUlang: true,
          };
        }
      }

      try {
        induk = await prisma.bongkaran.create({
          data: {
            noResi,
            scannedAt: jam,
            waktuDariKlien: true,
            klienKunci,
            kamera: kameraLuring,
            scannedById: me.id,
            // Tanggal bisnis tetap dihitung SERVER dari jam server, bukan dari
            // jam klien: kalau tidak, PDT yang tanggalnya salah akan
            // menyelipkan data ke hari yang sudah ditutup laporannya.
            date: todayWIB(),
            status: "draft",
          },
          select: { id: true, noResi: true, scannedAt: true, date: true },
        });
      } catch (err) {
        // Dua kiriman berbarengan: yang kalah balapan menemukan barisnya di
        // sini, bukan membuat duplikat.
        if (klienKunci && isUniqueViolation(err)) {
          throw badRequest(
            "Kiriman ini sedang diproses. Tunggu sebentar lalu periksa dashboard " +
              "sebelum menyimpan ulang."
          );
        }
        throw err;
      }
    }

    // ── Bentuk baris item ─────────────────────────────────────────────────
    const dasar = induk.scannedAt.getTime();
    const hariIni = todayWIB();

    const barisItem = items.map((it, i) => {
      const kondisi = it.kondisi;
      if (!isKondisi(kondisi)) throw badRequest(`Barang ${i + 1}: kondisi tidak dikenal.`);

      const perluBarcode = butuhBarcode(kondisi);

      const offset = Number(it.offsetMs);
      const offsetAman =
        Number.isFinite(offset) && offset >= 0 && offset <= MAKS_OFFSET_MS ? offset : 0;

      const batch = bersihkanKode(it.batch) || null;

      // ED dihitung ULANG di server dari batch-nya. Klien sudah melakukan
      // hal yang sama untuk mengisi kolomnya, tapi nilai yang sampai ke
      // database tidak boleh bergantung pada klien mengerjakannya dengan
      // benar. Kalau operator mengubah ED secara manual (edOtomatis false),
      // yang dipakai adalah isian manualnya.
      const terbaca = batch ? bacaBatch(batch, hariIni) : null;
      const edManual = String(it.edDate ?? "").trim() || null;
      const edOtomatis = Boolean(it.edOtomatis) && terbaca !== null;

      return {
        bongkaranId: induk.id,
        urutan: i + 1,
        kondisi,
        barcode: perluBarcode ? bersihkanKode(it.barcode) || null : null,
        sku: perluBarcode ? bersihkanKode(it.sku) || null : null,
        namaProduk: perluBarcode ? bersihkanNama(it.namaProduk) || null : null,
        produkTidakDikenal: perluBarcode ? Boolean(it.produkTidakDikenal) : false,
        namaDiterima: perluBarcode ? null : bersihkanNama(it.namaDiterima) || null,
        qty: it.qty,
        batch,
        mfgDate: terbaca?.mfgDate ?? null,
        edDate: edOtomatis ? terbaca!.edDate : edManual,
        edOtomatis,
        scannedAt: new Date(dasar + offsetAman),
      };
    });

    // ── Tulis ─────────────────────────────────────────────────────────────
    // Satu transaksi: kalau item gagal masuk, status TIDAK berubah jadi
    // final, dan yang tersisa adalah draft kosong yang terlihat di
    // dashboard — bukan resi "selesai" tanpa barang.
    await withRetry(() =>
      prisma.$transaction([
        prisma.bongkaranItem.createMany({ data: barisItem }),
        prisma.bongkaran.update({
          where: { id: induk.id },
          data: { status: "final", finalizedAt: new Date() },
        }),
      ])
    );

    // ── Perkaya saran batch ───────────────────────────────────────────────
    // Sengaja DI LUAR transaksi di atas: ini cache untuk mempercepat
    // pengetikan, bukan data bisnis. Kalau gagal, hasil scan tetap tersimpan
    // dan saran batch cuma kehilangan satu entri.
    //
    // Item ISI_SALAH tidak masuk sini: tanpa SKU, batch-nya tidak bisa
    // dipakai menyarankan apa pun.
    // Dikurangi dulu jadi pasangan unik: satu resi berisi lima botol dari
    // batch yang sama tidak perlu lima perjalanan ke database.
    const pasangan = new Map<string, { sku: string; batch: string; edDate: string }>();
    for (const b of barisItem) {
      if (b.sku && b.batch && b.edDate) {
        pasangan.set(`${b.sku}|${b.batch}`, { sku: b.sku, batch: b.batch, edDate: b.edDate });
      }
    }

    await Promise.all(
      [...pasangan.values()].map((b) =>
        prisma.batchSku
          .upsert({
            where: { sku_batch: { sku: b.sku, batch: b.batch } },
            create: { sku: b.sku, batch: b.batch, edDate: b.edDate },
            // `edDate` SENGAJA tidak ditimpa. Kalau ditimpa, satu salah ketik
            // ED akan jadi saran yang diterima semua operator sesudahnya —
            // kesalahan satu orang menyebar ke semua orang. ED pertama yang
            // tercatat dipertahankan; kalau memang keliru, admin
            // memperbaikinya lewat data, bukan lewat scan berikutnya.
            update: { dipakai: { increment: 1 } },
          })
          .catch((err: unknown) => {
            console.error("[bongkaran] gagal simpan saran batch:", err);
          })
      )
    );

    await writeAudit(
      me.id, me.name, "BONGKARAN_SIMPAN",
      `${induk.noResi} — ${barisItem.length} barang`,
      { bongkaranId: induk.id, tanggal: induk.date }
    );

    return {
      ok: true,
      id: induk.id,
      noResi: induk.noResi,
      jumlahBarang: barisItem.length,
      scannedAt: induk.scannedAt.toISOString(),
      // Tanggal yang BENAR-BENAR tersimpan di baris, bukan tanggal turunan
      // dari jam scan. Di jalur luring jam itu datang dari PDT, jadi
      // menurunkannya bisa melaporkan tanggal yang tidak dimiliki baris mana
      // pun — persis kebingungan yang kolom `date` ini dibuat untuk cegah.
      tanggal: induk.date,
    };
  });
}
