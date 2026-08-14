import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireUser, requireAdmin, badRequest, writeAudit } from "@/lib/api";
import { bacaSettings, ambilSpreadsheetId } from "@/lib/settings";
import type { CompanySettings } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return { settings: await bacaSettings() };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();
    const body = (await req.json()) as Partial<CompanySettings>;

    const data: Record<string, string> = {};

    if (body.namaPerusahaan !== undefined) {
      const v = String(body.namaPerusahaan).trim();
      if (!v) throw badRequest("Nama perusahaan wajib diisi.");
      if (v.length > 191) throw badRequest("Nama perusahaan terlalu panjang.");
      data.namaPerusahaan = v;
    }
    if (body.noteTandaTerima !== undefined) {
      data.noteTandaTerima = String(body.noteTandaTerima).trim();
    }
    if (body.spreadsheetId !== undefined) {
      data.spreadsheetId = ambilSpreadsheetId(body.spreadsheetId);
    }
    if (body.claimMasterSpreadsheetId !== undefined) {
      data.claimMasterSpreadsheetId = ambilSpreadsheetId(body.claimMasterSpreadsheetId);
    }

    if (Object.keys(data).length === 0) return { settings: await bacaSettings() };

    await bacaSettings(); // pastikan barisnya ada sebelum update
    await prisma.settings.update({
      where: { id: 1 },
      data: { ...data, updatedBy: me.id },
    });
    await writeAudit(
      me.id, me.name, "UPDATE_SETTINGS",
      `Ubah pengaturan: ${Object.keys(data).join(", ")}`
    );

    return { settings: await bacaSettings() };
  });
}
