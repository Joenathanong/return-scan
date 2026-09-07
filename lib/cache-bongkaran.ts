/**
 * Cache Master Produk + riwayat batch di PDT (IndexedDB).
 *
 * INI YANG MEMBUAT MODUL BONGKARAN MURAH DAN CEPAT. Selama scan berlangsung,
 * lookup barcode dan saran batch dijawab dari penyimpanan lokal — nol
 * kueri ke TiDB, nol menunggu jaringan gudang. Server hanya disentuh dua
 * kali per resi (mulai + simpan) dan sekali saat login (sinkron).
 *
 * Sinkronnya DELTA: klien menyimpan kursor (waktu perubahan terakhir +
 * kunci baris terakhir) per jenis data, dan server hanya membalas baris
 * yang berubah sesudahnya. Hari pertama seluruh master terkirim sekali;
 * hari-hari berikutnya biasanya nol baris.
 *
 * Baris nonaktif (`active: false`) ikut terkirim dan DIHAPUS dari cache di
 * sini. Itulah sebabnya produk dan barcode di server tidak pernah benar-
 * benar dihapus: baris yang lenyap dari tabel tidak akan pernah muncul di
 * sinkron delta, sehingga PDT akan memakainya selamanya.
 *
 * File ini hanya jalan di peramban.
 */

import { mintaJson } from "@/lib/http";
import { bersihkanKode } from "@/lib/produk";

const NAMA_DB = "bongkaran";
const VERSI_DB = 1;

const S_PRODUK = "produk";
const S_BARCODE = "barcode";
const S_BATCH = "batch";
const S_META = "meta";

export interface ProdukCache {
  sku: string;
  nama: string;
}

export interface BatchCache {
  /** Kunci gabungan `${sku}|${batch}` — IndexedDB tidak punya kunci majemuk. */
  kunci: string;
  sku: string;
  batch: string;
  edDate: string;
  dipakai: number;
}

interface Kursor {
  waktu: string;
  kunci: string;
}

interface MetaKursor {
  produk: Kursor | null;
  barcode: Kursor | null;
  batch: Kursor | null;
}

interface BalasanSync {
  penuh: boolean;
  produk: { sku: string; nama: string; active: boolean; updatedAt: string }[];
  barcode: { barcode: string; sku: string; active: boolean; updatedAt: string }[];
  batch: {
    id: string; sku: string; batch: string; edDate: string;
    dipakai: number; updatedAt: string;
  }[];
  kursor: MetaKursor;
  lagi: { produk: boolean; barcode: boolean; batch: boolean };
}

// ─── Pembungkus IndexedDB ────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

export function cacheTersedia(): boolean {
  return typeof indexedDB !== "undefined";
}

function bukaDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((selesai, gagal) => {
    const req = indexedDB.open(NAMA_DB, VERSI_DB);

    // Tab lain masih memegang versi lama. Tanpa penanganan ini, `open()`
    // menggantung SELAMANYA — dan karena promise-nya di-cache, setiap
    // pemakaian cache ikut menggantung tanpa pesan apa pun.
    req.onblocked = () =>
      gagal(
        new Error(
          "Aplikasi ini masih terbuka di tab lain dengan versi data lama. " +
            "Tutup tab itu lalu muat ulang halaman."
        )
      );
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_PRODUK)) {
        db.createObjectStore(S_PRODUK, { keyPath: "sku" });
      }
      if (!db.objectStoreNames.contains(S_BARCODE)) {
        db.createObjectStore(S_BARCODE, { keyPath: "barcode" });
      }
      if (!db.objectStoreNames.contains(S_BATCH)) {
        const s = db.createObjectStore(S_BATCH, { keyPath: "kunci" });
        // Saran batch selalu dicari per SKU, tidak pernah menyeluruh.
        s.createIndex("sku", "sku", { unique: false });
      }
      if (!db.objectStoreNames.contains(S_META)) {
        db.createObjectStore(S_META, { keyPath: "nama" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Tab lain hendak meningkatkan versi: lepaskan koneksi ini supaya
      // tab itu tidak ikut menggantung.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      selesai(db);
    };
    req.onerror = () => gagal(req.error ?? new Error("IndexedDB tidak bisa dibuka."));
  });

  // Kegagalan JANGAN di-cache: mode penyamaran, kuota penuh, atau tab kedua
  // adalah keadaan sementara. Kalau promise gagalnya disimpan, tombol
  // "Sinkronkan" tidak akan pernah berhasil sampai halaman dimuat ulang.
  dbPromise.catch(() => { dbPromise = null; });

  return dbPromise;
}

function selesaikan(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, gagal) => {
    tx.oncomplete = () => ok();
    tx.onabort = tx.onerror = () =>
      gagal(tx.error ?? new Error("Transaksi cache gagal."));
  });
}

function hasil<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, gagal) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => gagal(req.error ?? new Error("Baca cache gagal."));
  });
}

// ─── Meta ────────────────────────────────────────────────────────────────────

async function bacaKursor(): Promise<MetaKursor> {
  const db = await bukaDb();
  const tx = db.transaction(S_META, "readonly");
  const row = await hasil<{ nama: string; nilai: MetaKursor } | undefined>(
    tx.objectStore(S_META).get("kursor")
  );
  return row?.nilai ?? { produk: null, barcode: null, batch: null };
}

async function tulisKursor(k: MetaKursor): Promise<void> {
  const db = await bukaDb();
  const tx = db.transaction(S_META, "readwrite");
  tx.objectStore(S_META).put({ nama: "kursor", nilai: k });
  await selesaikan(tx);
}

/** Buang seluruh cache — dipakai kalau isinya dicurigai tidak konsisten. */
export async function kosongkanCache(): Promise<void> {
  const db = await bukaDb();
  const tx = db.transaction([S_PRODUK, S_BARCODE, S_BATCH, S_META], "readwrite");
  tx.objectStore(S_PRODUK).clear();
  tx.objectStore(S_BARCODE).clear();
  tx.objectStore(S_BATCH).clear();
  tx.objectStore(S_META).clear();
  await selesaikan(tx);
}

// ─── Sinkron ─────────────────────────────────────────────────────────────────

export interface HasilSinkron {
  produk: number;
  barcode: number;
  batch: number;
  putaran: number;
  penuh: boolean;
  /** true kalau batas putaran tercapai — cache BELUM lengkap. */
  terpotong: boolean;
}

/**
 * Menarik perubahan dari server dan menerapkannya ke cache.
 *
 * `onKemajuan` dipanggil tiap putaran supaya layar bisa menampilkan
 * "mengunduh master produk…" saat sinkron pertama, yang memang bisa
 * memakan beberapa putaran.
 */
export async function sinkron(
  onKemajuan?: (h: HasilSinkron) => void
): Promise<HasilSinkron> {
  const total: HasilSinkron = {
    produk: 0, barcode: 0, batch: 0, putaran: 0, penuh: false, terpotong: false,
  };

  let kursor = await bacaKursor();

  /**
   * Jenis yang sudah tuntas di putaran sebelumnya.
   *
   * Tanpa ini, jenis yang belum pernah mengirim satu baris pun (mis. tabel
   * batch yang masih kosong di hari pertama) tetap punya kursor null,
   * sehingga parameternya tidak dikirim dan server menjalankan pemindaian
   * penuh untuk jenis itu di SETIAP putaran — 200 kali percuma saat master
   * produk besar sedang diunduh bertahap.
   */
  const tuntas = { produk: false, barcode: false, batch: false };

  // Batas putaran: pengaman terhadap server yang selalu menjawab `lagi`
  // (mis. bug kursor). Tanpa ini, satu bug di server berarti PDT berputar
  // tanpa henti dan operator hanya melihat layar yang menggantung.
  for (let putaran = 0; putaran < 200; putaran++) {
    const q = new URLSearchParams();
    if (kursor.produk) {
      q.set("produkWaktu", kursor.produk.waktu);
      q.set("produkKunci", kursor.produk.kunci);
    }
    if (kursor.barcode) {
      q.set("barcodeWaktu", kursor.barcode.waktu);
      q.set("barcodeKunci", kursor.barcode.kunci);
    }
    if (kursor.batch) {
      q.set("batchWaktu", kursor.batch.waktu);
      q.set("batchKunci", kursor.batch.kunci);
    }
    // Jenis yang sudah tuntas ditandai supaya server melewatinya sama sekali.
    if (tuntas.produk) q.set("lewatiProduk", "1");
    if (tuntas.barcode) q.set("lewatiBarcode", "1");
    if (tuntas.batch) q.set("lewatiBatch", "1");

    const d = await mintaJson<BalasanSync>(
      `/api/bongkaran/sync${q.toString() ? `?${q}` : ""}`,
      { timeoutMs: 60_000 }
    );

    if (putaran === 0) total.penuh = d.penuh;

    if (d.produk.length || d.barcode.length || d.batch.length) {
      const db = await bukaDb();
      const tx = db.transaction([S_PRODUK, S_BARCODE, S_BATCH], "readwrite");
      const sProduk = tx.objectStore(S_PRODUK);
      const sBarcode = tx.objectStore(S_BARCODE);
      const sBatch = tx.objectStore(S_BATCH);

      for (const p of d.produk) {
        if (p.active) sProduk.put({ sku: p.sku, nama: p.nama });
        else sProduk.delete(p.sku);
      }
      for (const b of d.barcode) {
        if (b.active) sBarcode.put({ barcode: b.barcode, sku: b.sku });
        else sBarcode.delete(b.barcode);
      }
      for (const b of d.batch) {
        sBatch.put({
          kunci: `${b.sku}|${b.batch}`,
          sku: b.sku,
          batch: b.batch,
          edDate: b.edDate,
          dipakai: b.dipakai,
        });
      }
      await selesaikan(tx);
    }

    total.produk += d.produk.length;
    total.barcode += d.barcode.length;
    total.batch += d.batch.length;
    total.putaran = putaran + 1;

    // Kursor hanya digeser untuk jenis yang benar-benar membawa baris.
    // Jenis yang sudah habis mempertahankan kursornya — kalau ditimpa null,
    // panggilan berikutnya akan menariknya dari awal lagi.
    kursor = {
      produk: d.kursor.produk ?? kursor.produk,
      barcode: d.kursor.barcode ?? kursor.barcode,
      batch: d.kursor.batch ?? kursor.batch,
    };
    await tulisKursor(kursor);
    onKemajuan?.({ ...total });

    if (!d.lagi.produk) tuntas.produk = true;
    if (!d.lagi.barcode) tuntas.barcode = true;
    if (!d.lagi.batch) tuntas.batch = true;

    if (tuntas.produk && tuntas.barcode && tuntas.batch) return total;
  }

  // Sampai di sini berarti batas putaran tercapai tanpa semua jenis tuntas.
  // Ditandai supaya layar TIDAK melaporkan "data siap" padahal belum.
  total.terpotong = true;
  return total;
}

// ─── Pemakaian saat scan ─────────────────────────────────────────────────────

/**
 * Barcode → produk. Null berarti barcode belum terdaftar di master.
 *
 * DUA TRANSAKSI, bukan satu. Transaksi IndexedDB dianggap selesai begitu
 * tidak ada permintaan yang tertunda pada akhir tugas; menunggu (`await`)
 * hasil permintaan pertama lalu mengirim permintaan kedua di transaksi yang
 * sama berjalan di sebagian peramban dan melempar TransactionInactiveError
 * di sebagian lainnya. Membuka transaksi kedua itu murah dan selalu benar.
 */
export async function cariBarcode(barcode: string): Promise<ProdukCache | null> {
  const kode = bersihkanKode(barcode);
  if (!kode) return null;

  const db = await bukaDb();

  const baris = await hasil<{ barcode: string; sku: string } | undefined>(
    db.transaction(S_BARCODE, "readonly").objectStore(S_BARCODE).get(kode)
  );
  if (!baris) return null;

  const produk = await hasil<ProdukCache | undefined>(
    db.transaction(S_PRODUK, "readonly").objectStore(S_PRODUK).get(baris.sku)
  );
  // Barcode ada tapi produknya tidak: master setengah tersinkron. Diberi
  // SKU-nya saja supaya datanya tetap benar, namanya diisi operator.
  return produk ?? { sku: baris.sku, nama: "" };
}

export const MIN_KARAKTER_SARAN = 4;

/**
 * Saran batch untuk satu SKU.
 *
 * Baru muncul setelah karakter ke-4 (sesuai permintaan): batch yang berpola
 * tanggal punya 3 karakter pertama yang sama untuk seluruh produksi satu
 * bulan, jadi menyarankan lebih awal hanya menampilkan daftar panjang yang
 * belum menyaring apa pun.
 *
 * Diurutkan dari yang paling sering dipakai — batch yang sedang berjalan di
 * gudang akan selalu berada di atas.
 */
export async function saranBatch(
  sku: string,
  awalan: string,
  maks = 20
): Promise<BatchCache[]> {
  const kode = bersihkanKode(awalan);
  if (!sku || kode.length < MIN_KARAKTER_SARAN) return [];

  const db = await bukaDb();
  const tx = db.transaction(S_BATCH, "readonly");
  const semua = await hasil<BatchCache[]>(
    tx.objectStore(S_BATCH).index("sku").getAll(IDBKeyRange.only(sku))
  );

  return semua
    .filter((b) => b.batch.startsWith(kode))
    .sort((a, b) => b.dipakai - a.dipakai || a.batch.localeCompare(b.batch))
    .slice(0, maks);
}

/** Jumlah baris di cache — ditampilkan di layar scan sebagai tanda sehat. */
export async function isiCache(): Promise<{ produk: number; barcode: number; batch: number }> {
  const db = await bukaDb();
  const tx = db.transaction([S_PRODUK, S_BARCODE, S_BATCH], "readonly");
  const [produk, barcode, batch] = await Promise.all([
    hasil(tx.objectStore(S_PRODUK).count()),
    hasil(tx.objectStore(S_BARCODE).count()),
    hasil(tx.objectStore(S_BATCH).count()),
  ]);
  return { produk, barcode, batch };
}

/**
 * Menambahkan batch yang baru saja dipakai ke cache lokal, tanpa menunggu
 * sinkron berikutnya. Tanpa ini, batch yang barusan diketik tidak akan
 * muncul sebagai saran untuk barang berikutnya di resi yang sama — dan
 * itu justru saat batch yang sama paling mungkin diketik ulang.
 */
export async function catatBatchLokal(
  sku: string,
  batch: string,
  edDate: string
): Promise<void> {
  const kodeBatch = bersihkanKode(batch);
  if (!sku || !kodeBatch || !edDate) return;
  const db = await bukaDb();
  const kunci = `${sku}|${kodeBatch}`;

  // Baca dan tulis di transaksi terpisah — alasannya sama dengan di
  // cariBarcode di atas. Balapan antar dua kartu barang yang menulis batch
  // sama tidak berbahaya di sini: yang paling buruk terjadi adalah angka
  // `dipakai` meleset satu, dan angka itu hanya menentukan urutan saran.
  const ada = await hasil<BatchCache | undefined>(
    db.transaction(S_BATCH, "readonly").objectStore(S_BATCH).get(kunci)
  );

  const tx = db.transaction(S_BATCH, "readwrite");
  tx.objectStore(S_BATCH).put({
    kunci, sku, batch: kodeBatch, edDate,
    dipakai: (ada?.dipakai ?? 0) + 1,
  });
  await selesaikan(tx);
}
