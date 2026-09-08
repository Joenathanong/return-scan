/**
 * Tipe bersama klien & server.
 *
 * Semua tanggal-waktu di sini bertipe `string` (ISO 8601), bukan Date —
 * karena inilah bentuknya setelah melewati JSON di API route. Tanggal
 * bisnis (`date`) selalu "YYYY-MM-DD" dan selalu dihitung server di WIB.
 */

export type UserRole = "admin" | "operator";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  /** Izin modul Bongkaran. Admin selalu boleh, tanpa melihat kolom ini. */
  bisaBongkaran: boolean;
  /** Izin modul Cancel Order. Admin selalu boleh. */
  bisaCancelOrder: boolean;
  /** true kalau saat ini sedang terikat ke sebuah perangkat. */
  sedangLogin: boolean;
  /** Ringkasan perangkat yang sedang dipakai, mis. "Chrome · Android". */
  perangkatLabel: string | null;
  sesiSejak: string | null;
  createdAt: string;
  lastLogin: string | null;
}

/** Sesi ringan yang dipegang klien — tanpa data sensitif. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  mustChangePassword: boolean;
  bisaBongkaran: boolean;
  bisaCancelOrder: boolean;
}

export interface Expedisi {
  id: string;
  /** Kode manual & unik. Ganti nama TIDAK mengubah kode ini. */
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export type KarungStatus = "open" | "locked" | "admin_unlocked";

export interface Karung {
  id: string;
  expedisiId: string;
  expedisiName: string;
  expedisiCode: string;
  nomorKarung: string;
  date: string; // YYYY-MM-DD (WIB)
  status: KarungStatus;
  lockedAt: string | null;
  printedAt: string | null;
  adminUnlockedAt: string | null;
  createdAt: string;
  createdById: string;
  createdByName: string;
  /** Dihitung COUNT(*) dari tabel scans — bukan penghitung manual. */
  totalResi: number;
}

export type ScanStatus = "success" | "voided";

export interface ScanRecord {
  id: string;
  noResi: string;
  karungId: string;
  nomorKarung: string;
  expedisiId: string;
  expedisiName: string;
  expedisiCode: string;
  scannedById: string;
  scannedByName: string;
  scannedAt: string;
  date: string; // YYYY-MM-DD (WIB)
  status: ScanStatus;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface CompanySettings {
  namaPerusahaan: string;
  noteTandaTerima: string;
  /** Kosong = ekspor G-Sheet dimatikan. Aplikasi tetap berjalan normal. */
  spreadsheetId: string;
  claimMasterSpreadsheetId: string;
  updatedAt: string | null;
}

/**
 * Satu entri konfigurasi sheet claim.
 *
 * Dikunci per KODE, dan kodenya tidak harus terdaftar di master ekspedisi —
 * upload claim mendeteksi ekspedisi dari prefix nomor resi dan bisa
 * menghasilkan kode baru. `expedisiId`/`expedisiName` terisi hanya kalau
 * kodenya kebetulan cocok dengan master.
 */
export interface ClaimExpedisiSheet {
  spreadsheetId: string;
  url: string;
  expedisiId: string | null;
  expedisiName: string | null;
}

export interface ClaimSheetConfig {
  masterSpreadsheetId: string;
  /** Kunci = kode ekspedisi. */
  expedisiSheets: Record<string, ClaimExpedisiSheet>;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  detail: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface SheetExport {
  id: string;
  tabName: string;
  date: string;
  expedisiId: string;
  rowCount: number;
  status: "ok" | "failed";
  error: string | null;
  exportedAt: string;
}

// ─── Bentuk respons API ──────────────────────────────────────────────────────

/** Hasil satu scan — dipakai halaman scan untuk menentukan bunyi & warna. */
export interface ScanResult {
  ok: boolean;
  /** "success" | "duplicate" | "locked" | "error" */
  outcome: "success" | "duplicate" | "locked" | "error";
  scan?: ScanRecord;
  /** Untuk duplikat: di mana resi ini sebelumnya tercatat. */
  duplicateInfo?: string;
  message?: string;
  /** Jumlah resi terkini di karung ini, sesudah scan. */
  totalResi?: number;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
