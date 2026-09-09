import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireAdmin, badRequest, notFound, cleanResi, writeAudit,
} from "@/lib/api";
import { tanpaResi, AWALAN_TANPA_RESI, CATATAN_MAKS } from "@/lib/bongkaran";
import { bersihkanNama } from "@/lib/produk";

export const runtime = "nodejs";

/**
 * PATCH /api/bongkaran/[id]/resi — mengisi nomor resi yang tadinya tidak
 * terbaca.
 *
 * SATU-SATUNYA arah yang diizinkan: dari nomor pengganti buatan sistem ke
 * nomor resi sungguhan. Bukan ganti-nomor untuk umum.
 *
 * Kenapa dibatasi begitu ketat: nomor resi adalah kunci yang menghubungkan
 * baris bongkaran ke Scan Retur, dan lewat sana ke ekspedisi serta karung
 * asalnya. Kalau nomor resi baris mana pun boleh diganti belakangan, maka
 * setiap laporan yang pernah dicetak bisa berbeda dari laporan yang sama
 * yang dicetak besok, tanpa satu pun tanda. Baris tanpa resi adalah
 * pengecualian yang sah karena di sana nomornya memang belum pernah ada —
 * mengisinya menambah informasi, bukan menulis ulang informasi.
 *
 * WAKTU TIDAK IKUT BERUBAH, sama seperti koreksi baris: `scanned_at`
 * menunjuk saat paket itu dibongkar, bukan saat resinya ditemukan.
 *
 * Admin saja. Ini pekerjaan menyambungkan data, bukan pekerjaan membongkar.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;

    const body = (await req.json()) as { noResi?: string; catatan?: string };

    const noResiBaru = cleanResi(body.noResi);
    if (!noResiBaru) throw badRequest("Nomor resi wajib diisi.");
    if (noResiBaru.length > 64) throw badRequest("Nomor resi terlalu panjang.");
    if (tanpaResi(noResiBaru)) {
      throw badRequest(
        `Nomor resi tidak boleh diawali "${AWALAN_TANPA_RESI}" — awalan itu ` +
          "dipakai sistem untuk paket yang labelnya tidak terbaca."
      );
    }

    const lama = await prisma.bongkaran.findUnique({
      where: { id },
      select: { id: true, noResi: true, status: true, catatan: true, date: true },
    });
    if (!lama) throw notFound("Data bongkaran tidak ditemukan.");

    if (!tanpaResi(lama.noResi)) {
      throw badRequest(
        `Resi ${lama.noResi} bukan baris tanpa resi, jadi nomornya tidak bisa ` +
          "diganti dari sini. Kalau nomornya memang salah ketik, baris ini " +
          "perlu dibatalkan lalu di-scan ulang supaya jejaknya jelas."
      );
    }
    if (lama.status === "voided") {
      throw badRequest("Baris ini sudah dibatalkan.");
    }

    const catatan =
      body.catatan === undefined
        ? lama.catatan
        : bersihkanNama(body.catatan).slice(0, CATATAN_MAKS) || null;

    await prisma.bongkaran.update({
      where: { id },
      data: { noResi: noResiBaru, catatan },
    });

    /*
      Apakah nomor barunya sudah ada di Scan Retur?

      Dijawab di sini, bukan dibiarkan ditemukan sendiri di ekspor. Kalau
      tidak ketemu, kemungkinan besar nomornya salah salin — dan lebih baik
      diberitahukan sekarang, selagi orangnya masih memegang paketnya,
      daripada muncul sebagai kolom Expedisi kosong sebulan kemudian.
    */
    const diScanRetur = await prisma.scan.findFirst({
      where: { noResi: noResiBaru, status: "success" },
      select: { expedisi: { select: { name: true } }, date: true },
    });

    await writeAudit(
      me.id, me.name, "BONGKARAN_ISI_RESI",
      `${lama.noResi} → ${noResiBaru}`,
      { bongkaranId: id, tanggal: lama.date, catatan }
    );

    return {
      ok: true,
      id,
      noResi: noResiBaru,
      catatan: catatan ?? "",
      expedisi: diScanRetur?.expedisi.name ?? "",
      pesan: diScanRetur
        ? `Nomor resi diisi: ${noResiBaru} — cocok dengan Scan Retur (${diScanRetur.expedisi.name}, ${diScanRetur.date}).`
        : `Nomor resi diisi: ${noResiBaru}. Belum ada padanannya di Scan Retur, jadi kolom Expedisi masih kosong — periksa lagi kalau nomornya hasil menebak digit yang buram.`,
    };
  });
}
