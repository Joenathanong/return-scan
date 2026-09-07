/**
 * Pembungkus fetch untuk komponen klien.
 *
 * Alasan keberadaannya: `fetch` melempar `TypeError: Failed to fetch` ketika
 * permintaan tidak pernah mendapat jawaban — jaringan putus, fungsi server
 * mati saat cold start, atau permintaan kehabisan waktu. Pesan itu muncul apa
 * adanya di layar operator dan tidak memberi tahu apa pun yang bisa
 * ditindaklanjuti.
 *
 * Masalah kedua: `res.json()` ikut melempar kalau server membalas HTML
 * (halaman error Vercel, misalnya), menghasilkan pesan seperti
 * `Unexpected token '<'` yang menyesatkan — seolah kesalahan ada di data,
 * padahal servernya yang tumbang.
 *
 * Keduanya diterjemahkan di sini menjadi kalimat bahasa Indonesia yang
 * menyebutkan apa yang terjadi dan apa yang bisa dilakukan.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public kode?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface Opsi {
  method?: string;
  body?: unknown;
  /** Batas waktu; lewat dari ini permintaan dibatalkan. Default 30 detik. */
  timeoutMs?: number;
}

export async function mintaJson<T = unknown>(
  url: string,
  opsi: Opsi = {}
): Promise<T> {
  const { method = "GET", body, timeoutMs = 30_000 } = opsi;

  const pembatal = new AbortController();
  const jam = setTimeout(() => pembatal.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      signal: pembatal.signal,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new HttpError(
        `Server tidak menjawab dalam ${Math.round(timeoutMs / 1000)} detik. ` +
          "Coba lagi; kalau terus berulang, periksa koneksi database di /api/health.",
        0
      );
    }
    // Inilah "Failed to fetch" yang asli.
    throw new HttpError(
      "Tidak bisa menghubungi server. Periksa koneksi internet Anda. " +
        "Kalau internet normal, kemungkinan server sedang bermasalah — " +
        "buka /api/health untuk memeriksanya.",
      0
    );
  } finally {
    clearTimeout(jam);
  }

  const teks = await res.text();

  let data: unknown = null;
  if (teks) {
    try {
      data = JSON.parse(teks);
    } catch {
      // Balasan bukan JSON — hampir selalu halaman error dari platform.
      throw new HttpError(
        `Server membalas dengan format yang tidak dikenali (HTTP ${res.status}). ` +
          "Buka /api/health untuk memeriksa keadaan server.",
        res.status
      );
    }
  }

  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;

    // Sesi diambil alih perangkat lain. Ditangani DI SINI, bukan di tiap
    // halaman, karena inilah satu-satunya tempat yang melihat SEMUA balasan
    // server — kalau tidak, operator akan melihat pesan error merah di
    // tengah halaman yang tidak bisa dia perbaiki, lalu menekan tombol
    // berulang kali sampai menyerah.
    if (d?.code === "SESI_DIGANTI" && typeof window !== "undefined") {
      window.location.href = "/login?alasan=sesi";
      // Tetap lempar: pemanggil harus berhenti mengerjakan apa pun selagi
      // peramban berpindah halaman (perpindahan itu tidak seketika).
    }

    throw new HttpError(
      d?.error || `Permintaan gagal (HTTP ${res.status}).`,
      res.status,
      d?.code
    );
  }

  return data as T;
}

/** Ubah error apa pun jadi kalimat yang layak ditampilkan ke pengguna. */
export function pesanError(e: unknown, cadangan = "Terjadi kesalahan."): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e) || cadangan;
}
