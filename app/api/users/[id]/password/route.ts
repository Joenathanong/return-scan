import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/crypto";
import { handle, requireAdmin, badRequest, notFound, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/users/[id]/password — admin men-set password user lain.
 *
 * Dipakai untuk dua hal: reset password yang lupa, dan memberi password
 * awal ke akun yang terbawa dari sistem lama (Firebase Auth tidak pernah
 * mengekspor hash password, jadi akun hasil seed memang belum bisa login).
 *
 * Hasilnya selalu ditandai `mustChangePassword`, jadi password yang
 * diketahui admin tidak akan pernah jadi password permanen si user.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as { password?: string };
    const password = String(body.password ?? "");

    const salah = validatePassword(password);
    if (salah) throw badRequest(salah);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!target) throw notFound("User tidak ditemukan.");

    // Reset password juga MELEPAS ikatan perangkat. Alasannya: password
    // direset justru ketika user tidak bisa masuk — sering karena PDT-nya
    // hilang atau rusak dalam keadaan masih login. Kalau ikatannya tidak
    // dilepas, user tetap bisa login (login terbaru menang), tapi kolom
    // "Sedang login di" akan terus menunjuk perangkat yang sudah tiada.
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: hashPassword(password),
        mustChangePassword: true,
        sesiAktif: null,
        perangkatLabel: null,
        sesiSejak: null,
      },
    });
    await writeAudit(
      me.id, me.name, "RESET_PASSWORD",
      `Set password untuk ${target.email}`
    );

    return { ok: true, email: target.email };
  });
}
