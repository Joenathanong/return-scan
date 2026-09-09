/**
 * Aturan penyapuan draft bongkaran — bagian yang MURNI, tanpa database,
 * supaya bisa diuji tanpa menyalakan apa pun.
 *
 * LATAR
 * Satu baris `bongkaran` berstatus `draft` lahir setiap kali resi di-scan.
 * Itu keputusan yang disengaja: `scanned_at` harus ditulis server pada
 * detik resi dibaca, bukan saat Simpan ditekan, supaya jam PDT yang meleset
 * tidak bisa merusak laporan. Harganya: setiap sesi yang tidak selesai
 * meninggalkan satu baris kosong.
 *
 * Sebelum ini tidak ada satu pun yang membersihkannya, dan dashboard
 * menampilkan SELURUH draft sepanjang masa. Sepuluh sesi terputus per
 * minggu sudah cukup membuat panel "Belum selesai" penuh terus-menerus,
 * dan panel yang selalu penuh sama tidak bergunanya dengan panel yang
 * tidak ada — tidak ada yang membacanya lagi.
 *
 * KENAPA DIHAPUS, BUKAN DIARSIPKAN
 * Draft kosong tidak memuat satu pun barang. Yang hilang saat ia dihapus
 * hanyalah fakta "seseorang pernah men-scan nomor ini lalu berhenti" —
 * dan fakta itu sudah tercatat di tempat lain (audit log operator). Draft
 * yang TERNYATA berisi barang tidak pernah disentuh penyapu ini; ia justru
 * yang perlu dilihat manusia.
 */

/**
 * Umur minimum sebelum draft boleh disapu.
 *
 * HARUS lebih panjang daripada `UMUR_SESI_JAM` di lib/sesi-lokal.ts.
 * Selama jendela ini, layar scan masih bisa memulihkan keranjangnya dan
 * menyelesaikan draft yang sama — menyapunya lebih cepat berarti
 * menghapus tujuan pemulihan itu tepat sebelum ia dipakai.
 *
 * 12 jam juga berarti draft dari shift malam tidak ikut tersapu oleh
 * seseorang yang membuka dashboard pagi-pagi.
 */
export const UMUR_DRAFT_SAPU_JAM = 12;

/** Jeda minimum antar penyapuan otomatis. */
export const JEDA_SAPU_MENIT = 60;

/**
 * Batas jumlah draft yang diperiksa sekali jalan.
 *
 * Penyapuan berjalan menumpang permintaan dashboard, jadi ia tidak boleh
 * berubah jadi pekerjaan berat: 500 baris `id` saja sudah kurang dari satu
 * paket jaringan, dan sisanya terurus pada penyapuan berikutnya.
 */
export const MAKS_SAPU_SEKALI = 500;

/** Ambang waktu: draft dengan `scannedAt` sebelum ini boleh disapu. */
export function batasSapu(sekarang: Date, jam: number = UMUR_DRAFT_SAPU_JAM): Date {
  return new Date(sekarang.getTime() - jam * 60 * 60 * 1000);
}

/**
 * Apakah penyapuan otomatis sudah boleh jalan lagi?
 *
 * `terakhir === null` berarti instance ini belum pernah menyapu — jalan.
 * Jam yang mundur (`sekarang < terakhir`) juga dianggap boleh, karena
 * alternatifnya adalah instance yang tidak pernah menyapu lagi sampai ia
 * dimatikan.
 */
export function perluSapu(
  terakhir: number | null,
  sekarang: number,
  jedaMenit: number = JEDA_SAPU_MENIT
): boolean {
  if (terakhir === null) return true;
  if (sekarang < terakhir) return true;
  return sekarang - terakhir >= jedaMenit * 60 * 1000;
}

/**
 * Menyaring id draft yang benar-benar KOSONG.
 *
 * Dipisah dari kuerinya supaya aturannya bisa diuji: satu id yang lolos
 * padahal punya barang berarti menghapus hasil bongkar sungguhan, dan itu
 * jenis kesalahan yang tidak pernah ketahuan sampai orang mencarinya.
 */
export function draftKosong(calon: string[], berisi: Iterable<string>): string[] {
  const adaIsinya = new Set(berisi);
  return calon.filter((id) => !adaIsinya.has(id));
}
