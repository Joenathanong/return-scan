import { prisma } from "@/lib/db";
import {
  batasSapu, draftKosong, perluSapu, MAKS_SAPU_SEKALI, UMUR_DRAFT_SAPU_JAM,
} from "@/lib/draft";

/**
 * Penyapu draft bongkaran yang basi dan kosong.
 *
 * BIAYA KE TiDB — ini syarat rancangan, bukan catatan kaki:
 *
 *   • Paling banyak TIGA kueri sekali jalan, dan yang ketiga hanya jalan
 *     kalau memang ada yang dihapus.
 *   • Kueri pertama hanya mengambil kolom `id` (bukan seluruh baris) dan
 *     dibatasi MAKS_SAPU_SEKALI.
 *   • Kueri kedua memakai `distinct` di sisi database, jadi yang kembali
 *     paling banyak sebanyak id yang dikirim — bukan sebanyak barangnya.
 *   • Otomatisnya dibatasi sekali per jam per instance (lihat `sapuJikaPerlu`),
 *     jadi dashboard yang dibuka lima puluh kali sejam tetap menyapu sekali.
 *
 * Sengaja TIDAK memakai filter relasi (`items: { none: {} }`). Skema ini
 * memakai relationMode = "prisma": integritas relasi diurus Prisma, bukan
 * MySQL, dan filter relasi di mode itu diterjemahkan jadi kueri tambahan
 * yang bentuknya tidak kelihatan dari kode. Dua kueri yang saya tulis
 * sendiri lebih murah dan — lebih penting — biayanya bisa dibaca.
 */
export async function sapuDraftBasi(opsi?: {
  jam?: number;
  maks?: number;
  sekarang?: Date;
}): Promise<{ diperiksa: number; dihapus: number; adaIsinya: number }> {
  const jam = opsi?.jam ?? UMUR_DRAFT_SAPU_JAM;
  const maks = opsi?.maks ?? MAKS_SAPU_SEKALI;
  const batas = batasSapu(opsi?.sekarang ?? new Date(), jam);

  const calon = await prisma.bongkaran.findMany({
    where: { status: "draft", scannedAt: { lt: batas } },
    select: { id: true },
    orderBy: { scannedAt: "asc" },
    take: maks,
  });
  if (calon.length === 0) return { diperiksa: 0, dihapus: 0, adaIsinya: 0 };

  const ids = calon.map((c) => c.id);

  // Draft SEHARUSNYA selalu kosong: barang dan status `final` ditulis dalam
  // satu transaksi. "Seharusnya" bukan jaminan, dan yang dipertaruhkan di
  // sisi lain adalah hasil bongkar yang benar-benar ada. Jadi diperiksa.
  const berisi = await prisma.bongkaranItem.findMany({
    where: { bongkaranId: { in: ids } },
    select: { bongkaranId: true },
    distinct: ["bongkaranId"],
  });

  const kosong = draftKosong(ids, berisi.map((b) => b.bongkaranId));
  if (kosong.length === 0) {
    return { diperiksa: ids.length, dihapus: 0, adaIsinya: berisi.length };
  }

  const hasil = await prisma.bongkaran.deleteMany({ where: { id: { in: kosong } } });
  return {
    diperiksa: ids.length,
    dihapus: hasil.count,
    adaIsinya: berisi.length,
  };
}

/**
 * Kapan instance ini terakhir menyapu.
 *
 * Disimpan di memori proses, BUKAN di database. Konsekuensinya jujur: tiap
 * instance serverless punya hitungannya sendiri, jadi di jam sibuk bisa
 * ada dua-tiga penyapuan. Itu masih jauh lebih murah daripada satu baris
 * penanda di database yang harus dibaca dan ditulis pada SETIAP permintaan
 * dashboard hanya untuk tahu bahwa belum waktunya menyapu.
 */
const g = globalThis as unknown as { __sapuDraftTerakhir?: number };

/**
 * Menyapu kalau sudah waktunya, diam kalau belum.
 *
 * Penandanya disetel SEBELUM kerjanya dimulai, supaya dua permintaan yang
 * datang berbarengan tidak sama-sama lolos.
 */
export async function sapuJikaPerlu(sekarang = Date.now()): Promise<number> {
  if (!perluSapu(g.__sapuDraftTerakhir ?? null, sekarang)) return 0;
  g.__sapuDraftTerakhir = sekarang;
  try {
    const h = await sapuDraftBasi({ sekarang: new Date(sekarang) });
    if (h.dihapus > 0) {
      console.info(
        `[bongkaran] sapu draft: ${h.dihapus} dihapus dari ${h.diperiksa} diperiksa` +
          (h.adaIsinya ? `, ${h.adaIsinya} dilewati karena ada isinya` : "")
      );
    }
    return h.dihapus;
  } catch (err) {
    // Dashboard tidak boleh gagal hanya karena bersih-bersih gagal.
    console.error("[bongkaran] sapu draft gagal:", err);
    return 0;
  }
}
