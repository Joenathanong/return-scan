import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireMasterProduk } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Jumlah baris per jenis per panggilan. Bukan batas jumlah data — klien
 * memanggil berulang selama `lagi: true`. Angkanya dipilih supaya satu
 * balasan tetap kecil di jaringan gudang yang lemah.
 */
const PER_HALAMAN = 1000;

/**
 * Bentuk baris yang dikembalikan tiap kueri, ditulis eksplisit.
 *
 * Perlu ditulis karena jenis yang dilewati diganti array kosong: tanpa tipe
 * eksplisit, TypeScript menyimpulkan `never[] | Baris[]`, dan `.map()` pada
 * gabungan dua tipe array seperti itu tidak bisa dipanggil.
 */
interface BarisProduk { sku: string; nama: string; active: boolean; updatedAt: Date }
interface BarisBarcode {
  barcode: string; sku: string; jenis: string; active: boolean; updatedAt: Date;
}
interface BarisBatch {
  id: string; sku: string; batch: string; edDate: string;
  dipakai: number; updatedAt: Date;
}

/**
 * GET /api/bongkaran/sync?produkWaktu=&produkKunci=&barcodeWaktu=&barcodeKunci=
 *                          &batchWaktu=&batchKunci=
 *
 * Inilah yang membuat modul ini murah. PDT menyimpan Master Produk, daftar
 * barcode, dan riwayat batch di IndexedDB; selama scan berlangsung, lookup
 * barcode dan saran batch TIDAK menyentuh TiDB sama sekali. Endpoint ini
 * hanya dipanggil saat login dan hanya mengirim baris yang BERUBAH sejak
 * sinkron terakhir — hari pertama seluruh master sekali, hari-hari
 * berikutnya biasanya nol baris.
 *
 * KENAPA KURSORNYA GABUNGAN (updatedAt + kunci), BUKAN updatedAt SAJA:
 * impor massal menulis ribuan baris dengan `updated_at` yang sama persis
 * sampai milidetik. Kursor yang hanya `updatedAt > sejak` akan melompati
 * sisa baris yang bertimestamp sama begitu halaman terpotong di tengahnya —
 * dan barang yang hilang dari cache tidak akan pernah muncul lagi di
 * sinkron berikutnya, karena timestamp-nya sudah terlewat. Bug seperti itu
 * tidak menimbulkan error apa pun: barcode tertentu cuma "tidak dikenal"
 * selamanya di sebagian PDT.
 *
 * Baris nonaktif IKUT dikirim (dengan active: false) supaya cache PDT bisa
 * membuangnya. Baris yang dihapus tidak akan pernah muncul di sini — itulah
 * sebabnya produk dan barcode tidak pernah dihapus, hanya dinonaktifkan.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireMasterProduk();

    const url = new URL(req.url);

    /**
     * Kursor DIPISAH per jenis, bukan satu `sejak` untuk ketiganya.
     *
     * Ketiga daftar habis pada waktu yang berbeda: produk bisa masih
     * bersisa tiga halaman lagi ketika barcode sudah selesai. Kalau
     * kursornya dipakai bersama, panggilan berikutnya akan menarik ulang
     * jenis yang sudah tuntas — atau, lebih buruk, melompati sisanya.
     */
    const ambilKursor = (awalan: string) => {
      const w = url.searchParams.get(`${awalan}Waktu`);
      const t = w ? new Date(w) : null;
      return {
        waktu: t && !Number.isNaN(t.getTime()) ? t : null,
        kunci: url.searchParams.get(`${awalan}Kunci`) || "",
      };
    };

    const kProduk = ambilKursor("produk");
    const kBarcode = ambilKursor("barcode");
    const kBatch = ambilKursor("batch");

    /**
     * Jenis yang sudah tuntas di putaran sebelumnya dilewati sama sekali.
     *
     * Klien menandainya karena ia yang tahu; server tidak. Tanpa ini, tabel
     * yang masih kosong (mis. batch di hari pertama) tetap dipindai penuh
     * pada setiap putaran selagi master produk yang besar diunduh bertahap.
     */
    const lewati = {
      produk: url.searchParams.get("lewatiProduk") === "1",
      barcode: url.searchParams.get("lewatiBarcode") === "1",
      batch: url.searchParams.get("lewatiBatch") === "1",
    };

    /**
     * Klausa "setelah kursor" untuk (updatedAt, kunci).
     * Tanpa waktu → ambil semuanya (sinkron pertama).
     */
    const setelah = (
      kolomKunci: "sku" | "barcode" | "id",
      kursor: { waktu: Date | null; kunci: string }
    ) => {
      if (!kursor.waktu) return {};
      if (!kursor.kunci) return { updatedAt: { gt: kursor.waktu } };
      return {
        OR: [
          { updatedAt: { gt: kursor.waktu } },
          { updatedAt: kursor.waktu, [kolomKunci]: { gt: kursor.kunci } },
        ],
      };
    };

    const [produk, barcode, batch] = await Promise.all([
      lewati.produk
        ? Promise.resolve<BarisProduk[]>([])
        : prisma.produk.findMany({
            where: setelah("sku", kProduk),
            select: { sku: true, nama: true, active: true, updatedAt: true },
            orderBy: [{ updatedAt: "asc" }, { sku: "asc" }],
            take: PER_HALAMAN,
          }),
      lewati.barcode
        ? Promise.resolve<BarisBarcode[]>([])
        : prisma.produkBarcode.findMany({
            where: setelah("barcode", kBarcode),
            select: { barcode: true, sku: true, jenis: true, active: true, updatedAt: true },
            orderBy: [{ updatedAt: "asc" }, { barcode: "asc" }],
            take: PER_HALAMAN,
          }),
      lewati.batch
        ? Promise.resolve<BarisBatch[]>([])
        : prisma.batchSku.findMany({
            where: setelah("id", kBatch),
            select: {
              id: true, sku: true, batch: true, edDate: true,
              dipakai: true, updatedAt: true,
            },
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take: PER_HALAMAN,
          }),
    ]);

    // `.at(-1)` butuh lib ES2022; indeks biasa aman di semua target.
    const akhirProduk = produk[produk.length - 1];
    const akhirBarcode = barcode[barcode.length - 1];
    const akhirBatch = batch[batch.length - 1];

    return {
      penuh: !kProduk.waktu && !kBarcode.waktu && !kBatch.waktu,
      produk: produk.map((p) => ({
        sku: p.sku,
        nama: p.nama,
        active: p.active,
        updatedAt: p.updatedAt.toISOString(),
      })),
      barcode: barcode.map((b) => ({
        barcode: b.barcode,
        sku: b.sku,
        // Jenisnya ikut dikirim BUKAN untuk pencarian — pencarian sengaja
        // tidak membedakannya — melainkan supaya layar scan bisa memberi
        // tahu operator bahwa yang barusan terbaca adalah nomor izin edar,
        // bukan barcode dagangnya. Tanpa itu, operator yang tidak sengaja
        // menembak label BPOM mengira ia sudah men-scan barang yang benar.
        jenis: b.jenis,
        active: b.active,
        updatedAt: b.updatedAt.toISOString(),
      })),
      batch: batch.map((b) => ({
        id: b.id,
        sku: b.sku,
        batch: b.batch,
        edDate: b.edDate,
        dipakai: b.dipakai,
        updatedAt: b.updatedAt.toISOString(),
      })),
      // Kursor untuk panggilan berikutnya, per jenis. Klien mengulang
      // selama salah satu `lagi` masih true.
      kursor: {
        produk: akhirProduk
          ? { waktu: akhirProduk.updatedAt.toISOString(), kunci: akhirProduk.sku }
          : null,
        barcode: akhirBarcode
          ? { waktu: akhirBarcode.updatedAt.toISOString(), kunci: akhirBarcode.barcode }
          : null,
        batch: akhirBatch
          ? { waktu: akhirBatch.updatedAt.toISOString(), kunci: akhirBatch.id }
          : null,
      },
      lagi: {
        produk: produk.length === PER_HALAMAN,
        barcode: barcode.length === PER_HALAMAN,
        batch: batch.length === PER_HALAMAN,
      },
    };
  });
}
