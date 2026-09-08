import { NextRequest } from "next/server";
import { prisma, withRetry, isUniqueViolation } from "@/lib/db";
import {
  handle, requireCancelOrder, badRequest, conflict, writeAudit,
} from "@/lib/api";
import { todayWIB, isValidDate } from "@/lib/date";
import { bersihkanKode, bersihkanNama } from "@/lib/produk";
import {
  periksaItemCancel, kodeSesi, edDariBatch, MAKS_ITEM, CATATAN_MAKS,
  type ItemCancel,
} from "@/lib/cancel-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_HALAMAN = 50;

/**
 * GET /api/cancel-order?dari=&sampai=&halaman=
 *
 * Riwayat sesi pencatatan, bukan daftar barang. Jumlah barang dan total
 * quantity dihitung database lewat agregat, tidak dengan menarik seluruh
 * barisnya lalu menjumlahkan di sini.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireCancelOrder();

    const url = new URL(req.url);
    const dari = url.searchParams.get("dari");
    const sampai = url.searchParams.get("sampai");
    const halaman = Math.max(Number(url.searchParams.get("halaman")) || 1, 1);

    // Rentang yang tidak sah DITOLAK, bukan diabaikan.
    //
    // Kolom <input type="date"> mengirim string kosong begitu dikosongkan
    // pengguna. Kalau klausanya sekadar dilewati, halaman menampilkan
    // SELURUH riwayat di bawah judul yang berbunyi "pada rentang ini" —
    // dan tombol Unduh di halaman yang sama justru menolak masukan yang
    // sama dengan 400. Dua bagian satu layar tidak boleh berbeda pendapat
    // soal apa arti rentangnya.
    if (!isValidDate(dari) || !isValidDate(sampai)) {
      throw badRequest("Rentang tanggal tidak valid.");
    }
    if (dari > sampai) throw badRequest("Tanggal awal melewati tanggal akhir.");

    const where = {
      status: { not: "voided" },
      date: { gte: dari, lte: sampai },
    };

    const [total, rows] = await Promise.all([
      prisma.cancelOrder.count({ where }),
      prisma.cancelOrder.findMany({
        where,
        select: {
          id: true, kode: true, catatan: true, date: true,
          recordedAt: true, status: true,
          recordedBy: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { recordedAt: "desc" },
        skip: (halaman - 1) * PER_HALAMAN,
        take: PER_HALAMAN,
      }),
    ]);

    // Total quantity dijumlahkan DATABASE lewat groupBy, bukan dengan
    // menarik setiap baris barang ke sini lalu menjumlahkannya di
    // JavaScript. Bedanya nyata: satu halaman riwayat bisa memuat ribuan
    // baris barang yang tidak satu pun akan ditampilkan.
    const idSesi = rows.map((r) => r.id);
    const jumlah = idSesi.length
      ? await prisma.cancelOrderItem.groupBy({
          by: ["cancelOrderId"],
          where: { cancelOrderId: { in: idSesi } },
          _sum: { qty: true },
        })
      : [];
    const petaQty = new Map(jumlah.map((j) => [j.cancelOrderId, j._sum.qty ?? 0]));

    return {
      total,
      halaman,
      limit: PER_HALAMAN,
      rows: rows.map((r) => ({
        id: r.id,
        kode: r.kode,
        catatan: r.catatan ?? "",
        tanggal: r.date,
        recordedAt: r.recordedAt.toISOString(),
        oleh: r.recordedBy.name,
        jumlahBaris: r._count.items,
        totalQty: petaQty.get(r.id) ?? 0,
      })),
    };
  });
}

/**
 * POST /api/cancel-order  { catatan?, items[] }
 *
 * Menyimpan SATU sesi input gabungan sekaligus. Tidak ada draft dan tidak
 * ada "mulai sesi": barang cancel order sudah menumpuk di rak sebelum
 * dicatat, jadi tidak ada momen "mulai" yang berarti apa pun. Yang dicatat
 * adalah kapan seseorang duduk dan mendaftarnya.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireCancelOrder();
    const body = (await req.json()) as { catatan?: string; items?: ItemCancel[] };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw badRequest("Belum ada barang yang diisi.");
    if (items.length > MAKS_ITEM) {
      throw badRequest(`Maksimal ${MAKS_ITEM} baris dalam satu sesi input.`);
    }

    // Semua baris diperiksa DULU, sebelum satu pun ditulis. Aturannya sama
    // persis dengan yang dipakai layar untuk menyalakan tombol Simpan.
    items.forEach((it, i) => {
      const salah = periksaItemCancel(it, i + 1);
      if (salah) throw badRequest(salah);
    });

    const catatan = bersihkanNama(body.catatan).slice(0, CATATAN_MAKS) || null;
    const tanggal = todayWIB();
    const hariIni = tanggal;

    const barisItem = items.map((it, i) => {
      const batch = bersihkanKode(it.batch) || null;

      // ED dihitung ULANG di server dari batch-nya — nilai yang masuk
      // database tidak boleh bergantung pada klien mengerjakannya dengan
      // benar. Isian manual operator menang kalau ia memang mengetiknya.
      const terbaca = batch ? edDariBatch(batch, hariIni) : null;
      const edManual = String(it.edDate ?? "").trim() || null;
      const edOtomatis = Boolean(it.edOtomatis) && terbaca !== null;

      return {
        urutan: i + 1,
        barcode: bersihkanKode(it.barcode) || null,
        sku: bersihkanKode(it.sku) || null,
        namaProduk: bersihkanNama(it.namaProduk),
        produkTidakDikenal: Boolean(it.produkTidakDikenal),
        qty: it.qty,
        batch,
        mfgDate: terbaca?.mfgDate ?? null,
        edDate: edOtomatis ? terbaca!.edDate : edManual,
        edOtomatis,
      };
    });

    /**
     * Nomor urut harian. Dua orang yang menyimpan bersamaan bisa
     * menghitung angka yang sama; kolomnya UNIQUE, jadi yang kalah balapan
     * mendapat P2002 dan kita hitung ulang. Lima percobaan sudah jauh
     * melebihi kemungkinan nyata di gudang, dan jauh lebih murah daripada
     * mengunci tabel demi nomor yang rapi.
     */
    let sesi: { id: string; kode: string; recordedAt: Date; date: string } | null = null;

    for (let percobaan = 0; percobaan < 5; percobaan++) {
      // Nomor diambil dari kode TERBESAR hari itu, bukan dari jumlah baris.
      //
      // Menghitung baris salah begitu ada satu nomor yang terlewat — dan
      // nomor PASTI terlewat: sesi yang dibatalkan tetap memegang kodenya,
      // dan pemenang balapan menaikkan angkanya. Sekali `count` tertinggal
      // di belakang nomor tertinggi, setiap penyimpanan berikutnya menabrak
      // kode yang sudah ada, membuang satu INSERT bersarang (induk + sampai
      // 300 baris barang) untuk kemudian di-rollback. Selisihnya melebar
      // tiap kali, dan begitu mencapai lima, seluruh modul berhenti bisa
      // menyimpan sampai lewat tengah malam.
      const terakhir = await prisma.cancelOrder.findFirst({
        where: { date: tanggal },
        orderBy: { kode: "desc" },
        select: { kode: true },
      });
      const urutan = (Number(terakhir?.kode.slice(-3)) || 0) + 1 + percobaan;
      try {
        sesi = await withRetry(() =>
          prisma.cancelOrder.create({
            data: {
              kode: kodeSesi(tanggal, urutan),
              catatan,
              date: tanggal,
              recordedAt: new Date(),
              recordedById: me.id,
              status: "final",
              items: { create: barisItem },
            },
            select: { id: true, kode: true, recordedAt: true, date: true },
          })
        );
        break;
      } catch (err) {
        if (!isUniqueViolation(err, "kode")) throw err;
        // Nomor itu baru saja dipakai orang lain — coba nomor berikutnya.
      }
    }

    if (!sesi) {
      throw conflict(
        "Terlalu banyak penyimpanan bersamaan. Coba simpan lagi sebentar lagi.",
        "NOMOR_SESI_BENTROK"
      );
    }

    // Batch yang dipakai di sini ikut memperkaya saran, sama seperti di
    // Bongkaran. Tanpa ini, batch yang diketik hanya hidup di IndexedDB
    // perangkat yang mengetiknya: hilang saat cache dikosongkan, dan tidak
    // pernah sampai ke PDT lain — padahal layarnya sudah berperilaku
    // seolah saran itu terkumpul.
    //
    // Di luar transaksi utama dan kegagalannya ditelan: ini cache untuk
    // mempercepat pengetikan, bukan data bisnis.
    const pasangan = new Map<string, { sku: string; batch: string; edDate: string }>();
    for (const b of barisItem) {
      if (b.sku && b.batch && b.edDate) {
        pasangan.set(`${b.sku}|${b.batch}`, { sku: b.sku, batch: b.batch, edDate: b.edDate });
      }
    }
    await Promise.all(
      [...pasangan.values()].map((b) =>
        prisma.batchSku
          .upsert({
            where: { sku_batch: { sku: b.sku, batch: b.batch } },
            create: { sku: b.sku, batch: b.batch, edDate: b.edDate },
            // edDate sengaja tidak ditimpa — satu salah ketik tidak boleh
            // jadi saran yang diterima semua operator sesudahnya.
            update: { dipakai: { increment: 1 } },
          })
          .catch((err: unknown) => {
            console.error("[cancel-order] gagal simpan saran batch:", err);
          })
      )
    );

    await writeAudit(
      me.id, me.name, "CANCEL_ORDER_SIMPAN",
      `${sesi.kode} — ${barisItem.length} baris`,
      { cancelOrderId: sesi.id, tanggal: sesi.date }
    );

    return {
      ok: true,
      id: sesi.id,
      kode: sesi.kode,
      tanggal: sesi.date,
      jumlahBaris: barisItem.length,
      totalQty: barisItem.reduce((a, b) => a + b.qty, 0),
    };
  });
}
