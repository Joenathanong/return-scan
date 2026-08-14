import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/crypto";
import { handle, requireUser, badRequest, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/auth/password — user mengganti password SENDIRI.
 *
 * Wajib menyertakan password lama, termasuk untuk user hasil seed yang
 * `mustChangePassword`-nya true. (Untuk akun yang belum pernah punya
 * password, admin yang men-set-kan lewat /api/users/[id]/password.)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireUser();
    const body = (await req.json()) as {
      passwordLama?: string;
      passwordBaru?: string;
    };

    const lama = String(body.passwordLama ?? "");
    const baru = String(body.passwordBaru ?? "");

    const salah = validatePassword(baru);
    if (salah) throw badRequest(salah);
    if (lama === baru) throw badRequest("Password baru harus berbeda dari yang lama.");

    const row = await prisma.user.findUnique({
      where: { id: me.id },
      select: { passwordHash: true },
    });
    if (!row || !verifyPassword(lama, row.passwordHash)) {
      throw badRequest("Password lama salah.");
    }

    await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: hashPassword(baru), mustChangePassword: false },
    });
    await writeAudit(me.id, me.name, "GANTI_PASSWORD", "Password diganti sendiri");

    return { ok: true };
  });
}
