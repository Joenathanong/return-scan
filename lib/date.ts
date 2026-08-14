/**
 * Tanggal & jam — SELALU dalam zona Asia/Jakarta.
 *
 * Di sistem lama, tanggal bisnis diambil dari jam browser operator
 * (`format(new Date(), "yyyy-MM-dd")`), sementara halaman Data memakai
 * `toISOString()` yang UTC. Dua sumber waktu yang berbeda itu menghasilkan
 * dua bug: rentang tanggal default meleset satu hari sebelum jam 07:00 WIB,
 * dan halaman scan yang dibiarkan terbuka melewati tengah malam mencatat
 * scan dengan tanggal yang tidak cocok dengan tanggal karungnya.
 *
 * Aturan di v2: tanggal bisnis DIHITUNG DI SERVER, tidak pernah dikirim
 * dari klien. Jam laptop operator yang salah tidak lagi bisa merusak data.
 */

export const TZ = "Asia/Jakarta";

const fmtDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const fmtTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Tanggal bisnis hari ini di WIB, "YYYY-MM-DD". */
export function todayWIB(): string {
  return fmtDate.format(new Date());
}

/** Tanggal WIB dari sebuah Date, "YYYY-MM-DD". */
export function dateWIB(d: Date): string {
  return fmtDate.format(d);
}

/** Jam WIB dari sebuah Date, "HH:mm:ss". */
export function timeWIB(d: Date): string {
  return fmtTime.format(d);
}

/** Geser n hari dari hari ini (WIB). n negatif = ke masa lalu. */
export function shiftDays(n: number, from: string = todayWIB()): string {
  const [y, m, d] = from.split("-").map(Number);
  // UTC noon: aman dari pergeseran DST/zona saat aritmetika hari.
  const base = Date.UTC(y, m - 1, d, 12, 0, 0);
  return fmtDate.format(new Date(base + n * 86_400_000));
}

/** "2026-06-25" → "25-06-2026" */
export function sheetDateName(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

/** Nama tab G-Sheet: "JNE_25-06-2026" */
export function sheetTabName(expedisiCode: string, dateStr: string): string {
  return `${expedisiCode}_${sheetDateName(dateStr)}`;
}

/** "2026-06-25" → "25 Juni 2026" */
const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
export function formatTanggalPanjang(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${Number(d)} ${BULAN[Number(m) - 1] ?? m} ${y}`;
}

/** Validasi "YYYY-MM-DD" — dipakai untuk membersihkan input dari query string. */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
