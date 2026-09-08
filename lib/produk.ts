/**
 * Aturan bersama Master Produk — dipakai KLIEN (saat membaca file Excel)
 * dan SERVER (saat menyimpan). Sengaja satu berkas: kalau normalisasi di
 * kedua sisi berbeda sedikit saja, barcode yang tampil "sudah ada" di
 * pratinjau bisa tersimpan sebagai baris baru di database.
 *
 * CATATAN Next.js: file ini TIDAK boleh dipindah ke dalam route.ts.
 * App Router hanya mengizinkan handler HTTP dan beberapa konstanta khusus
 * yang diekspor dari route.ts; ekspor lain menggagalkan build — persis
 * kesalahan yang pernah terjadi pada `saranKode` di /api/expedisi.
 */

/** Batas panjang, sejalan dengan skema Prisma. */
export const SKU_MAKS = 64;
export const BARCODE_MAKS = 64;
export const NAMA_MAKS = 191;

/**
 * SKU dan barcode dinaikkan jadi huruf besar dan dibuang spasinya.
 *
 * Kenapa spasi DI TENGAH ikut dibuang, bukan hanya di ujung: scanner
 * kadang menyisipkan spasi saat membaca barcode yang tercetak buram, dan
 * Excel hasil ekspor sistem lain sering membawa non-breaking space (U+00A0)
 * yang tidak terlihat mata tapi membuat dua nilai identik jadi berbeda.
 * `\s` di JavaScript sudah mencakup U+00A0, jadi satu regex ini menangani
 * keduanya sekaligus — tidak perlu penanganan terpisah.
 */
export function bersihkanKode(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").toUpperCase();
}

export function bersihkanNama(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Satu sel bisa memuat beberapa barcode. Pemisah yang diterima: koma,
 * titik koma, garis miring, dan baris baru — empat gaya yang benar-benar
 * muncul di file master yang ditulis tangan.
 */
export function pisahBarcode(v: unknown): string[] {
  const mentah = String(v ?? "").split(/[,;/\n\r]+/);
  const hasil: string[] = [];
  for (const b of mentah) {
    const bersih = bersihkanKode(b);
    if (bersih && !hasil.includes(bersih)) hasil.push(bersih);
  }
  return hasil;
}

/**
 * Jenis barcode yang menempel pada satu produk.
 *
 * PRODUK — barcode dagang biasa (EAN/UPC) di kemasan.
 * BPOM   — barcode nomor izin edar BPOM. Di banyak produk kosmetik dan obat,
 *          inilah yang paling mudah terbaca scanner karena dicetak besar dan
 *          rapi, sementara barcode dagangnya sering tertutup stiker promo.
 *
 * Keduanya disimpan di TABEL YANG SAMA (`produk_barcode`) dengan kolom
 * `jenis` sebagai pembeda — bukan sebagai kolom terpisah di tabel produk.
 * Alasannya: pencarian saat scan tidak boleh peduli jenisnya sama sekali.
 * Operator mengarahkan scanner ke apa pun yang terbaca, dan sistem harus
 * menemukan produknya lewat satu kali lookup, bukan dua percobaan berturutan.
 */
export const JENIS_BARCODE = ["PRODUK", "BPOM"] as const;
export type JenisBarcode = (typeof JENIS_BARCODE)[number];

export const LABEL_JENIS_BARCODE: Record<JenisBarcode, string> = {
  PRODUK: "Barcode produk",
  BPOM: "Barcode BPOM",
};

export interface BarisProduk {
  sku: string;
  nama: string;
  barcodes: string[];
  /** Barcode nomor izin edar BPOM. Boleh kosong. */
  barcodesBpom: string[];
}

/** Kenapa sebuah baris Excel tidak bisa dipakai. */
export type AlasanTolak =
  | "SKU_KOSONG"
  | "NAMA_KOSONG"
  | "SKU_TERLALU_PANJANG"
  | "NAMA_TERLALU_PANJANG"
  | "BARCODE_TERLALU_PANJANG";

export const PESAN_TOLAK: Record<AlasanTolak, string> = {
  SKU_KOSONG: "Kolom SKU kosong",
  NAMA_KOSONG: "Kolom Nama kosong",
  SKU_TERLALU_PANJANG: `SKU lebih dari ${SKU_MAKS} karakter`,
  NAMA_TERLALU_PANJANG: `Nama lebih dari ${NAMA_MAKS} karakter`,
  BARCODE_TERLALU_PANJANG: `Ada barcode lebih dari ${BARCODE_MAKS} karakter`,
};

/**
 * Memeriksa satu baris. Mengembalikan null kalau baris itu sah.
 *
 * Barcode boleh kosong: banyak SKU memang belum punya barcode terdaftar,
 * dan menolaknya akan memaksa orang mengarang isi kolom itu.
 */
export function periksaBaris(b: BarisProduk): AlasanTolak | null {
  if (!b.sku) return "SKU_KOSONG";
  if (b.sku.length > SKU_MAKS) return "SKU_TERLALU_PANJANG";
  if (!b.nama) return "NAMA_KOSONG";
  if (b.nama.length > NAMA_MAKS) return "NAMA_TERLALU_PANJANG";
  if (b.barcodes.some((x) => x.length > BARCODE_MAKS)) return "BARCODE_TERLALU_PANJANG";
  if (b.barcodesBpom.some((x) => x.length > BARCODE_MAKS)) return "BARCODE_TERLALU_PANJANG";
  return null;
}

/**
 * Kode yang sama didaftarkan sebagai barcode produk SEKALIGUS barcode BPOM.
 *
 * Satu kode fisik hanya punya satu arti, jadi ini selalu salah ketik di file
 * masternya — dan kalau dibiarkan, baris kedua akan menimpa jenis baris
 * pertama tanpa suara. Dilaporkan, bukan ditebak mana yang benar.
 */
export function bentrokJenis(b: BarisProduk): string[] {
  return b.barcodes.filter((x) => b.barcodesBpom.includes(x));
}

/**
 * Menebak kolom mana yang berisi apa, dari nama header di baris pertama.
 *
 * Dibuat longgar dengan sengaja. File master yang beredar di gudang ditulis
 * bermacam-macam: "SKU", "Kode SKU", "KODE_SKU", "Item Code", "Nama Barang",
 * "Deskripsi", "Barcode", "EAN". Memaksa satu ejaan berarti setiap impor
 * harus didahului acara menyunting header — dan itulah yang membuat orang
 * berhenti memakai fitur impor.
 */
export function tebakKolom(header: string[]): {
  sku: number; nama: number; barcode: number; bpom: number;
} {
  const norm = header.map((h) =>
    String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
  );

  const cari = (kandidat: string[], hindari: string[] = []): number => {
    // Cocok persis lebih dipercaya daripada cocok sebagian.
    for (const k of kandidat) {
      const i = norm.indexOf(k);
      if (i >= 0) return i;
    }
    for (const k of kandidat) {
      const i = norm.findIndex(
        (h) => h.includes(k) && !hindari.some((x) => h.includes(x))
      );
      if (i >= 0) return i;
    }
    return -1;
  };

  return {
    // "namasku" dihindari saat mencari SKU, kalau tidak kolom Nama SKU
    // akan tertangkap lebih dulu karena mengandung "sku".
    sku: cari(["sku", "kodesku", "kode", "itemcode", "kodebarang", "kodeproduk"], ["nama", "deskripsi"]),
    nama: cari(["namasku", "namaproduk", "namabarang", "nama", "deskripsi", "description", "itemname"]),
    // "bpom" dan kerabatnya DIHINDARI saat mencari barcode biasa. Tanpa itu,
    // kolom "Barcode BPOM" akan tertangkap lebih dulu oleh pencarian
    // "barcode" — keduanya sama-sama mengandung kata itu — dan seluruh
    // nomor izin edar akan terdaftar sebagai barcode dagang.
    barcode: cari(
      ["barcode", "barcodescan", "ean", "upc", "kodebarcode"],
      ["bpom", "pom", "nie", "izinedar"]
    ),
    bpom: cari([
      "barcodebpom", "bpom", "barcodebpomscan", "nomorbpom", "kodebpom",
      "nie", "nomorizinedar", "izinedar",
    ]),
  };
}
