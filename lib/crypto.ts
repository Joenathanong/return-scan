/**
 * Kriptografi untuk auth — SENGAJA hanya memakai `node:crypto` bawaan Node.
 *
 * Tidak ada bcrypt / argon2 (perlu kompilasi native saat npm install, sering
 * gagal di Windows) dan tidak ada jsonwebtoken / jose (dependency tambahan).
 * scrypt dan HMAC-SHA256 sudah ada di dalam Node dan lebih dari cukup.
 *
 * File ini HANYA boleh dipakai di runtime Node (API route / server action),
 * TIDAK di middleware (yang berjalan di Edge dan tidak punya node:crypto).
 */

import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

// ─── Password ────────────────────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;

/** Format tersimpan: `scrypt$<salt hex>$<hash hex>` */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

/** Perbandingan waktu-konstan — tidak bocor lewat lama eksekusi. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const dk = scryptSync(password, salt, SCRYPT_KEYLEN);
    const known = Buffer.from(hash, "hex");
    if (known.length !== dk.length) return false;
    return timingSafeEqual(dk, known);
  } catch {
    return false;
  }
}

/** Aturan minimal password. Dipakai saat buat user & ganti password. */
export function validatePassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) {
    return "Password minimal 8 karakter.";
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return "Password harus mengandung huruf dan angka.";
  }
  return null;
}

// ─── Token sesi ──────────────────────────────────────────────────────────────

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  role: "admin" | "operator";
  /**
   * Id sesi — dibuat baru setiap kali login berhasil dan disalin ke kolom
   * `users.sesi_aktif`. requireUser() membandingkan keduanya di setiap
   * request; kalau berbeda, berarti akun ini sudah login di perangkat lain
   * dan perangkat ini harus diputus.
   *
   * OPSIONAL di tipe (bukan di praktik) semata-mata supaya cookie yang
   * terlanjur terbit SEBELUM fitur ini dipasang tidak langsung dianggap
   * palsu. Cookie lama tanpa `sid` diperlakukan sebagai sesi kedaluwarsa —
   * pemiliknya diminta login sekali lagi, bukan melihat pesan error.
   */
  sid?: string;
  exp: number; // epoch detik
}

/** Id sesi acak, 32 karakter hex. Muat di VarChar(64). */
export function buatSid(): string {
  return randomBytes(16).toString("hex");
}

const b64u = {
  enc: (buf: Buffer) => buf.toString("base64url"),
  dec: (s: string) => Buffer.from(s, "base64url"),
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET belum diisi di .env (minimal 32 karakter). " +
        "Buat dengan: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return s;
}

/** Token: `<payload base64url>.<hmac base64url>` */
export function signSession(
  payload: Omit<SessionPayload, "exp">,
  maxAgeSeconds: number
): string {
  const body: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const data = b64u.enc(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64u.enc(createHmac("sha256", secret()).update(data).digest());
  return `${data}.${sig}`;
}

/** Mengembalikan payload kalau tanda tangan sah DAN belum kedaluwarsa. */
export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  try {
    const expected = createHmac("sha256", secret()).update(data).digest();
    const got = b64u.dec(sig);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return null;
    }
    const payload = JSON.parse(b64u.dec(data).toString("utf8")) as SessionPayload;
    if (!payload?.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
