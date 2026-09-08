import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, badRequest } from "@/lib/api";
import { isValidDate, todayWIB } from "@/lib/date";
import { LABEL_KONDISI, isKondisi } from "@/lib/bongkaran";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batas baris per pengambilan. Bukan batas laporan — klien mengulang selama
 * `lagi: true`. Angkanya menjaga satu balasan tetap di bawah batas memori
 * fungsi serverless untuk rentang tanggal yang lebar.
 */
const PER_HALAMAN = 2000;

/**
 * GET /api/bongkaran/export?dari=YYYY-MM-DD&sampai=YYYY-MM-DD&kursor=
 *
 * SATU BARIS PER BARANG, nomor resi DIULANG di tiap baris — bukan sel yang
 * digabung. Merge cell terlihat lebih rapi di layar tapi merusak filter,
 * sort, dan pivot di Excel, yang justru alasan orang meminta ekspor.
 *
 * Baris `voided` tidak ikut. Draft juga tidak: ia belum punya barang.
 *
 * Berkas .xlsx-nya dirakit di peramban (halaman /bongkaran/export), bukan
 * di sini. Fungsi serverless yang merakit spreadsheet puluhan ribu baris
 * akan menyentuh batas memori dan waktu Vercel; peramban punya keduanya
 * berlimpah dan sudah memuat pustaka xlsx untuk halaman Data & Export.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireBongkaran();

    const url = new URL(req.url);
    const dari = url.searchParams.get("dari") || todayWIB();
    const sampai = url.searchParams.get("sampai") || todayWIB();

    if (!isValidDate(dari) || !isValidDate(sampai)) {
      throw badRequest("Rentang tanggal tidak valid.");
    }
    if (dari > sampai) {
      throw badRequest("Tanggal awal melewati tanggal akhir.");
    }

    // Kursor berbasis id item: stabil, tidak terpengaruh baris baru yang
    // masuk di tengah pengambilan, dan tidak bisa melompat seperti kursor
    // berbasis nomor halaman.
    const kursor = url.searchParams.get("kursor") || "";

    const rows = await prisma.bongkaranItem.findMany({
      where: {
        bongkaran: { date: { gte: dari, lte: sampai }, status: "final" },
        ...(kursor ? { id: { gt: kursor } } : {}),
      },
      select: {
        id: true,
        urutan: true,
        kondisi: true,
        barcode: true,
        sku: true,
        namaProduk: true,
        namaDiterima: true,
        produkTidakDikenal: true,
        qty: true,
        batch: true,
        edDate: true,
        edOtomatis: true,
        scannedAt: true,
        bongkaran: {
          select: {
            noResi: true,
            date: true,
            scannedAt: true,
            kamera: true,
            scannedBy: { select: { name: true } },
            // Jumlah barang dalam resi yang sama, dihitung database.
            // Dipakai membentuk penomoran "1 of 2" di kolom Line.
            _count: { select: { items: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: PER_HALAMAN,
    });

    // ── Nama ekspedisi, dicocokkan dari Scan Retur ────────────────────────
    //
    // Modul bongkaran sengaja TIDAK menyimpan ekspedisi sendiri: yang tahu
    // paket ini datang dari siapa adalah Scan Retur, dan menyalin nilainya
    // ke tabel bongkaran berarti punya dua sumber kebenaran yang akan
    // berbeda begitu ekspedisi sebuah resi diralat di Scan Retur.
    //
    // Pencocokannya lewat nomor resi. Tabel scans punya UNIQUE pada
    // `no_resi_unik` untuk baris berstatus `success`, jadi satu resi hanya
    // punya SATU baris sukses — pencocokan ini tidak bisa menggandakan
    // baris ekspor.
    //
    // Dilakukan per halaman ekspor, BUKAN sebagai relasi Prisma: tidak ada
    // foreign key antara bongkaran dan scans (dan memang tidak boleh ada —
    // bongkar sah terjadi sebelum resinya tercatat di Scan Retur). Satu
    // kueri tambahan per halaman, bukan satu per baris.
    const daftarResi = [...new Set(rows.map((r) => r.bongkaran.noResi))];
    const petaExpedisi = new Map<string, string>();

    // Dipotong-potong: satu klausa IN dengan 2.000 nilai membuat perencana
    // kueri TiDB bekerja jauh lebih berat daripada empat klausa berisi 500.
    const POTONG = 500;
    for (let i = 0; i < daftarResi.length; i += POTONG) {
      const bagian = daftarResi.slice(i, i + POTONG);
      const cocok = await prisma.scan.findMany({
        where: { noResi: { in: bagian }, status: "success" },
        select: { noResi: true, expedisi: { select: { name: true } } },
      });
      for (const c of cocok) petaExpedisi.set(c.noResi, c.expedisi.name);
    }

    return {
      dari,
      sampai,
      lagi: rows.length === PER_HALAMAN,
      kursor: rows.length > 0 ? rows[rows.length - 1].id : null,
      rows: rows.map((r) => ({
        // Id baris ikut dikirim supaya layar bisa menyunting baris yang
        // ganjil di tempat, tanpa perlu memuat ulang seluruh laporan.
        id: r.id,
        noResi: r.bongkaran.noResi,
        // Posisi barang di dalam resinya: urutan ke-berapa dari berapa.
        // Dikirim sebagai dua angka, bukan sebagai teks "1 of 2" — bentuk
        // tulisannya urusan layar, dan angka mentah tetap bisa difilter
        // maupun diurutkan kalau kelak dibutuhkan.
        urutan: r.urutan,
        totalBaris: r.bongkaran._count.items,
        barcode: r.barcode ?? "",
        sku: r.sku ?? "",
        // Untuk barcode yang belum terdaftar, nama yang diketik operator
        // yang dipakai — kolomnya tidak dibiarkan kosong hanya karena
        // masternya belum lengkap.
        namaSku: r.namaProduk ?? "",
        qty: r.qty,
        kondisi: isKondisi(r.kondisi) ? LABEL_KONDISI[r.kondisi] : r.kondisi,
        // Kode mentahnya ikut, karena dialog sunting butuh nilai yang bisa
        // dikirim balik ke server — bukan labelnya.
        kondisiKode: r.kondisi,
        edOtomatis: r.edOtomatis,
        namaDiterima: r.namaDiterima ?? "",
        batch: r.batch ?? "",
        edDate: r.edDate ?? "",
        scanBy: r.bongkaran.scannedBy.name,
        // Waktu BARANG, bukan waktu resi: dua barang dalam satu resi
        // di-scan pada detik yang berbeda, dan bedanya itu yang menunjukkan
        // berapa lama satu paket benar-benar dibongkar.
        scanDate: r.scannedAt.toISOString(),
        tanggal: r.bongkaran.date,
        produkTidakDikenal: r.produkTidakDikenal,
        // Kamera + Scan Date adalah pasangan: yang satu menjawab "kamera
        // mana", yang lain "jam berapa". Keduanya diperlukan untuk membuka
        // rekaman yang benar saat sebuah baris dipertanyakan.
        kamera: r.bongkaran.kamera,
        // Kosong berarti resi ini belum ada di Scan Retur — keadaan yang
        // memang sah (bongkar boleh mendahului scan retur), bukan kesalahan.
        expedisi: petaExpedisi.get(r.bongkaran.noResi) ?? "",
      })),
    };
  });
}
