import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireUser, requireAdmin, badRequest, conflict,
  requireString, writeAudit,
} from "@/lib/api";
import { KODE_RE, saranKode, PESAN_KODE_TIDAK_VALID } from "@/lib/expedisi";
import type { Expedisi } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toExpedisi = (e: {
  id: string; code: string; name: string; active: boolean; createdAt: Date;
}): Expedisi => ({
  id: e.id, code: e.code, name: e.name, active: e.active,
  createdAt: e.createdAt.toISOString(),
});

// ─── GET /api/expedisi ───────────────────────────────────────────────────────

/** ?all=1 untuk ikut menampilkan yang nonaktif (dipakai halaman admin). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const all = req.nextUrl.searchParams.get("all") === "1";

    const rows = await prisma.expedisi.findMany({
      where: all ? {} : { active: true },
      orderBy: { name: "asc" },
    });
    return { rows: rows.map(toExpedisi) };
  });
}

// ─── POST /api/expedisi ──────────────────────────────────────────────────────

/**
 * Membuat ekspedisi baru.
 *
 * BEDA PENTING dari sistem lama: `code` diisi eksplisit dan diuji keunikannya.
 * Dulu kode dihitung dari nama dengan `.slice(0, 20)` tanpa uji apa pun,
 * sehingga dua ekspedisi yang 20 karakter pertamanya sama diam-diam berbagi
 * satu tab G-Sheet dan datanya tercampur.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();
    const body = (await req.json()) as { name?: string; code?: string };

    const name = requireString(body.name, "Nama ekspedisi", 191);
    const code = String(body.code ?? "").trim().toUpperCase() || saranKode(name);

    if (!KODE_RE.test(code)) throw badRequest(PESAN_KODE_TIDAK_VALID);

    if (await prisma.expedisi.findUnique({ where: { code } })) {
      throw conflict(`Kode "${code}" sudah dipakai ekspedisi lain.`, "CODE_TAKEN");
    }
    const namaSama = await prisma.expedisi.findFirst({ where: { name } });
    if (namaSama) {
      throw conflict(`Ekspedisi "${name}" sudah terdaftar.`, "NAME_TAKEN");
    }

    const created = await prisma.expedisi.create({
      data: { name, code, active: true, createdBy: me.id },
    });
    await writeAudit(me.id, me.name, "CREATE_EXPEDISI", `Buat ekspedisi ${name} (${code})`);

    return { expedisi: toExpedisi(created) };
  });
}
