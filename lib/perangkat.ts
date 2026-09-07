/**
 * Menerjemahkan User-Agent jadi label pendek yang berguna bagi admin.
 *
 * Tujuannya BUKAN mengenali perangkat secara pasti — User-Agent bisa dipalsukan
 * dan sering seragam di seluruh PDT yang dibeli barengan. Tujuannya hanya
 * memberi admin petunjuk yang bisa dibaca manusia di kolom "Sedang login di"
 * pada menu Kelola User, supaya kalimat "sesi Anda diambil alih" punya konteks.
 *
 * Karena itu keamanan sistem TIDAK bergantung pada nilai ini sama sekali —
 * yang menentukan tetap `sesi_aktif` yang acak dan hanya diketahui server.
 */
export function labelPerangkat(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? "");
  if (!ua) return "Perangkat tidak dikenal";

  let peramban = "Peramban lain";
  if (/EdgA?\//i.test(ua)) peramban = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) peramban = "Opera";
  else if (/SamsungBrowser/i.test(ua)) peramban = "Samsung Internet";
  else if (/Firefox\//i.test(ua)) peramban = "Firefox";
  else if (/Chrome\//i.test(ua)) peramban = "Chrome";
  else if (/Safari\//i.test(ua)) peramban = "Safari";

  let sistem = "Sistem lain";
  if (/Windows NT/i.test(ua)) sistem = "Windows";
  else if (/Android/i.test(ua)) sistem = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) sistem = "iOS";
  else if (/Mac OS X/i.test(ua)) sistem = "macOS";
  else if (/Linux/i.test(ua)) sistem = "Linux";

  return `${peramban} · ${sistem}`;
}
