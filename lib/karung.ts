import type { Karung, KarungStatus } from "@/types";

/** Berapa lama admin-unlock berlaku sebelum karung terkunci kembali. */
export const ADMIN_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Apakah karung terkunci (tidak boleh ditambah scan)?
 *
 *   open            → terbuka
 *   locked          → terkunci (tanda terimanya sudah dicetak)
 *   admin_unlocked  → terbuka, tapi hanya 24 jam sejak admin membukanya
 *
 * Aturannya sama dengan sistem lama karena memang sesuai kebutuhan
 * operasional. Yang berubah: dulu pengecekan ini hidup di klien dan bisa
 * dilewati, sekarang dijalankan di server sebelum setiap insert.
 */
export function isKarungLocked(k: {
  status: string;
  adminUnlockedAt: Date | null;
}): boolean {
  if (k.status === "open") return false;
  if (k.status === "locked") return true;
  if (k.status === "admin_unlocked") {
    if (!k.adminUnlockedAt) return false;
    return Date.now() - k.adminUnlockedAt.getTime() > ADMIN_UNLOCK_WINDOW_MS;
  }
  return false;
}

export function asKarungStatus(s: string): KarungStatus {
  return s === "locked" || s === "admin_unlocked" ? s : "open";
}

/**
 * Include standar saat mengambil karung.
 *
 * `_count.scans` dibatasi status "success" — jadi jumlah resi SELALU
 * dihitung ulang dari tabel scans, tidak pernah dari kolom penghitung.
 * Ini menutup bug `totalResi` meleset di sistem lama, yang berasal dari
 * baca-lalu-tulis tanpa transaksi.
 */
export const KARUNG_INCLUDE = {
  expedisi: { select: { name: true, code: true } },
  createdBy: { select: { name: true } },
  _count: { select: { scans: { where: { status: "success" } } } },
} as const;

export type KarungRow = {
  id: string;
  expedisiId: string;
  nomorKarung: string;
  date: string;
  status: string;
  lockedAt: Date | null;
  printedAt: Date | null;
  adminUnlockedAt: Date | null;
  createdAt: Date;
  createdById: string;
  expedisi: { name: string; code: string };
  createdBy: { name: string };
  _count: { scans: number };
};

export function toKarung(k: KarungRow): Karung {
  return {
    id: k.id,
    expedisiId: k.expedisiId,
    expedisiName: k.expedisi.name,
    expedisiCode: k.expedisi.code,
    nomorKarung: k.nomorKarung,
    date: k.date,
    status: asKarungStatus(k.status),
    lockedAt: k.lockedAt?.toISOString() ?? null,
    printedAt: k.printedAt?.toISOString() ?? null,
    adminUnlockedAt: k.adminUnlockedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    createdById: k.createdById,
    createdByName: k.createdBy.name,
    totalResi: k._count.scans,
  };
}
