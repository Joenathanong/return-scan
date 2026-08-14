/**
 * Aturan kode ekspedisi — satu-satunya sumber.
 *
 * Kode ekspedisi dipakai sebagai nama tab saat ekspor ke Google Sheets dan
 * TIDAK PERNAH berubah setelah dibuat, jadi aturannya harus sama persis di
 * server maupun di form. Sebelumnya definisinya tersebar: satu di
 * `app/api/expedisi/route.ts`, satu lagi disalin ke halaman admin, dan satu
 * lagi di `app/api/claim/config/route.ts`.
 *
 * Selain rawan menyimpang, salinan di route.ts itu juga menggagalkan build:
 * Next.js App Router hanya mengizinkan handler HTTP dan beberapa konstanta
 * konfigurasi yang diekspor dari file `route.ts`. Helper bersama harus
 * tinggal di `lib/`.
 */

/** Huruf kapital, angka, garis bawah. 2–32 karakter. */
export const KODE_RE = /^[A-Z0-9_]{2,32}$/;

export const KODE_MAKS = 32;

/**
 * Usulan kode dari nama ekspedisi.
 *
 * Hanya SARAN — admin bebas menggantinya di form. Ini berbeda dari sistem
 * lama, di mana kode selalu dihitung ulang dari nama setiap kali disimpan,
 * sehingga meralat satu huruf pada nama ikut mengubah nama tab G-Sheet dan
 * memutus hubungan dengan seluruh data sebelumnya.
 */
export function saranKode(nama: string): string {
  return String(nama)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, KODE_MAKS);
}

/**
 * Bersihkan ketikan pengguna di field kode, tanpa memotong ujungnya —
 * supaya garis bawah yang sedang diketik di tengah kata tidak hilang.
 */
export function bersihkanKode(input: string): string {
  return String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, KODE_MAKS);
}

/** Pesan kesalahan yang seragam di server dan di form. */
export const PESAN_KODE_TIDAK_VALID =
  "Kode hanya boleh huruf kapital, angka, dan garis bawah (2–32 karakter).";
