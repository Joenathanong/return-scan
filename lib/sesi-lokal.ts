/**
 * Amplop penyimpanan sesi scan di perangkat operator.
 *
 * MASALAH YANG DIPECAHKAN
 * Halaman scan membuat baris `bongkaran` berstatus draft TEPAT saat resi
 * di-scan, karena jam scan harus datang dari server, bukan dari jam PDT.
 * Konsekuensinya: setiap kali layar itu ditinggalkan sebelum Simpan —
 * PDT mati, peramban di-refresh, operator salah tekan menu, jaringan putus
 * saat menyimpan — draft-nya tertinggal di database DAN keranjang barang
 * yang sudah terlanjur di-scan hilang dari layar. Yang kedua jauh lebih
 * mahal daripada yang pertama: draft kosong cuma bikin daftar panjang,
 * sedangkan keranjang yang hilang berarti satu kardus dibongkar dua kali.
 *
 * Jadi keranjangnya disimpan di perangkat, dan dipulihkan saat halaman
 * dibuka lagi. NOL kueri ke database: pemulihan tidak menyentuh TiDB sama
 * sekali, karena semua yang dibutuhkan (id draft, jam scan dari server,
 * daftar barang) sudah ada di tangan klien sejak awal.
 *
 * KENAPA localStorage, BUKAN IndexedDB
 * Cache produk memang di IndexedDB — isinya puluhan ribu baris dan ditulis
 * per batch. Ini kebalikannya: satu objek kecil, ditulis sangat sering
 * (tiap ketikan, lewat debounce), dan HARUS bisa ditulis serentak saat
 * halaman ditutup — `pagehide` tidak menunggu janji IndexedDB selesai,
 * sementara localStorage menulis seketika.
 *
 * KENAPA BUKAN sessionStorage
 * sessionStorage ikut hilang kalau tab-nya ditutup atau PDT-nya mati —
 * yaitu persis dua keadaan yang fitur ini dibuat untuk menyelamatkan.
 */

/** Kunci penyimpanan. Versinya ikut di nama, bukan cuma di isi. */
const KUNCI = "ieg.bongkaran.sesi";

/**
 * Umur maksimum simpanan.
 *
 * Harus LEBIH PENDEK daripada ambang penyapuan draft di server
 * (`UMUR_DRAFT_SAPU_JAM` di lib/draft.ts). Kalau lebih panjang, ada
 * jendela waktu di mana layar memulihkan sesi yang draft-nya sudah
 * disapu — Simpan lalu gagal "draft tidak ditemukan", dan operator
 * kehilangan keranjang yang tadi ditawarkan untuk dilanjutkan.
 */
export const UMUR_SESI_JAM = 8;
const UMUR_SESI_MS = UMUR_SESI_JAM * 60 * 60 * 1000;

interface Amplop {
  versi: number;
  disimpanPada: number;
  muatan: unknown;
}

/**
 * Penyimpanan yang bisa diganti saat pengujian. Sengaja dibaca lewat
 * fungsi, bukan disimpan sebagai konstanta modul: di Next.js modul ini
 * ikut dirender di server, dan menyentuh `localStorage` saat impor akan
 * menggagalkan render sebelum satu baris pun sempat berjalan.
 */
function gudang(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Peramban dengan penyimpanan situs dimatikan melempar di sini.
    return null;
  }
}

export function simpanAmplop(versi: number, muatan: unknown, sekarang = Date.now()): void {
  const g = gudang();
  if (!g) return;
  try {
    const a: Amplop = { versi, disimpanPada: sekarang, muatan };
    g.setItem(KUNCI, JSON.stringify(a));
  } catch (e) {
    // Kuota penuh atau mode privat. Bukan alasan menghentikan scan —
    // yang hilang cuma kemampuan memulihkan, bukan datanya sendiri.
    console.error("[bongkaran] gagal menyimpan sesi lokal:", e);
  }
}

/**
 * Membaca simpanan, dengan TIGA saringan yang semuanya wajib:
 *
 *   1. versi   — bentuk `Item`/`Sesi` berubah antar rilis; memulihkan
 *                bentuk lama ke layar baru menghasilkan kolom kosong yang
 *                terlihat seperti isian yang belum diketik.
 *   2. umur    — lihat catatan UMUR_SESI_JAM.
 *   3. `sah()` — pemeriksaan bentuk dari pemanggil. Isi localStorage bisa
 *                disunting siapa saja lewat DevTools, jadi ia diperlakukan
 *                sebagai masukan luar, bukan sebagai data sendiri.
 */
export function bacaAmplop<T>(
  versi: number,
  sah: (v: unknown) => v is T,
  sekarang = Date.now()
): T | null {
  const g = gudang();
  if (!g) return null;

  let mentah: string | null = null;
  try {
    mentah = g.getItem(KUNCI);
  } catch {
    return null;
  }
  if (!mentah) return null;

  let a: Amplop;
  try {
    a = JSON.parse(mentah) as Amplop;
  } catch {
    hapusAmplop();
    return null;
  }

  if (!a || typeof a !== "object") { hapusAmplop(); return null; }
  if (a.versi !== versi) { hapusAmplop(); return null; }
  if (!masihSegar(a.disimpanPada, sekarang)) { hapusAmplop(); return null; }
  if (!sah(a.muatan)) { hapusAmplop(); return null; }

  return a.muatan;
}

export function hapusAmplop(): void {
  const g = gudang();
  if (!g) return;
  try {
    g.removeItem(KUNCI);
  } catch {
    /* tidak ada yang bisa dilakukan, dan tidak ada yang perlu dilakukan */
  }
}

/**
 * Dipisah sebagai fungsi murni supaya bisa diuji tanpa peramban.
 *
 * `disimpanPada` yang berada DI MASA DEPAN juga ditolak: itu tanda jam
 * perangkat mundur (RTC habis, zona waktu diubah), dan simpanan yang
 * umurnya tidak bisa dihitung lebih baik dibuang daripada dipulihkan
 * entah dari kapan.
 */
export function masihSegar(disimpanPada: unknown, sekarang: number): boolean {
  if (typeof disimpanPada !== "number" || !Number.isFinite(disimpanPada)) return false;
  const umur = sekarang - disimpanPada;
  return umur >= 0 && umur <= UMUR_SESI_MS;
}
