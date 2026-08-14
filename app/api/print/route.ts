import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireUser, badRequest, notFound } from "@/lib/api";
import { sheetDateName, timeWIB } from "@/lib/date";
import { KARUNG_INCLUDE, toKarung, type KarungRow } from "@/lib/karung";
import { bacaSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/print?karungIds=id1,id2,...
 *
 * Menyediakan SEMUA yang dibutuhkan halaman tanda terima dalam satu panggilan:
 * daftar karung, baris resi yang sudah siap cetak, dan info perusahaan.
 *
 * PERUBAHAN PALING PENTING DARI SISTEM LAMA:
 * dulu halaman ini membaca Google Sheets. Akibatnya, resi yang gagal
 * tersinkron — dan karena bug kuota, jumlahnya tidak sedikit — TIDAK IKUT
 * TERCETAK di tanda terima, walaupun tercatat rapi di history. Tanda terima
 * yang ditandatangani ekspedisi jadi kurang dari barang yang benar-benar
 * diterima. Sekarang sumbernya database, jadi yang tercetak persis sama
 * dengan yang di-scan.
 *
 * Bentuk `rows` sengaja dipertahankan sama seperti dulu
 *   [No, Kode Resi, No. Karung, Di Scan Oleh, Tanggal, Jam]
 * supaya seluruh tata letak dan kalibrasi kertas yang sudah teruji
 * tidak perlu diubah sama sekali.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();

    const ids = (req.nextUrl.searchParams.get("karungIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) throw badRequest("Sertakan karungIds.");
    if (ids.length > 50) throw badRequest("Maksimal 50 karung sekali cetak.");

    const karungRaw = await prisma.karung.findMany({
      where: { id: { in: ids } },
      include: KARUNG_INCLUDE,
    });
    if (karungRaw.length === 0) throw notFound("Karung tidak ditemukan.");

    const karung = (karungRaw as unknown as KarungRow[])
      .map(toKarung)
      // Urut angka kalau nomornya angka, kalau tidak urut teks —
      // supaya "10" tidak muncul sebelum "2".
      .sort((a, b) => {
        const na = parseInt(a.nomorKarung, 10);
        const nb = parseInt(b.nomorKarung, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.nomorKarung.localeCompare(b.nomorKarung, "id");
      });

    // Satu tanda terima = satu ekspedisi, satu tanggal. Dulu ini hanya
    // diasumsikan; sekarang divalidasi supaya tidak ada dokumen campur
    // yang lolos ke tanda tangan.
    const expedisiIds = new Set(karung.map((k) => k.expedisiId));
    if (expedisiIds.size > 1) {
      throw badRequest(
        "Karung yang dipilih berasal dari ekspedisi berbeda. " +
          "Satu tanda terima hanya untuk satu ekspedisi."
      );
    }
    const tanggalSet = new Set(karung.map((k) => k.date));
    if (tanggalSet.size > 1) {
      throw badRequest(
        "Karung yang dipilih berasal dari tanggal berbeda. " +
          "Satu tanda terima hanya untuk satu tanggal."
      );
    }

    const scans = await prisma.scan.findMany({
      where: { karungId: { in: karung.map((k) => k.id) }, status: "success" },
      include: {
        karung: { select: { nomorKarung: true } },
        scannedBy: { select: { name: true } },
      },
      orderBy: [{ karungId: "asc" }, { scannedAt: "asc" }],
    });

    const rows = scans.map((s, i) => [
      String(i + 1),
      s.noResi,
      s.karung.nomorKarung,
      s.scannedBy.name,
      sheetDateName(s.date), // "25-06-2026", sama dengan format lama
      timeWIB(s.scannedAt),
    ]);

    const settings = await bacaSettings();

    return {
      karung,
      rows,
      total: rows.length,
      expedisiName: karung[0].expedisiName,
      expedisiCode: karung[0].expedisiCode,
      date: karung[0].date,
      settings: {
        namaPerusahaan: settings.namaPerusahaan,
        noteTandaTerima: settings.noteTandaTerima,
      },
    };
  });
}
