import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession } from "@/lib/crypto";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  writeAudit,
} from "@/lib/api";
import type { SessionUser, UserRole } from "@/types";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 *
 * Pesan error sengaja SAMA untuk email tidak ada dan password salah
 * ("Email atau password salah") supaya tidak bisa dipakai menebak
 * email mana yang terdaftar.
 */
export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email dan password wajib diisi." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Perbandingan tetap dijalankan walau user tidak ada, memakai hash palsu,
    // supaya lama respons tidak membocorkan apakah email itu terdaftar.
    const stored =
      user?.passwordHash ??
      "scrypt$0000000000000000000000000000000000000000000000000000000000000000$00";
    const cocok = verifyPassword(password, stored);

    if (!user || !cocok) {
      await writeAudit(null, email || "(kosong)", "LOGIN_GAGAL", `Login gagal: ${email}`);
      return NextResponse.json(
        { error: "Email atau password salah." },
        { status: 401 }
      );
    }

    if (!user.active) {
      await writeAudit(user.id, user.name, "LOGIN_DITOLAK", "Akun nonaktif");
      return NextResponse.json(
        { error: "Akun Anda dinonaktifkan. Hubungi admin." },
        { status: 403 }
      );
    }

    const role: UserRole = user.role === "admin" ? "admin" : "operator";
    const token = signSession(
      { uid: user.id, email: user.email, name: user.name, role },
      SESSION_MAX_AGE
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    await writeAudit(user.id, user.name, "LOGIN", "Login berhasil");

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      mustChangePassword: user.mustChangePassword,
    };

    const res = NextResponse.json({ user: sessionUser });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,      // tidak bisa dibaca JavaScript — beda dari sistem
                           // lama yang menaruh uid di cookie biasa
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error("[scan-retur] login error:", err);
    return NextResponse.json({ error: "Gagal memproses login." }, { status: 500 });
  }
}
