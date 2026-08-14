import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/api";
import { todayWIB, shiftDays } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard — angka ringkas untuk halaman depan.
 *
 * Semuanya dihitung dengan agregasi di database (COUNT / GROUP BY),
 * bukan dengan menarik seluruh dokumen lalu menghitung di klien seperti
 * sistem lama. Bedanya bukan cuma soal cepat: di Firestore pola lama itu
 * memakan satu kuota baca per dokumen, sehingga membuka dashboard beberapa
 * kali sehari saja sudah menggerus jatah harian.
 */
export async function GET() {
  return handle(async () => {
    await requireUser();

    const hariIni = todayWIB();
    const awal7Hari = shiftDays(-6, hariIni);

    const [
      totalHariIni,
      karungHariIni,
      karungTerbuka,
      totalKeseluruhan,
      perEkspedisiHariIni,
      per7Hari,
    ] = await Promise.all([
      prisma.scan.count({ where: { date: hariIni, status: "success" } }),
      prisma.karung.count({ where: { date: hariIni } }),
      prisma.karung.count({ where: { date: hariIni, status: { not: "locked" } } }),
      prisma.scan.count({ where: { status: "success" } }),
      prisma.scan.groupBy({
        by: ["expedisiId"],
        where: { date: hariIni, status: "success" },
        _count: { _all: true },
      }),
      prisma.scan.groupBy({
        by: ["date"],
        where: { date: { gte: awal7Hari, lte: hariIni }, status: "success" },
        _count: { _all: true },
      }),
    ]);

    // Lengkapi nama ekspedisi untuk hasil groupBy
    const ids = perEkspedisiHariIni.map((r) => r.expedisiId);
    const eks = ids.length
      ? await prisma.expedisi.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const namaById = new Map(eks.map((e) => [e.id, e]));

    const perEkspedisi = perEkspedisiHariIni
      .map((r) => ({
        expedisiId: r.expedisiId,
        name: namaById.get(r.expedisiId)?.name ?? "(tidak dikenal)",
        code: namaById.get(r.expedisiId)?.code ?? "",
        jumlah: r._count._all,
      }))
      .sort((a, b) => b.jumlah - a.jumlah);

    // Isi tanggal yang kosong dengan 0 supaya grafik 7 hari tidak berlubang
    const petaHarian = new Map(per7Hari.map((r) => [r.date, r._count._all]));
    const harian: { date: string; jumlah: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = shiftDays(-i, hariIni);
      harian.push({ date: d, jumlah: petaHarian.get(d) ?? 0 });
    }

    return {
      tanggal: hariIni,
      totalHariIni,
      karungHariIni,
      karungTerbuka,
      totalKeseluruhan,
      perEkspedisi,
      harian,
    };
  });
}
