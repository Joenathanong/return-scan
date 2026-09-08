import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireBongkaran, badRequest, notFound, writeAudit,
} from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/bongkaran/[id]/finalkan — jadikan draft ini data final.
 *
 * KENAPA INI ADA, padahal draft seharusnya selalu kosong:
 *
 * Alur normal menulis barang dan mengubah status jadi `final` di dalam SATU
 * transaksi, jadi draft yang tertinggal memang tidak pernah memuat barang —
 * kalau penulisannya gagal, keduanya batal bersama. Itu sebabnya dashboard
 * berani bilang "aman dibuang".
 *
 * Tapi "seharusnya" bukan "pasti". Data bisa datang dari versi aplikasi yang
 * lebih tua, dari perbaikan manual di database, atau dari bug yang belum
 * ketahuan. Kalau suatu saat ada draft yang ternyata BERISI, membuangnya
 * berarti membuang pekerjaan orang — dan satu-satunya tombol yang tersedia
 * saat itu adalah "Buang". Endpoint ini menutup lubang itu.
 *
 * Draft kosong TIDAK bisa difinalkan: resi tanpa satu pun barang bukan data,
 * ia hanya akan muncul di laporan sebagai baris hampa yang tidak bisa
 * dijelaskan siapa pun.
 *
 * Waktu tidak disentuh — `scanned_at` tetap saat resinya di-scan.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireBongkaran();
    const { id } = await params;

    const row = await prisma.bongkaran.findUnique({
      where: { id },
      select: {
        id: true, noResi: true, status: true, scannedById: true,
        _count: { select: { items: true } },
        items: { select: { sku: true, batch: true, edDate: true } },
      },
    });
    if (!row) throw notFound("Draft bongkaran tidak ditemukan.");

    if (row.status === "final") return { ok: true, sudahFinal: true };
    if (row.status !== "draft") {
      throw badRequest("Data ini sudah dibatalkan — tidak bisa difinalkan.");
    }
    if (row._count.items === 0) {
      throw badRequest(
        "Draft ini benar-benar kosong — tidak ada barang yang bisa disimpan. " +
          "Scan ulang resinya di layar Bongkaran."
      );
    }
    if (row.scannedById !== me.id && me.role !== "admin") {
      throw badRequest("Draft ini milik operator lain.");
    }

    await prisma.bongkaran.update({
      where: { id },
      data: { status: "final", finalizedAt: new Date() },
    });

    // Saran batch ikut diperkaya, sama seperti jalur simpan yang normal —
    // kalau tidak, batch dari baris ini tidak akan pernah muncul sebagai
    // saran walau datanya sah.
    const pasangan = new Map<string, { sku: string; batch: string; edDate: string }>();
    for (const i of row.items) {
      if (i.sku && i.batch && i.edDate) {
        pasangan.set(`${i.sku}|${i.batch}`, { sku: i.sku, batch: i.batch, edDate: i.edDate });
      }
    }
    await Promise.all(
      [...pasangan.values()].map((b) =>
        prisma.batchSku
          .upsert({
            where: { sku_batch: { sku: b.sku, batch: b.batch } },
            create: { sku: b.sku, batch: b.batch, edDate: b.edDate },
            update: { dipakai: { increment: 1 } },
          })
          .catch((err: unknown) => {
            console.error("[bongkaran] gagal simpan saran batch:", err);
          })
      )
    );

    await writeAudit(
      me.id, me.name, "BONGKARAN_FINALKAN_DRAFT",
      `${row.noResi} difinalkan dari draft — ${row._count.items} barang`,
      { bongkaranId: row.id }
    );

    return { ok: true, noResi: row.noResi, jumlahBarang: row._count.items };
  });
}
