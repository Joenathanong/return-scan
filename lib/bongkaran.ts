/**
 * Aturan modul Bongkaran — dipakai KLIEN dan SERVER.
 *
 * Semua yang menentukan sah-tidaknya sebuah item ada di sini, satu kali.
 * Kalau aturan ini disalin ke halaman scan dan ke API secara terpisah,
 * cepat atau lambat keduanya akan berbeda, dan bedanya baru ketahuan
 * setelah ada data yang lolos ke database dalam keadaan setengah terisi.
 *
 * CATATAN Next.js: file ini TIDAK boleh dipindah ke dalam route.ts.
 * App Router hanya mengizinkan handler HTTP dan beberapa konstanta khusus
 * diekspor dari route.ts.
 */

// ─── Kondisi ─────────────────────────────────────────────────────────────────

export const KONDISI = [
  "BAGUS",
  "RUSAK_KEMASAN",
  "RUSAK_TOTAL",
  "ISI_SALAH",
] as const;

export type Kondisi = (typeof KONDISI)[number];

export const LABEL_KONDISI: Record<Kondisi, string> = {
  BAGUS: "Bagus",
  RUSAK_KEMASAN: "Rusak Kemasan",
  RUSAK_TOTAL: "Rusak Total",
  ISI_SALAH: "Isi Salah",
};

export function isKondisi(v: unknown): v is Kondisi {
  return typeof v === "string" && (KONDISI as readonly string[]).includes(v);
}

/**
 * Hanya ISI_SALAH yang boleh disimpan tanpa barcode.
 *
 * RUSAK_TOTAL sengaja TIDAK termasuk, sesuai keputusan operasional: kalau
 * barcode di kemasan sobek, operator mencari barcode lain di kardus atau di
 * badan produk. Kalau di lapangan ini sering menyangkut, gejalanya akan
 * terlihat sebagai lonjakan ISI_SALAH di dashboard — operator mencari jalan
 * pintas — dan saat itulah aturan ini perlu ditinjau ulang, bukan sebelumnya.
 */
export function butuhBarcode(kondisi: Kondisi): boolean {
  return kondisi !== "ISI_SALAH";
}

// ─── Kamera ──────────────────────────────────────────────────────────────────

/**
 * Kamera CCTV yang mengawasi meja bongkar.
 *
 * Angkanya tetap 1–4 dan sengaja ditulis di sini, bukan diambil dari tabel
 * pengaturan: jumlah kamera di ruang bongkar adalah fakta fisik yang jarang
 * berubah, dan tabel pengaturan hanya akan menambah satu kueri di jalur
 * yang dilewati setiap operator setiap hari. Kalau kameranya bertambah,
 * ubah satu baris ini.
 */
export const KAMERA = [1, 2, 3, 4] as const;
export type NomorKamera = (typeof KAMERA)[number];

export function isKamera(v: unknown): v is NomorKamera {
  return typeof v === "number" && (KAMERA as readonly number[]).includes(v);
}

/** Label yang dipakai di layar dan di ekspor. */
export function labelKamera(v: number | null | undefined): string {
  return isKamera(v) ? `Kamera ${v}` : "";
}

// ─── Resi yang rusak / tidak terbaca ─────────────────────────────────────────

/**
 * Awalan nomor pengganti untuk paket yang label resinya sobek/tidak terbaca.
 *
 * INI SEKALIGUS PENANDANYA. Tidak ada kolom boolean terpisah di database:
 * awalan ini hanya boleh dibuat SERVER (lihat penolakan di /api/bongkaran/
 * mulai dan /simpan kalau nomor berawalan ini datang dari ketikan operator),
 * jadi kehadirannya di kolom `no_resi` adalah pernyataan yang bisa dipercaya
 * — dan indeks `no_resi` yang sudah ada melayani pencarian awalan tanpa
 * tambahan apa pun.
 */
export const AWALAN_TANPA_RESI = "TANPA-RESI-";

/** Panjang maksimum catatan, sejalan dengan VarChar(191) di skema. */
export const CATATAN_MAKS = 191;

const fmtTanggalNomor = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric", month: "2-digit", day: "2-digit",
});

const fmtJamNomor = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  // h23, bukan hour12:false — sebagian ICU menuliskan tengah malam sebagai
  // "24:00:00" dengan hour12:false, dan nomor yang tanggalnya hari ini tapi
  // jamnya 24 adalah nomor yang tidak pernah bisa dijelaskan.
  hourCycle: "h23",
});

/**
 * Nomor pengganti: TANPA-RESI-20260909-K2-142335
 *                              tanggal  kamera jam WIB
 *
 * Kenapa jam+kamera, bukan urutan harian 001/002:
 *
 *   • NOL kueri. Penomoran urut butuh `max()` per penekanan tombol, dan
 *     jalur ini justru dirancang lebih murah daripada scan biasa — dua
 *     kueri pencocokan (duplikat + Scan Retur) memang dilewati, karena
 *     tidak ada nomor yang bisa dicocokkan.
 *   • Tidak bisa kembar tanpa perlu indeks unik. Kolom `no_resi` sengaja
 *     tidak unik (satu resi boleh datang dalam dua koli), jadi penomoran
 *     urut tidak punya penjaga apa pun: dua operator yang menekan tombol
 *     pada detik yang sama akan mendapat angka yang sama dan tidak ada
 *     yang memberi tahu. Di sini kamera dan detik yang membedakan.
 *   • Nomornya sendiri sudah menunjuk rekamannya: tanggal, kamera, jam —
 *     persis tiga hal yang dibutuhkan untuk membuka CCTV yang benar.
 *     Untuk baris tanpa resi, ini satu-satunya jalan menelusuri asalnya.
 */
export function nomorTanpaResi(kamera: number, saat: Date): string {
  const tanggal = fmtTanggalNomor.format(saat).replace(/-/g, "");
  const jam = fmtJamNomor.format(saat).replace(/[^0-9]/g, "");
  return `${AWALAN_TANPA_RESI}${tanggal}-K${kamera}-${jam}`;
}

/** Apakah baris ini dibongkar tanpa nomor resi yang terbaca? */
export function tanpaResi(noResi: string | null | undefined): boolean {
  return String(noResi ?? "").startsWith(AWALAN_TANPA_RESI);
}

// ─── Batch → tanggal produksi → ED ───────────────────────────────────────────

/** Umur simpan tetap: 3 tahun, selalu jatuh di tanggal 1. */
export const UMUR_SIMPAN_TAHUN = 3;

const PANJANG_BATCH_TANGGAL = 6;
const POLA_BATCH_TANGGAL = /^([A-L])(\d{2})/;

export interface BacaBatch {
  /** "YYYY-MM-01" */
  mfgDate: string;
  /** "YYYY-MM-01", tepat 3 tahun setelah mfgDate */
  edDate: string;
  /** Terisi kalau hasilnya masuk akal secara aturan tapi ganjil secara waktu. */
  peringatan?: string;
}

const dua = (n: number) => String(n).padStart(2, "0");

/**
 * Membaca batch sebagai tanggal produksi.
 *
 * Polanya: panjang TEPAT 6 karakter, karakter 1 huruf A–L (A = Januari),
 * karakter 2–3 angka tahun (26 = 2026). Karakter 4–6 bebas — biasanya nomor
 * urut pabrik dan tidak dipakai.
 *
 *     "B26ABC" → MFG 1 Februari 2026 → ED 1 Februari 2029
 *
 * Mengembalikan null kalau batch tidak berpola. Di luar pola ini, ED WAJIB
 * diisi manual — kecuali untuk ISI_SALAH, yang memang tidak punya SKU
 * sehingga batch dan ED-nya opsional.
 *
 * KENAPA HASIL GANJIL TIDAK DITOLAK: tahun dua digit tidak bisa dibedakan
 * antara 2026 dan, katakanlah, salah ketik. Menolaknya berarti menghentikan
 * antrean bongkaran demi tebakan kita sendiri. Yang dilakukan di sini:
 * tetap mengisi ED, tapi menandai `peringatan` supaya layar bisa memberi
 * tanda kuning dan operator memutuskan sendiri.
 */
export function bacaBatch(batch: unknown, hariIni?: string): BacaBatch | null {
  const b = String(batch ?? "").trim().toUpperCase();
  if (b.length !== PANJANG_BATCH_TANGGAL) return null;

  const m = POLA_BATCH_TANGGAL.exec(b);
  if (!m) return null;

  const bulan = m[1].charCodeAt(0) - 64; // "A" (65) → 1
  const tahun = 2000 + Number(m[2]);

  const mfgDate = `${tahun}-${dua(bulan)}-01`;
  const edDate = `${tahun + UMUR_SIMPAN_TAHUN}-${dua(bulan)}-01`;

  const hasil: BacaBatch = { mfgDate, edDate };

  // Kewajaran: tanggal produksi tidak masuk akal kalau jauh di masa depan
  // atau terlalu jauh di masa lalu.
  if (hariIni && /^\d{4}-\d{2}-\d{2}$/.test(hariIni)) {
    const [ty, tm] = hariIni.split("-").map(Number);
    const selisihBulan = (tahun - ty) * 12 + (bulan - tm);
    if (selisihBulan > 12) {
      hasil.peringatan = "Tanggal produksi lebih dari setahun di masa depan — periksa lagi batch-nya.";
    } else if (selisihBulan < -120) {
      hasil.peringatan = "Tanggal produksi lebih dari 10 tahun lalu — periksa lagi batch-nya.";
    }
  }

  return hasil;
}

// ─── Item ────────────────────────────────────────────────────────────────────

/** Bentuk item yang dikirim klien ke /api/bongkaran/simpan. */
export interface ItemMasuk {
  kondisi: string;
  barcode?: string | null;
  sku?: string | null;
  namaProduk?: string | null;
  produkTidakDikenal?: boolean;
  namaDiterima?: string | null;
  qty: number;
  batch?: string | null;
  mfgDate?: string | null;
  edDate?: string | null;
  edOtomatis?: boolean;
  /** Milidetik sejak resi di-scan. Lihat catatan waktu di /api/bongkaran/simpan. */
  offsetMs?: number;
}

export const QTY_MAKS = 100_000;

/**
 * Batas panjang, SAMA PERSIS dengan kolom di schema.prisma.
 *
 * Tanpa pemeriksaan ini, batch atau nama yang kelewat panjang lolos dari
 * layar, lolos dari server, lalu mati di dalam `createMany` sebagai error
 * MySQL "Data too long" — yang tidak dikenali handle(), sehingga operator
 * hanya melihat "Terjadi kesalahan di server", kehilangan seluruh isi
 * keranjangnya, dan meninggalkan draft kosong di dashboard.
 */
export const BARCODE_MAKS = 64;
export const SKU_MAKS = 64;
export const NAMA_MAKS = 191;
export const BATCH_MAKS = 32;

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Memeriksa satu item. Mengembalikan null kalau sah, atau kalimat yang bisa
 * ditampilkan apa adanya ke operator.
 *
 * Aturan yang ditegakkan di sini adalah SATU-SATUNYA yang menentukan; layar
 * scan memakai fungsi yang sama untuk menyalakan/mematikan tombol Simpan,
 * jadi tidak mungkin ada item yang lolos di layar tapi ditolak server.
 */
export function periksaItem(item: ItemMasuk, nomor: number): string | null {
  const awalan = `Barang ${nomor}`;

  if (!isKondisi(item.kondisi)) return `${awalan}: kondisi belum dipilih.`;
  const kondisi = item.kondisi;

  const barcode = String(item.barcode ?? "").trim();
  const sku = String(item.sku ?? "").trim();
  const namaDiterima = String(item.namaDiterima ?? "").trim();

  const namaProduk = String(item.namaProduk ?? "").trim();

  if (butuhBarcode(kondisi)) {
    if (!barcode) return `${awalan}: barcode wajib di-scan untuk kondisi ${LABEL_KONDISI[kondisi]}.`;
    if (barcode.length > BARCODE_MAKS) return `${awalan}: barcode terlalu panjang.`;
    // Barcode tak dikenal tetap boleh — yang penting barcode-nya TERCATAT.
    // Yang tidak boleh: barcode dikenal tapi SKU-nya kosong, karena itu
    // berarti ada yang salah di jalur lookup, bukan di lapangan.
    if (!item.produkTidakDikenal && !sku) {
      return `${awalan}: produk belum dikenali. Ulangi scan barcode-nya.`;
    }
    if (sku.length > SKU_MAKS) return `${awalan}: kode SKU terlalu panjang.`;
    // Nama SELALU wajib, bukan hanya saat barcode tak dikenal: kalau master
    // baru tersinkron separuh, barcode bisa ketemu sementara baris produknya
    // belum sampai, dan baris tanpa nama tidak berguna di laporan mana pun.
    if (!namaProduk) {
      return item.produkTidakDikenal
        ? `${awalan}: barcode belum terdaftar, jadi nama barang wajib diketik manual.`
        : `${awalan}: nama produk belum terisi. Ketik manual atau sinkronkan ulang data produk.`;
    }
    if (namaProduk.length > NAMA_MAKS) return `${awalan}: nama produk terlalu panjang.`;
    if (namaDiterima) {
      return `${awalan}: nama barang diterima hanya untuk kondisi Isi Salah.`;
    }
  } else {
    if (barcode || sku) {
      return `${awalan}: kondisi Isi Salah tidak memakai barcode.`;
    }
    if (!namaDiterima) {
      return `${awalan}: isi nama barang yang benar-benar diterima.`;
    }
    if (namaDiterima.length > NAMA_MAKS) {
      return `${awalan}: nama barang diterima terlalu panjang (maks. ${NAMA_MAKS} karakter).`;
    }
  }

  if (!Number.isInteger(item.qty) || item.qty < 1) {
    return `${awalan}: quantity harus bilangan bulat minimal 1.`;
  }
  if (item.qty > QTY_MAKS) {
    return `${awalan}: quantity ${item.qty} tidak masuk akal.`;
  }

  const batch = String(item.batch ?? "").trim();
  const edDate = String(item.edDate ?? "").trim();

  if (batch.length > BATCH_MAKS) {
    return `${awalan}: batch terlalu panjang (maks. ${BATCH_MAKS} karakter).`;
  }

  if (butuhBarcode(kondisi)) {
    // Batch dan ED wajib untuk semua kondisi yang punya SKU.
    if (!batch) return `${awalan}: batch wajib diisi.`;
    if (!edDate) {
      return `${awalan}: batch tidak berpola tanggal, jadi Exp. Date wajib diisi manual.`;
    }
  }
  // ISI_SALAH: batch dan ED opsional. Barcode-nya saja tidak ada; memaksa
  // batch berarti memaksa operator mengarang, dan batch tanpa SKU tidak bisa
  // dipakai menyarankan apa pun nanti.

  if (edDate && !TANGGAL.test(edDate)) return `${awalan}: format Exp. Date tidak valid.`;
  if (item.mfgDate && !TANGGAL.test(String(item.mfgDate))) {
    return `${awalan}: format tanggal produksi tidak valid.`;
  }

  return null;
}
