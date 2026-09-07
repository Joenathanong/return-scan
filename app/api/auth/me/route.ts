import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, SESSION_COOKIE } from "@/lib/api";
import type { SessionUser, UserRole } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Dipanggil sekali saat aplikasi dibuka untuk memulihkan sesi.
 * Sengaja membaca ulang dari database (bukan percaya isi cookie) supaya
 * perubahan role atau penonaktifan akun langsung berlaku.
 *
 * Mengembalikan 200 dengan `user: null` — bukan 401 — supaya halaman login
 * tidak memunculkan error di console saat pengunjung memang belum login.
 */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: s.uid },
    select: {
      id: true, email: true, name: true, role: true,
      active: true, mustChangePassword: true,
      sesiAktif: true, bisaBongkaran: true,
    },
  });

  if (!user || !user.active) return NextResponse.json({ user: null });

  // Sesi sudah diambil alih perangkat lain (atau dilepas admin). Dibalas
  // 200 dengan `user: null` + alasan — BUKAN 401 — supaya konsisten dengan
  // perilaku endpoint ini yang lain, dan supaya halaman login bisa
  // menjelaskan kenapa orangnya tiba-tiba ada di sana.
  if (!s.sid || user.sesiAktif !== s.sid) {
    const res = NextResponse.json({ user: null, alasan: "SESI_DIGANTI" });
    // Cookie ikut dibuang — kalau dibiarkan, middleware akan terus
    // menganggap orangnya sudah login dan memantulkannya dari /login ke
    // /dashboard tanpa henti. Endpoint ini membalas 200 sehingga tidak
    // lewat penanganan di handle(), jadi harus diurus sendiri di sini.
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const isAdmin = user.role === "admin";
  const out: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (isAdmin ? "admin" : "operator") as UserRole,
    mustChangePassword: user.mustChangePassword,
    bisaBongkaran: isAdmin || user.bisaBongkaran,
  };
  return NextResponse.json({ user: out });
}
