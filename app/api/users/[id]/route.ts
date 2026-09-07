import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireAdmin, badRequest, notFound, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * PATCH /api/users/[id] — ubah nama, role, atau status aktif.
 *
 * Dua pengaman yang tidak ada di sistem lama:
 *   • Admin tidak bisa menonaktifkan atau menurunkan dirinya sendiri —
 *     mencegah organisasi terkunci dari sistemnya sendiri.
 *   • Admin terakhir yang masih aktif tidak boleh dinonaktifkan atau
 *     diturunkan jadi operator.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string; role?: string; active?: boolean; bisaBongkaran?: boolean;
    };

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound("User tidak ditemukan.");

    const data: {
      name?: string; role?: string; active?: boolean;
      bisaBongkaran?: boolean; sesiAktif?: null;
      perangkatLabel?: null; sesiSejak?: null;
    } = {};

    if (body.name !== undefined) {
      const v = String(body.name).trim();
      if (!v) throw badRequest("Nama wajib diisi.");
      if (v.length > 191) throw badRequest("Nama terlalu panjang.");
      data.name = v;
    }
    if (body.role !== undefined) data.role = body.role === "admin" ? "admin" : "operator";
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.bisaBongkaran !== undefined) {
      data.bisaBongkaran = Boolean(body.bisaBongkaran);
    }

    const turunJadiOperator = data.role === "operator" && target.role === "admin";
    const dinonaktifkan = data.active === false;

    if (target.id === me.id && (turunJadiOperator || dinonaktifkan)) {
      throw badRequest(
        "Anda tidak bisa menonaktifkan atau menurunkan akun Anda sendiri. " +
          "Minta admin lain melakukannya."
      );
    }

    if (turunJadiOperator || dinonaktifkan) {
      const adminAktif = await prisma.user.count({
        where: { role: "admin", active: true },
      });
      if (adminAktif <= 1 && target.role === "admin" && target.active) {
        throw badRequest(
          "Ini satu-satunya admin yang aktif. Angkat admin lain dulu " +
            "sebelum mengubah akun ini."
        );
      }
    }

    if (Object.keys(data).length === 0) return { ok: true, tidakAdaPerubahan: true };

    // Menonaktifkan akun sekaligus melepas ikatan perangkatnya. Tanpa ini,
    // baris user yang sudah nonaktif tetap menyandera slot perangkat, dan
    // saat akun itu diaktifkan lagi kolomnya masih menunjuk sesi lama yang
    // sudah tidak ada — membingungkan di kolom "Sedang login di".
    if (data.active === false) {
      data.sesiAktif = null;
      data.perangkatLabel = null;
      data.sesiSejak = null;
    }

    await prisma.user.update({ where: { id }, data });

    const jejak: string[] = [];
    if (data.name) jejak.push(`nama → "${data.name}"`);
    if (data.role) jejak.push(`role → ${data.role}`);
    if (data.active !== undefined) jejak.push(data.active ? "diaktifkan" : "dinonaktifkan");
    if (data.bisaBongkaran !== undefined) {
      jejak.push(data.bisaBongkaran ? "akses bongkaran diberikan" : "akses bongkaran dicabut");
    }
    await writeAudit(
      me.id, me.name, "UPDATE_USER",
      `User ${target.email}: ${jejak.join(", ")}`
    );

    return { ok: true };
  });
}

/**
 * User TIDAK PERNAH dihapus — hanya dinonaktifkan.
 * Menghapusnya akan memutus jejak siapa yang men-scan resi apa.
 */
export async function DELETE() {
  return handle(async () => {
    await requireAdmin();
    throw badRequest(
      "User tidak bisa dihapus, hanya dinonaktifkan — supaya jejak siapa " +
        "yang men-scan setiap resi tetap utuh."
    );
  });
}
