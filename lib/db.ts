import { PrismaClient } from "@prisma/client";

/**
 * Prisma client tunggal.
 *
 * Di dev, Next.js me-reload modul setiap kali file berubah. Tanpa cache di
 * globalThis, setiap reload membuat PrismaClient baru dan koneksi menumpuk —
 * TiDB Cloud Starter punya batas koneksi, jadi ini bukan sekadar rapi-rapi.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ─── Penanganan error khas TiDB / MySQL ──────────────────────────────────────

/** P2002 = unique constraint dilanggar. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  const e = err as { code?: string; meta?: { target?: string | string[] } };
  if (e?.code !== "P2002") return false;
  if (!target) return true;
  const t = e.meta?.target;
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => String(x).includes(target));
}

/**
 * TiDB memakai optimistic transaction: dua transaksi yang menyentuh baris
 * sama bisa gagal dengan "write conflict" walaupun keduanya sah. Ini normal
 * dan solusinya coba lagi — bukan error yang perlu ditampilkan ke operator.
 *
 * Catatan: risiko ini sudah teridentifikasi di project ieg-wms tapi belum
 * dipasang retry-nya di sana. Di sini dipasang sejak awal.
 */
function isWriteConflict(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    /write conflict/i.test(msg) ||
    /try again later/i.test(msg) ||
    /Deadlock found/i.test(msg) ||
    /9007/.test(msg) // TiDB error code untuk write conflict
  );
}

/**
 * Bungkus operasi tulis yang rawan bentrok (mis. dua operator scan ke karung
 * yang sama pada saat bersamaan). Hanya mengulang untuk write conflict —
 * pelanggaran unique TIDAK diulang, karena itu memang keputusan final.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isWriteConflict(err) || attempt === maxAttempts) throw err;
      // Backoff singkat + jitter supaya dua transaksi tidak bentrok lagi
      // di milidetik yang sama.
      const wait = 40 * attempt + Math.floor(Math.random() * 40);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
