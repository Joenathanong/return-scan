import { NextRequest } from "next/server";
import { prisma, isUniqueViolation } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/crypto";
import {
  handle, requireAdmin, badRequest, conflict, requireString, writeAudit,
} from "@/lib/api";
import type { AppUser } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toUser = (u: {
  id: string; email: string; name: string; role: string; active: boolean;
  mustChangePassword: boolean; createdAt: Date; lastLogin: Date | null;
}): AppUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role === "admin" ? "admin" : "operator",
  active: u.active,
  mustChangePassword: u.mustChangePassword,
  createdAt: u.createdAt.toISOString(),
  lastLogin: u.lastLogin?.toISOString() ?? null,
});

const PILIH = {
  id: true, email: true, name: true, role: true,
  active: true, mustChangePassword: true, createdAt: true, lastLogin: true,
} as const;

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const rows = await prisma.user.findMany({
      select: PILIH,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return { rows: rows.map(toUser) };
  });
}

/**
 * POST /api/users — buat akun baru.
 *
 * Password awal ditentukan admin dan langsung ditandai `mustChangePassword`,
 * jadi user WAJIB menggantinya saat login pertama. Admin tidak pernah tahu
 * password permanen siapa pun — hash-nya scrypt, tidak bisa dibalik.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();
    const body = (await req.json()) as {
      email?: string; name?: string; role?: string; password?: string;
    };

    const email = requireString(body.email, "Email", 191).toLowerCase();
    const name = requireString(body.name, "Nama", 191);
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "operator";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest("Format email tidak valid.");
    }
    const salah = validatePassword(password);
    if (salah) throw badRequest(salah);

    try {
      const dibuat = await prisma.user.create({
        data: {
          email, name, role, active: true,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          createdBy: me.id,
        },
        select: PILIH,
      });
      await writeAudit(me.id, me.name, "CREATE_USER", `Buat user ${email} (${role})`);
      return { user: toUser(dibuat) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(`Email ${email} sudah dipakai akun lain.`, "EMAIL_TAKEN");
      }
      throw err;
    }
  });
}
