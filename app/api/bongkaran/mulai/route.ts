import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, cleanResi, badRequest } from "@/lib/api";
import { todayWIB } from "@/lib/date";
import { isKamera } from "@/lib/bongkaran";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bongkaran/mulai  { noResi }
 *
 * Dipanggil TEPAT saat resi di-scan, bukan saat Simpan. Inilah satu-satunya
 * tempat `scanned_at` ditulis, dan yang menulisnya adalah SERVER — jam PDT
 * yang meleset (baterai RTC habis, zona waktu salah, operator mengubahnya)
 * tidak bisa merusak data. Setiap barang nanti dicatat sebagai selisih
 * milidetik terhadap titik ini; yang datang dari klien hanya durasi, bukan
 * jam dinding.
 *
 * Barisnya berstatus `draft` sampai Simpan ditekan. Draft yang tidak pernah
 * selesai (PDT mati, operator keluar) tetap terlihat di dashboard — jauh
 * lebih baik daripada data yang hilang tanpa jejak.
 *
 * Sekalian mengembalikan dua hal yang hanya bisa dijawab server, supaya
 * tidak perlu panggilan tambahan:
 *   • apakah resi ini pernah dibongkar sebelumnya (peringatan, bukan
 *     larangan — satu nomor resi bisa sah datang dalam dua koli);
 *   • apakah resi ini ada di Scan Retur (informasi, bukan syarat —
 *     bongkar bisa terjadi sebelum resinya sempat tercatat).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireBongkaran();

    const body = (await req.json()) as { noResi?: string; kamera?: number };
    const noResi = cleanResi(body.noResi);
    if (!noResi) throw badRequest("Nomor resi wajib diisi.");
    if (noResi.length > 64) throw badRequest("Nomor resi terlalu panjang.");

    // Kamera WAJIB di sini, walaupun kolomnya nullable di database.
    //
    // Nullable itu untuk baris lama yang tercatat sebelum fitur ini ada;
    // baris baru tidak punya alasan untuk kosong, karena layar memaksa
    // memilih kamera sebelum kolom resi bisa disentuh. Kalau tetap sampai
    // ke sini tanpa kamera, ada yang salah — dan lebih baik ketahuan
    // sekarang daripada muncul sebagai kolom kosong berbulan-bulan
    // kemudian, saat seseorang justru sedang mencari rekamannya.
    const kamera = Number(body.kamera);
    if (!isKamera(kamera)) {
      throw badRequest("Nomor kamera belum dipilih. Pilih kamera dulu di layar Bongkaran.");
    }

    const [sebelumnya, diScanRetur] = await Promise.all([
      prisma.bongkaran.findFirst({
        where: { noResi, status: "final" },
        select: {
          id: true, scannedAt: true, date: true,
          scannedBy: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { scannedAt: "desc" },
      }),
      prisma.scan.findFirst({
        where: { noResi, status: "success" },
        select: {
          date: true,
          expedisi: { select: { name: true, code: true } },
          karung: { select: { nomorKarung: true } },
        },
      }),
    ]);

    const scannedAt = new Date();
    const bongkaran = await prisma.bongkaran.create({
      data: {
        noResi,
        scannedAt,
        kamera,
        scannedById: me.id,
        date: todayWIB(),
        status: "draft",
      },
      select: { id: true, noResi: true, scannedAt: true, date: true, kamera: true },
    });

    return {
      id: bongkaran.id,
      noResi: bongkaran.noResi,
      scannedAt: bongkaran.scannedAt.toISOString(),
      date: bongkaran.date,
      kamera: bongkaran.kamera,
      duplikat: sebelumnya
        ? {
            tanggal: sebelumnya.date,
            oleh: sebelumnya.scannedBy.name,
            jumlahBarang: sebelumnya._count.items,
          }
        : null,
      retur: diScanRetur
        ? {
            tanggal: diScanRetur.date,
            expedisi: diScanRetur.expedisi.name,
            kodeExpedisi: diScanRetur.expedisi.code,
            karung: diScanRetur.karung.nomorKarung,
          }
        : null,
    };
  });
}
