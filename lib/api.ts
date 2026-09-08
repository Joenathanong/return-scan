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
        const res = NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        );

        // Sesi sudah tidak berlaku → COOKIE-NYA HARUS IKUT DIHAPUS di sini.
        //
        // Kalau tidak: klien dilempar ke /login, tapi middleware melihat
        // cookie masih ada, menganggap orangnya sudah login, dan
        // memantulkannya kembali ke /dashboard — yang lalu memanggil
        // /api/auth/me, gagal lagi, dan begitu seterusnya. Layarnya berkedip
        // tanpa henti dan halaman login tidak pernah sempat tampil.
        //
        // Menghapus cookie di sini memutus lingkaran itu di sumbernya:
        // permintaan berikutnya benar-benar tidak lagi membawa sesi.
        if (err.code === KODE_SESI_DIGANTI) {
          res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
        }
        return res;
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

/** Kode yang dikenali klien untuk memaksa keluar dan kembali ke /login. */
export const KODE_SESI_DIGANTI = "SESI_DIGANTI";

export const sesiDiganti = () =>
  new ApiError(
    401,
    "Akun Anda dipakai login di perangkat lain. Sesi di perangkat ini diakhiri.",
    KODE_SESI_DIGANTI
  );

/**
 * Sesi yang wajib ada + verifikasi user masih aktif di database.
 *
 * Pengecekan `active` sengaja menyentuh DB setiap request: kalau admin
 * menonaktifkan seorang operator, aksesnya harus putus saat itu juga,
 * bukan menunggu token 12 jam kedaluwarsa.
 *
 * LOGIN SATU PERANGKAT menumpang query yang sama. Baris user ini toh sudah
 * dibaca, jadi membandingkan `sid` cookie dengan `users.sesi_aktif` TIDAK
 * menambah satu pun perjalanan ke database — hanya satu kolom lagi di SELECT.
 * Sifatnya "login terbaru menang": login baru menimpa `sesi_aktif`, dan
 * perangkat lama terputus pada permintaan berikutnya yang ia kirim.
 */
export async function requireUser() {
  const s = await getSession();
  if (!s) throw unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: s.uid },
    select: {
      id: true, email: true, name: true, role: true, active: true,
      sesiAktif: true, bisaBongkaran: true, bisaCancelOrder: true,
    },
  });
  if (!user) throw unauthorized("Akun tidak ditemukan.");
  if (!user.active) throw forbidden("Akun Anda dinonaktifkan. Hubungi admin.");

  // Cookie terbitan lama (sebelum fitur ini ada) tidak punya `sid`. Itu
  // bukan pemalsuan, hanya usang — perlakukan sebagai sesi habis.
  //
  // Kodenya SESI_DIGANTI, bukan 401 polos: tanpa kode, klien tidak tahu
  // harus membuang sesinya dan operator hanya melihat pesan merah di
  // halaman yang sudah mati. Ini menyangkut SEMUA user yang sedang login
  // saat versi ini dipasang, jadi jalurnya harus mulus.
  if (!s.sid) {
    throw new ApiError(
      401,
      "Sesi Anda dibuat sebelum aturan satu-perangkat berlaku. Silakan login lagi.",
      KODE_SESI_DIGANTI
    );
  }

  // sesiAktif NULL = admin menekan "Keluarkan dari perangkat", atau user
  // sudah logout. Keduanya berarti cookie ini tidak berlaku lagi.
  if (user.sesiAktif !== s.sid) throw sesiDiganti();

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw forbidden("Khusus admin.");
  return user;
}

/**
 * Akses modul Bongkaran. Admin selalu boleh; operator harus dicentang
 * "Bisa Bongkaran" di menu Kelola User.
 */
export async function requireBongkaran() {
  const user = await requireUser();
  if (user.role !== "admin" && !user.bisaBongkaran) {
    throw forbidden("Anda belum diberi akses ke menu Bongkaran.");
  }
  return user;
}

/** Akses modul Cancel Order. Admin selalu boleh. */
export async function requireCancelOrder() {
  const user = await requireUser();
  if (user.role !== "admin" && !user.bisaCancelOrder) {
    throw forbidden("Anda belum diberi akses ke menu Cancel Order.");
  }
  return user;
}

/**
 * Boleh membaca Master Produk (dan cache-nya di PDT).
 *
 * Dipisah dari izin per-modul karena master produk BUKAN milik satu modul:
 * Bongkaran dan Cancel Order sama-sama mencocokkan barcode ke SKU yang
 * sama. Kalau sinkron cache dijaga oleh requireBongkaran(), operator yang
 * hanya diberi akses Cancel Order akan melihat semua barcode-nya "tidak
 * dikenal" — dan penyebabnya tidak akan terlihat di mana pun.
 */
export async function requireMasterProduk() {
  const user = await requireUser();
  if (user.role !== "admin" && !user.bisaBongkaran && !user.bisaCancelOrder) {
    throw forbidden("Anda belum diberi akses ke data produk.");
  }
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
