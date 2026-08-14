import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "@/lib/crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "scan_retur_session";
/** 12 jam — cukup untuk satu shift penuh tanpa login ulang. */
export const SESSION_MAX_AGE = 12 * 60 * 60;

// ─── Error terstruktur ───────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export const badRequest   = (m: string, c?: string) => new ApiError(400, m, c);
export const unauthorized = (m = "Silakan login terlebih dahulu.") => new ApiError(401, m);
export const forbidden    = (m = "Anda tidak punya akses ke tindakan ini.") => new ApiError(403, m);
export const notFound     = (m = "Data tidak ditemukan.") => new ApiError(404, m);
export const conflict     = (m: string, c?: string) => new ApiError(409, m, c);

/**
 * Bungkus setiap handler API. Semua error jadi JSON yang konsisten, dan
 * error tak terduga tetap tercatat di log server dengan konteksnya.
 *
 * Pesan error yang sampai ke operator SELALU bahasa Indonesia dan bisa
 * ditindaklanjuti — bukan stack trace.
 */
export function handle<T>(
  fn: () => Promise<T>
): Promise<NextResponse> {
  return fn()
    .then((data) => NextResponse.json(data ?? { ok: true }))
    .catch((err) => {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        );
      }
      const e = err as { code?: string; message?: string };
      // Error Prisma yang sering muncul, diterjemahkan supaya berguna.
      if (e?.code === "P2002") {
        return NextResponse.json(
          { error: "Data sudah ada (melanggar aturan keunikan).", code: "DUPLICATE" },
          { status: 409 }
        );
      }
      if (e?.code === "P2025") {
        return NextResponse.json({ error: "Data tidak ditemukan." }, { status: 404 });
      }
      if (e?.code === "P1001" || e?.code === "P1017") {
        console.error("[scan-retur] Database tidak terjangkau:", e.message);
        return NextResponse.json(
          { error: "Database tidak bisa dihubungi. Coba lagi sebentar lagi." },
          { status: 503 }
        );
      }
      console.error("[scan-retur] Unhandled:", err);
      return NextResponse.json(
        { error: "Terjadi kesalahan di server." },
        { status: 500 }
      );
    });
}

// ─── Sesi ────────────────────────────────────────────────────────────────────

/** Payload sesi dari cookie, atau null. Tidak menyentuh database. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Sesi yang wajib ada + verifikasi user masih aktif di database.
 *
 * Pengecekan `active` sengaja menyentuh DB setiap request: kalau admin
 * menonaktifkan seorang operator, aksesnya harus putus saat itu juga,
 * bukan menunggu token 12 jam kedaluwarsa.
 */
export async function requireUser() {
  const s = await getSession();
  if (!s) throw unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: s.uid },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user) throw unauthorized("Akun tidak ditemukan.");
  if (!user.active) throw forbidden("Akun Anda dinonaktifkan. Hubungi admin.");

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw forbidden("Khusus admin.");
  return user;
}

// ─── Util ────────────────────────────────────────────────────────────────────

/** Normalisasi kode resi: buang spasi, jadikan huruf besar. */
export function cleanResi(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").toUpperCase();
}

export function requireString(v: unknown, field: string, max = 191): string {
  const s = String(v ?? "").trim();
  if (!s) throw badRequest(`${field} wajib diisi.`);
  if (s.length > max) throw badRequest(`${field} terlalu panjang (maks. ${max}).`);
  return s;
}

export async function writeAudit(
  userId: string | null,
  userName: string,
  action: string,
  detail: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        userName,
        action,
        detail: detail.slice(0, 500),
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    // Audit yang gagal tidak boleh menggagalkan operasi utama.
    console.error("[scan-retur] audit gagal:", err);
  }
}
