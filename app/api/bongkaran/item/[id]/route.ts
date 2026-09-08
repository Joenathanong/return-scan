import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireBongkaran, badRequest, notFound, writeAudit,
} from "@/lib/api";
import { todayWIB } from "@/lib/date";
import {
  periksaItem, isKondisi, butuhBarcode, bacaBatch, type ItemMasuk,
} from "@/lib/bongkaran";
import { bersihkanKode, bersihkanNama } from "@/lib/produk";

export const runtime = "nodejs";

/**
 * PATCH /api/bongkaran/item/[id] — koreksi satu baris hasil bongkaran.
 *
 * WAKTU TIDAK PERNAH IKUT BERUBAH. `scanned_at` baris ini, dan
 * `scanned_at` resinya, tetap menunjuk saat barang itu benar-benar
 * di-scan — bukan saat seseorang memperbaikinya. Kalau koreksi ikut
 * menggeser stempel waktu, kolom Kamera dan Scan Date di ekspor jadi
 * bohong: rekaman CCTV pada jam yang tertulis tidak akan memperlihatkan
 * apa pun, dan tidak akan ada yang tahu kenapa.
 *
 * Yang boleh diubah adalah isi datanya: kondisi, produk, jumlah, batch,
 * ED, dan nama barang yang diterima. Yang TIDAK boleh: resi induknya
 * (pindah resi berarti membuat baris baru, bukan menyunting yang ini),
 * siapa yang men-scan, dan jam berapa.
 *
 * Setiap perubahan dicatat di audit log lengkap dengan nilai sebelum dan
 * sesudahnya — koreksi yang tidak meninggalkan jejak sama saja dengan
 * data yang bisa berubah sendiri.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireBongkaran();
    const { id } = await params;

    const lama = await prisma.bongkaranItem.findUnique({
      where: { id },
      select: {
        id: true, kondisi: true, barcode: true, sku: true, namaProduk: true,
        produkTidakDikenal: true, namaDiterima: true, qty: true,
        batch: true, edDate: true, edOtomatis: true, urutan: true,
        bongkaran: { select: { id: true, noResi: true, status: true } },
      },
    });
    if (!lama) throw notFound("Baris bongkaran tidak ditemukan.");
    if (lama.bongkaran.status !== "final") {
      throw badRequest(
        lama.bongkaran.status === "voided"
          ? "Resi ini sudah dibatalkan — barisnya tidak bisa diubah."
          : "Resi ini masih berupa draft. Selesaikan dulu di layar scan."
      );
    }

    const body = (await req.json()) as Partial<ItemMasuk>;

    // Nilai baru = nilai lama yang ditimpa apa pun yang dikirim. Kolom
    // yang tidak disebut TIDAK berubah, sehingga layar boleh mengirim
    // hanya yang disunting.
    const kondisi = body.kondisi !== undefined ? String(body.kondisi) : lama.kondisi;
    if (!isKondisi(kondisi)) throw badRequest("Kondisi tidak dikenal.");
    const perluBarcode = butuhBarcode(kondisi);

    const barcode =
      body.barcode !== undefined ? bersihkanKode(body.barcode) : (lama.barcode ?? "");
    const sku = body.sku !== undefined ? bersihkanKode(body.sku) : (lama.sku ?? "");
    const namaProduk =
      body.namaProduk !== undefined ? bersihkanNama(body.namaProduk) : (lama.namaProduk ?? "");
    const namaDiterima =
      body.namaDiterima !== undefined
        ? bersihkanNama(body.namaDiterima)
        : (lama.namaDiterima ?? "");
    const qty = body.qty !== undefined ? Number(body.qty) : lama.qty;
    const batch = body.batch !== undefined ? bersihkanKode(body.batch) : (lama.batch ?? "");

    const terbaca = batch ? bacaBatch(batch, todayWIB()) : null;
    const edManual =
      body.edDate !== undefined ? String(body.edDate).trim() : (lama.edDate ?? "");
    const edOtomatis =
      (body.edOtomatis !== undefined ? Boolean(body.edOtomatis) : lama.edOtomatis) &&
      terbaca !== null;
    const edDate = edOtomatis ? terbaca!.edDate : edManual;

    // Produk dianggap dikenal lagi kalau SKU-nya sekarang terisi. Ini
    // jalur perbaikan untuk baris yang tersimpan sebelum masternya lengkap.
    const produkTidakDikenal = perluBarcode ? Boolean(barcode) && !sku : false;

    const calon: ItemMasuk = {
      kondisi,
      barcode: perluBarcode ? barcode : "",
      sku: perluBarcode ? sku : "",
      namaProduk: perluBarcode ? namaProduk : "",
      produkTidakDikenal,
      namaDiterima: perluBarcode ? "" : namaDiterima,
      qty,
      batch,
      edDate,
      edOtomatis,
    };

    // Aturan yang sama persis dengan layar scan. Koreksi tidak boleh jadi
    // pintu belakang untuk memasukkan baris yang tidak akan pernah lolos
    // lewat pintu depan.
    const salah = periksaItem(calon, lama.urutan);
    if (salah) throw badRequest(salah);

    const data = {
      kondisi,
      barcode: perluBarcode ? barcode || null : null,
      sku: perluBarcode ? sku || null : null,
      namaProduk: perluBarcode ? namaProduk || null : null,
      produkTidakDikenal,
      namaDiterima: perluBarcode ? null : namaDiterima || null,
      qty,
      batch: batch || null,
      mfgDate: terbaca?.mfgDate ?? null,
      edDate: edDate || null,
      edOtomatis,
      // scannedAt SENGAJA tidak ada di sini.
    };

    const jejak: string[] = [];
    const banding = (label: string, a: unknown, b: unknown) => {
      if (String(a ?? "") !== String(b ?? "")) jejak.push(`${label}: "${a ?? ""}" → "${b ?? ""}"`);
    };
    banding("kondisi", lama.kondisi, data.kondisi);
    banding("barcode", lama.barcode, data.barcode);
    banding("sku", lama.sku, data.sku);
    banding("nama", lama.namaProduk, data.namaProduk);
    banding("nama diterima", lama.namaDiterima, data.namaDiterima);
    banding("qty", lama.qty, data.qty);
    banding("batch", lama.batch, data.batch);
    banding("ED", lama.edDate, data.edDate);

    if (jejak.length === 0) return { ok: true, tidakAdaPerubahan: true };

    await prisma.bongkaranItem.update({ where: { id }, data });

    await writeAudit(
      me.id, me.name, "BONGKARAN_EDIT_ITEM",
      `${lama.bongkaran.noResi} baris ${lama.urutan} — ${jejak.join("; ")}`.slice(0, 500),
      { bongkaranId: lama.bongkaran.id, itemId: id }
    );

    return { ok: true, perubahan: jejak };
  });
}
