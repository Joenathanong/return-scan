import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, badRequest } from "@/lib/api";
import { isValidDate, todayWIB } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batas baris yang ditarik. Satu hari bongkaran realistis jauh di bawah ini;
 * angkanya ada supaya rentang tanggal yang kelewat lebar gagal dengan jujur
 * ("terpotong") alih-alih diam-diam melaporkan setengah kenyataan.
 */
const MAKS_BARIS = 20_000;

/** WIB = UTC+7, tanpa daylight saving. Aritmetika ini eksak, bukan hampiran. */
const OFFSET_WIB_MS = 7 * 60 * 60 * 1000;

function jamWIB(d: Date): number {
  return new Date(d.getTime() + OFFSET_WIB_MS).getUTCHours();
}

function menitWIB(d: Date): string {
  const w = new Date(d.getTime() + OFFSET_WIB_MS);
  const jj = String(w.getUTCHours()).padStart(2, "0");
  const mm = String(w.getUTCMinutes()).padStart(2, "0");
  return `${jj}:${mm}`;
}

/** Nilai tengah. Dipilih daripada rata-rata karena satu jeda makan siang
 *  cukup untuk menggeser rata-rata dan membuatnya tidak berarti apa-apa. */
function median(angka: number[]): number {
  if (angka.length === 0) return 0;
  const urut = [...angka].sort((a, b) => a - b);
  const t = Math.floor(urut.length / 2);
  return urut.length % 2 ? urut[t] : Math.round((urut[t - 1] + urut[t]) / 2);
}

interface Ringkas {
  id: string;
  nama: string;
  resi: number;
  barang: number;
  qty: number;
  /** Jam scan pertama dan terakhir — SHIFT YANG TERAMATI, bukan jadwal. */
  mulai: string;
  selesai: string;
  /** Menit antara scan pertama dan terakhir. */
  rentangMenit: number;
  /** Berapa jam kalender yang benar-benar ada scan-nya. */
  jamAktif: number;
  /** Resi per jam, dihitung dari jam aktif saja. */
  rataPerJamAktif: number;
  /** Resi per jam, dihitung dari seluruh rentang termasuk jeda. */
  rataPerJamRentang: number;
  jamTersibuk: number | null;
  resiDiJamTersibuk: number;
  /** Jeda terpanjang antar-resi berturut-turut, dalam menit. */
  jedaTerpanjangMenit: number;
  jedaTerpanjangMulai: string;
  /** Nilai tengah selang waktu antar-resi, dalam menit. */
  medianAntarResiMenit: number;
  /** 24 angka, indeks = jam WIB. */
  perJam: number[];
}

/**
 * GET /api/bongkaran/operator?dari=YYYY-MM-DD&sampai=YYYY-MM-DD
 *
 * Laporan produktivitas per operator.
 *
 * KENAPA DIHITUNG DI SINI, BUKAN DI SQL: yang paling berguna dari laporan
 * ini justru bukan jumlah — melainkan JEDA. Jeda terpanjang menunjukkan
 * kapan meja berhenti (istirahat, PDT mati, antrean kosong), dan nilai
 * tengah selang antar-resi menunjukkan kecepatan sebenarnya, tahan terhadap
 * satu jeda makan siang yang akan merusak rata-rata biasa. Keduanya
 * menuntut membaca deretan waktu secara berurutan, yang di SQL berarti
 * window function berlapis; di sini cukup satu lintasan.
 *
 * Yang ditarik hanya DUA kolom per baris (siapa dan kapan), jadi walau
 * barisnya ribuan, muatannya tetap kecil.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireBongkaran();

    const url = new URL(req.url);
    const dari = url.searchParams.get("dari") || todayWIB();
    const sampai = url.searchParams.get("sampai") || dari;

    if (!isValidDate(dari) || !isValidDate(sampai)) {
      throw badRequest("Rentang tanggal tidak valid.");
    }
    if (dari > sampai) throw badRequest("Tanggal awal melewati tanggal akhir.");

    const where = { date: { gte: dari, lte: sampai }, status: "final" };

    const [baris, jumlahResi, perOperatorItem, namaUser] = await Promise.all([
      // Deretan waktu — inti laporan ini. `id` ikut ditarik supaya jumlah
      // barang per resi bisa dipetakan ke operatornya tanpa kueri kedua ke
      // tabel yang sama.
      prisma.bongkaran.findMany({
        where,
        select: { id: true, scannedById: true, scannedAt: true },
        orderBy: { scannedAt: "asc" },
        take: MAKS_BARIS,
      }),
      prisma.bongkaran.count({ where }),

      // Jumlah barang dan qty dihitung DATABASE, bukan dengan menarik
      // setiap barang ke sini.
      prisma.bongkaranItem.groupBy({
        by: ["bongkaranId"],
        where: { bongkaran: where },
        _count: { _all: true },
        _sum: { qty: true },
      }),

      prisma.user.findMany({ select: { id: true, name: true } }),
    ]);

    const petaNama = new Map(namaUser.map((u) => [u.id, u.name]));

    // bongkaranId → operator, dari baris yang sudah ada di tangan.
    const idKeOperator = new Map(baris.map((b) => [b.id, b.scannedById]));

    const barangPerOperator = new Map<string, { barang: number; qty: number }>();
    for (const g of perOperatorItem) {
      const op = idKeOperator.get(g.bongkaranId);
      if (!op) continue;
      const t = barangPerOperator.get(op) ?? { barang: 0, qty: 0 };
      t.barang += g._count._all;
      t.qty += g._sum.qty ?? 0;
      barangPerOperator.set(op, t);
    }

    // ── Satu lintasan per operator ────────────────────────────────────────
    const perOperator = new Map<string, Date[]>();
    for (const b of baris) {
      const arr = perOperator.get(b.scannedById) ?? [];
      arr.push(b.scannedAt);
      perOperator.set(b.scannedById, arr);
    }

    const jamTim = Array<number>(24).fill(0);
    for (const b of baris) jamTim[jamWIB(b.scannedAt)]++;

    const operator: Ringkas[] = [];

    for (const [id, waktu] of perOperator) {
      const perJam = Array<number>(24).fill(0);
      for (const w of waktu) perJam[jamWIB(w)]++;

      const mulai = waktu[0];
      const selesai = waktu[waktu.length - 1];
      const rentangMenit = Math.max(
        0,
        Math.round((selesai.getTime() - mulai.getTime()) / 60000)
      );

      // Selang antar-resi berturut-turut.
      const selang: number[] = [];
      let jedaTerpanjang = 0;
      let jedaMulai = mulai;
      for (let i = 1; i < waktu.length; i++) {
        const d = Math.round((waktu[i].getTime() - waktu[i - 1].getTime()) / 60000);
        selang.push(d);
        if (d > jedaTerpanjang) {
          jedaTerpanjang = d;
          jedaMulai = waktu[i - 1];
        }
      }

      const jamAktif = perJam.filter((n) => n > 0).length;
      const puncak = perJam.reduce((a, n, i) => (n > perJam[a] ? i : a), 0);

      operator.push({
        id,
        nama: petaNama.get(id) ?? "(user terhapus)",
        resi: waktu.length,
        barang: barangPerOperator.get(id)?.barang ?? 0,
        qty: barangPerOperator.get(id)?.qty ?? 0,
        mulai: menitWIB(mulai),
        selesai: menitWIB(selesai),
        rentangMenit,
        jamAktif,
        // Dua rata-rata, dan bedanya penting. Yang pertama menjawab
        // "seberapa cepat ia bekerja saat sedang bekerja"; yang kedua
        // menjawab "berapa hasilnya per jam shift, termasuk saat berhenti".
        // Menampilkan satu saja akan menyembunyikan separuh ceritanya.
        rataPerJamAktif: jamAktif > 0 ? Math.round((waktu.length / jamAktif) * 10) / 10 : 0,
        rataPerJamRentang:
          rentangMenit >= 60
            ? Math.round((waktu.length / (rentangMenit / 60)) * 10) / 10
            : waktu.length,
        jamTersibuk: perJam[puncak] > 0 ? puncak : null,
        resiDiJamTersibuk: perJam[puncak],
        jedaTerpanjangMenit: jedaTerpanjang,
        jedaTerpanjangMulai: waktu.length > 1 ? menitWIB(jedaMulai) : "",
        medianAntarResiMenit: median(selang),
        perJam,
      });
    }

    operator.sort((a, b) => b.resi - a.resi);

    return {
      dari,
      sampai,
      // true kalau batas MAKS_BARIS tersentuh — angkanya lebih rendah dari
      // kenyataan, dan layar harus mengatakannya.
      terpotong: jumlahResi > baris.length,
      totalResi: jumlahResi,
      operator,
      jamTim,
    };
  });
}
