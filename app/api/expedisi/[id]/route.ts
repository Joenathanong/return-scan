import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireAdmin, badRequest, conflict, notFound, writeAudit,
} from "@/lib/api";

export const runtime = "nodejs";

/**
 * PATCH /api/expedisi/[id] — ubah nama dan/atau status aktif.
 *
 * `code` SENGAJA TIDAK BISA DIUBAH lewat endpoint ini.
 *
 * Inilah perbaikan untuk bug "tab yatim" di sistem lama: di sana setiap
 * penyimpanan menghitung ulang `code` dari nama, sehingga meralat satu
 * huruf pada nama ekspedisi langsung mengubah nama tab G-Sheet dan
 * memutus hubungan dengan seluruh data sebelumnya. Sekarang nama boleh
 * berubah kapan saja tanpa efek samping ke mana pun.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as { name?: string; active?: boolean };

    const current = await prisma.expedisi.findUnique({ where: { id } });
    if (!current) throw notFound("Ekspedisi tidak ditemukan.");

    const data: { name?: string; active?: boolean } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("Nama ekspedisi wajib diisi.");
      if (name.length > 191) throw badRequest("Nama terlalu panjang.");
      if (name !== current.name) {
        const bentrok = await prisma.expedisi.findFirst({
          where: { name, id: { not: id } },
        });
        if (bentrok) throw conflict(`Ekspedisi "${name}" sudah terdaftar.`);
        data.name = name;
      }
    }

    if (body.active !== undefined) data.active = Boolean(body.active);
    if (Object.keys(data).length === 0) return { ok: true, tidakAdaPerubahan: true };

    const updated = await prisma.expedisi.update({ where: { id }, data });

    const jejak: string[] = [];
    if (data.name) jejak.push(`nama "${current.name}" → "${data.name}"`);
    if (data.active !== undefined) jejak.push(data.active ? "diaktifkan" : "dinonaktifkan");
    await writeAudit(
      me.id, me.name, "UPDATE_EXPEDISI",
      `Ekspedisi ${current.code}: ${jejak.join(", ")}`
    );

    return { ok: true, expedisi: { ...updated, createdAt: updated.createdAt.toISOString() } };
  });
}

/**
 * DELETE /api/expedisi/[id]
 *
 * Hanya boleh kalau BELUM PERNAH dipakai. Kalau sudah ada karung atau scan,
 * hapus ditolak dan disarankan menonaktifkan saja — supaya tidak ada data
 * lama yang menggantung tanpa induk. (Di sistem lama, ekspedisi bisa dihapus
 * dan scan lamanya jadi yatim.)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;

    const exp = await prisma.expedisi.findUnique({ where: { id } });
    if (!exp) throw notFound("Ekspedisi tidak ditemukan.");

    const [jmlScan, jmlKarung] = await Promise.all([
      prisma.scan.count({ where: { expedisiId: id } }),
      prisma.karung.count({ where: { expedisiId: id } }),
    ]);

    if (jmlScan > 0 || jmlKarung > 0) {
      throw conflict(
        `Tidak bisa dihapus — sudah punya ${jmlKarung} karung dan ${jmlScan} resi. ` +
          `Nonaktifkan saja supaya tidak muncul lagi saat scan.`,
        "IN_USE"
      );
    }

    await prisma.claimExpedisiSheet.deleteMany({ where: { expedisiId: id } });
    await prisma.expedisi.delete({ where: { id } });
    await writeAudit(me.id, me.name, "DELETE_EXPEDISI", `Hapus ekspedisi ${exp.name} (${exp.code})`);

    return { ok: true };
  });
}
