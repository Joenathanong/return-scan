/**
 * Aturan modul Cancel Order — dipakai KLIEN dan SERVER.
 *
 * Modul ini sengaja jauh lebih sederhana daripada Bongkaran, dan itu
 * mencerminkan kenyataannya: barang cancel order tidak punya nomor resi
 * (ia batal sebelum sempat dikirim), tidak perlu dinilai kondisinya, dan
 * tidak dibongkar paket demi paket. Yang dicatat hanya tiga hal — produk,
 * jumlah, batch — persis seperti yang diminta.
 *
 * Yang TIDAK dibawa ke sini dari Bongkaran, dan alasannya:
 *   • Kondisi barang — barangnya belum pernah jalan, jadi tidak ada yang
 *     rusak di perjalanan untuk dinilai.
 *   • Stempel waktu per barang — barangnya sudah lama tergeletak di rak
 *     sebelum didaftar. Mencatat "jam berapa barcode ini ditembak" akan
 *     membuat data terlihat lebih presisi daripada kenyataannya.
 *   • Batch wajib — di sini batch hanya pelengkap pendataan.
 *
 * CATATAN Next.js: file ini TIDAK boleh dipindah ke dalam route.ts.
 */

import { bacaBatch } from "@/lib/bongkaran";

export const QTY_MAKS = 100_000;
export const BARCODE_MAKS = 64;
export const SKU_MAKS = 64;
export const NAMA_MAKS = 191;
export const BATCH_MAKS = 32;
export const CATATAN_MAKS = 255;

/** Batas kewajaran satu sesi input gabungan. */
export const MAKS_ITEM = 300;

export interface ItemCancel {
  barcode?: string | null;
  sku?: string | null;
  namaProduk?: string | null;
  produkTidakDikenal?: boolean;
  qty: number;
  batch?: string | null;
  edDate?: string | null;
  edOtomatis?: boolean;
}

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Memeriksa satu baris. null berarti sah.
 *
 * Kelonggaran yang disengaja: BARCODE BOLEH KOSONG. Barang cancel order
 * sering sudah lepas dari kemasan luarnya waktu didaftar, dan memaksa
 * barcode berarti memaksa operator mengarang atau melewatkan barangnya
 * sama sekali. Yang benar-benar wajib hanyalah nama barang dan jumlah —
 * tanpa keduanya, barisnya tidak berarti apa-apa.
 */
export function periksaItemCancel(item: ItemCancel, nomor: number): string | null {
  const awalan = `Baris ${nomor}`;

  const barcode = String(item.barcode ?? "").trim();
  const sku = String(item.sku ?? "").trim();
  const nama = String(item.namaProduk ?? "").trim();
  const batch = String(item.batch ?? "").trim();
  const edDate = String(item.edDate ?? "").trim();

  if (barcode.length > BARCODE_MAKS) return `${awalan}: barcode terlalu panjang.`;
  if (sku.length > SKU_MAKS) return `${awalan}: kode SKU terlalu panjang.`;

  if (!nama) return `${awalan}: nama barang belum terisi.`;
  if (nama.length > NAMA_MAKS) return `${awalan}: nama barang terlalu panjang.`;

  if (!Number.isInteger(item.qty) || item.qty < 1) {
    return `${awalan}: quantity harus bilangan bulat minimal 1.`;
  }
  if (item.qty > QTY_MAKS) return `${awalan}: quantity ${item.qty} tidak masuk akal.`;

  if (batch.length > BATCH_MAKS) {
    return `${awalan}: batch terlalu panjang (maks. ${BATCH_MAKS} karakter).`;
  }
  if (edDate && !TANGGAL.test(edDate)) return `${awalan}: format Exp. Date tidak valid.`;

  return null;
}

/**
 * Nomor rujukan sesi: "CO-20260908-003".
 *
 * Nomor urut diambil dari jumlah sesi pada tanggal yang sama. Dua orang
 * yang menyimpan pada detik yang sama bisa menghasilkan nomor yang sama —
 * karena itu kolomnya UNIQUE di database dan pemanggilnya mencoba ulang.
 * Nomor urut yang cantik tidak layak dibayar dengan penguncian tabel.
 */
export function kodeSesi(tanggalWIB: string, urutan: number): string {
  return `CO-${tanggalWIB.replace(/-/g, "")}-${String(urutan).padStart(3, "0")}`;
}

/**
 * ED dari batch, kalau batch-nya berpola tanggal (huruf bulan + tahun 2
 * digit, total 6 karakter). Aturannya SATU dengan modul Bongkaran —
 * diimpor, bukan disalin, supaya keduanya tidak pernah berbeda.
 */
export function edDariBatch(batch: string, hariIni?: string) {
  return bacaBatch(batch, hariIni);
}
