import { NextRequest } from "next/server";
import { prisma, isUniqueViolation } from "@/lib/db";
import {
  handle, requireAdmin, requireBongkaran, badRequest, conflict, writeAudit,
} from "@/lib/api";
import {
  bersihkanKode, bersihkanNama, pisahBarcode, periksaBaris, PESAN_TOLAK,
  bentrokJenis, type JenisBarcode,
} from "@/lib/produk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATAS_DEFAULT = 100;
const BATAS_MAKS = 500;

/**
 * GET /api/produk?q=&limit=&halaman=
 *
 * Daftar untuk layar admin — BUKAN jalur yang dipakai PDT saat scan. PDT
 * memakai /api/bongkaran/sync yang hanya mengirim perubahan sejak sinkron
 * terakhir. Membedakan keduanya penting: kalau layar scan ikut memanggil
 * endpoint ini, setiap scan akan membaca ulang master dari TiDB.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireBongkaran();

    const url = new URL(req.url);
    const q = bersihkanNama(url.searchParams.get("q")).slice(0, 100);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || BATAS_DEFAULT, 1),
      BATAS_MAKS
    );
    const halaman = Math.max(Number(url.searchParams.get("halaman")) || 1, 1);

    // Pencarian menyentuh tiga tempat sekaligus: kode SKU, nama, dan barcode.
    // Operator yang memegang barang biasanya hanya punya salah satunya.
    const where = q
      ? {
          OR: [
            { sku: { contains: q } },
            { nama: { contains: q } },
            { barcodes: { some: { barcode: { contains: bersihkanKode(q) }, active: true } } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.produk.count({ where }),
      prisma.produk.findMany({
        where,
        select: {
          sku: true, nama: true, active: true, updatedAt: true,
          // Barcode yang sudah dilepas (`active: false`) sengaja tidak
          // ditampilkan: baris itu hanya bertahan supaya penghapusannya
          // sampai ke cache PDT lewat sinkron delta, bukan karena masih
          // berlaku.
          barcodes: {
            where: { active: true },
            select: { barcode: true, jenis: true },
            orderBy: { barcode: "asc" },
          },
        },
        orderBy: [{ active: "desc" }, { sku: "asc" }],
        skip: (halaman - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total,
      halaman,
      limit,
      rows: rows.map((p) => ({
        sku: p.sku,
        nama: p.nama,
        active: p.active,
        updatedAt: p.updatedAt.toISOString(),
        // Dipisah per jenis HANYA untuk ditampilkan. Di database keduanya
        // tetap satu tabel, dan pencarian saat scan tidak membedakannya.
        barcodes: p.barcodes.filter((b) => b.jenis !== "BPOM").map((b) => b.barcode),
        barcodesBpom: p.barcodes.filter((b) => b.jenis === "BPOM").map((b) => b.barcode),
      })),
    };
  });
}

/**
 * POST /api/produk — tambah satu produk manual.
 *
 * Ada supaya barcode yang muncul di dashboard sebagai "tidak dikenal" bisa
 * langsung didaftarkan tanpa harus menyunting file Excel dan mengimpor ulang.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();
    const body = (await req.json()) as {
      sku?: string; nama?: string; barcodes?: unknown; barcodesBpom?: unknown;
    };

    const kumpulkan = (v: unknown): string[] =>
      Array.isArray(v) ? pisahBarcode(v.join(",")) : pisahBarcode(v);

    const baris = {
      sku: bersihkanKode(body.sku),
      nama: bersihkanNama(body.nama),
      barcodes: kumpulkan(body.barcodes),
      barcodesBpom: kumpulkan(body.barcodesBpom),
    };

    const salah = periksaBaris(baris);
    if (salah) throw badRequest(PESAN_TOLAK[salah]);

    const bentrok2 = bentrokJenis(baris);
    if (bentrok2.length > 0) {
      throw badRequest(
        `Kode ${bentrok2.join(", ")} diisi sebagai barcode produk sekaligus barcode BPOM. ` +
          "Satu kode fisik hanya punya satu arti — pilih salah satu."
      );
    }

    try {
      await prisma.produk.create({
        data: { sku: baris.sku, nama: baris.nama, updatedBy: me.id },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(`SKU ${baris.sku} sudah ada.`, "SKU_ADA");
      }
      throw err;
    }

    // Barcode ditulis terpisah, dan kegagalan di sini TIDAK membatalkan
    // produknya: barcode bentrok berarti kode itu sudah menunjuk SKU lain,
    // dan memindahkannya diam-diam jauh lebih berbahaya daripada
    // meninggalkan produk baru tanpa barcode.
    const bentrok: string[] = [];
    const semua: { barcode: string; jenis: JenisBarcode }[] = [
      ...baris.barcodes.map((barcode) => ({ barcode, jenis: "PRODUK" as JenisBarcode })),
      ...baris.barcodesBpom.map((barcode) => ({ barcode, jenis: "BPOM" as JenisBarcode })),
    ];

    for (const { barcode, jenis } of semua) {
      try {
        await prisma.produkBarcode.create({ data: { barcode, jenis, sku: baris.sku } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Sudah ada. Boleh diambil alih HANYA kalau pemilik lamanya sudah
        // melepasnya (active: false) — barcode yang masih dipakai SKU lain
        // tidak pernah berpindah diam-diam.
        const dipindahkan = await prisma.produkBarcode.updateMany({
          where: { barcode, active: false },
          data: { sku: baris.sku, jenis, active: true },
        });
        if (dipindahkan.count === 0) bentrok.push(barcode);
      }
    }

    await writeAudit(
      me.id, me.name, "PRODUK_TAMBAH",
      `${baris.sku} — ${baris.nama} (${baris.barcodes.length} barcode, ` +
        `${baris.barcodesBpom.length} barcode BPOM)`
    );

    return { ok: true, sku: baris.sku, bentrok };
  });
}
