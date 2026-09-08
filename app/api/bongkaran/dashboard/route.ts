import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran } from "@/lib/api";
import { todayWIB, shiftDays } from "@/lib/date";
import { KONDISI, KAMERA, type Kondisi } from "@/lib/bongkaran";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HARI_GRAFIK = 14;

/**
 * GET /api/bongkaran/dashboard?tanggal=YYYY-MM-DD
 *
 * Semua angka dihitung dengan groupBy/count di database — tidak ada baris
 * yang ditarik ke server lalu dijumlahkan di JavaScript. Di sistem lama
 * jumlah resi disimpan sebagai penghitung manual yang lama-lama meleset
 * dari isi sebenarnya; di sini tidak ada penghitung yang bisa meleset,
 * karena tidak ada penghitung.
 *
 * Baris `voided` dikecualikan di mana-mana kecuali di daftar draft.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireBongkaran();

    const url = new URL(req.url);
    const tanggal = url.searchParams.get("tanggal") || todayWIB();
    const mulai = shiftDays(-(HARI_GRAFIK - 1), tanggal);

    const [
      resiHariIni,
      barangHariIni,
      perKondisi,
      perHari,
      perOperator,
      draft,
      barcodeAsing,
      waktuMeragukan,
      perKamera,
    ] = await Promise.all([
      prisma.bongkaran.count({ where: { date: tanggal, status: "final" } }),

      prisma.bongkaranItem.count({
        where: { bongkaran: { date: tanggal, status: "final" } },
      }),

      prisma.bongkaranItem.groupBy({
        by: ["kondisi"],
        where: { bongkaran: { date: tanggal, status: "final" } },
        _count: { _all: true },
        _sum: { qty: true },
      }),

      prisma.bongkaran.groupBy({
        by: ["date"],
        where: { date: { gte: mulai, lte: tanggal }, status: "final" },
        _count: { _all: true },
      }),

      prisma.bongkaran.groupBy({
        by: ["scannedById"],
        where: { date: tanggal, status: "final" },
        _count: { _all: true },
        _max: { scannedAt: true },
      }),

      prisma.bongkaran.findMany({
        where: { status: "draft" },
        select: {
          id: true, noResi: true, scannedAt: true, date: true,
          scannedBy: { select: { name: true } },
        },
        orderBy: { scannedAt: "desc" },
        take: 50,
      }),

      // Dibatasi rentang 14 hari yang sama dengan grafik, BUKAN sepanjang
      // masa. Panelnya berdiri di bawah pemilih tanggal; kalau isinya
      // seluruh riwayat, admin yang sudah mendaftarkan barcode-barcode itu
      // akan melihat daftar yang sama besok dan menyimpulkan perbaikannya
      // tidak berpengaruh.
      prisma.bongkaranItem.groupBy({
        by: ["barcode"],
        where: {
          produkTidakDikenal: true,
          barcode: { not: null },
          bongkaran: { date: { gte: mulai, lte: tanggal }, status: "final" },
        },
        _count: { _all: true },
        _max: { namaProduk: true },
        orderBy: { _count: { barcode: "desc" } },
        take: 30,
      }),

      prisma.bongkaran.count({
        where: { waktuDariKlien: true, status: "final", date: { gte: mulai, lte: tanggal } },
      }),

      // Sebaran per kamera hari ini. Gunanya bukan sekadar hiasan: kalau
      // tiga meja berjalan tapi seluruh resi tercatat di Kamera 1, berarti
      // ada operator yang salah pilih di awal — dan itu baru akan terasa
      // berbulan-bulan kemudian, saat rekamannya dicari dan tidak ada.
      prisma.bongkaran.groupBy({
        by: ["kamera"],
        where: { date: tanggal, status: "final" },
        _count: { _all: true },
      }),
    ]);

    // Nama operator: satu query terpisah, bukan relasi di groupBy (groupBy
    // tidak bisa membawa relasi).
    const idOperator = perOperator.map((o) => o.scannedById);
    const namaOperator = idOperator.length
      ? await prisma.user.findMany({
          where: { id: { in: idOperator } },
          select: { id: true, name: true },
        })
      : [];
    const petaNama = new Map(namaOperator.map((u) => [u.id, u.name]));

    const kondisiLengkap = KONDISI.map((k: Kondisi) => {
      const baris = perKondisi.find((p) => p.kondisi === k);
      return {
        kondisi: k,
        barang: baris?._count._all ?? 0,
        qty: baris?._sum.qty ?? 0,
      };
    });

    // Hari tanpa data tetap muncul sebagai 0 — grafik yang melompati hari
    // kosong membuat akhir pekan terlihat seperti hari kerja biasa.
    const petaHari = new Map(perHari.map((h) => [h.date, h._count._all]));
    const grafik = Array.from({ length: HARI_GRAFIK }, (_, i) => {
      const d = shiftDays(-(HARI_GRAFIK - 1 - i), tanggal);
      return { tanggal: d, resi: petaHari.get(d) ?? 0 };
    });

    return {
      tanggal,
      ringkasan: {
        resi: resiHariIni,
        barang: barangHariIni,
        qty: kondisiLengkap.reduce((a, k) => a + k.qty, 0),
      },
      kondisi: kondisiLengkap,
      grafik,
      operator: perOperator
        .map((o) => ({
          id: o.scannedById,
          nama: petaNama.get(o.scannedById) ?? "(user terhapus)",
          resi: o._count._all,
          terakhir: o._max.scannedAt?.toISOString() ?? null,
        }))
        .sort((a, b) => b.resi - a.resi),
      draft: draft.map((d) => ({
        id: d.id,
        noResi: d.noResi,
        tanggal: d.date,
        scannedAt: d.scannedAt.toISOString(),
        oleh: d.scannedBy.name,
      })),
      barcodeAsing: barcodeAsing.map((b) => ({
        barcode: b.barcode ?? "",
        jumlah: b._count._all,
        namaDitulis: b._max.namaProduk ?? "",
      })),
      waktuMeragukan,
      kamera: [
        ...KAMERA.map((k) => ({
          kamera: k as number | null,
          resi: perKamera.find((p) => p.kamera === k)?._count._all ?? 0,
        })),
        // Baris lama tidak punya nomor kamera (kolomnya baru ditambahkan).
        // Ditampilkan terpisah, bukan dilebur ke salah satu kamera.
        {
          kamera: null,
          resi: perKamera.find((p) => p.kamera === null)?._count._all ?? 0,
        },
      ].filter((k) => k.resi > 0 || k.kamera !== null),
    };
  });
}
