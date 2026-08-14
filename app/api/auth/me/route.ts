import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/api";
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
    },
  });

  if (!user || !user.active) return NextResponse.json({ user: null });

  const out: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: (user.role === "admin" ? "admin" : "operator") as UserRole,
    mustChangePassword: user.mustChangePassword,
  };
  return NextResponse.json({ user: out });
}
