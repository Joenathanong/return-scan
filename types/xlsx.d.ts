// Deklarasi tipe minimal untuk paket xlsx (v0.18.x).
// Paket npm-nya tidak membawa .d.ts sendiri, jadi kita sediakan stub.
//
// Stub ini SENGAJA tidak lengkap — hanya berisi apa yang benar-benar dipakai
// aplikasi. Kalau nanti memakai fungsi xlsx yang belum ada di sini, tambahkan
// deklarasinya, jangan pakai `as any`.
declare module "xlsx" {
  export function read(
    data: ArrayBuffer | Uint8Array | Buffer,
    opts?: { type?: string; cellDates?: boolean }
  ): WorkBook;

  export function writeFile(
    wb: WorkBook,
    filename: string,
    opts?: Record<string, unknown>
  ): void;

  export const utils: {
    sheet_to_json<T = Record<string, unknown>>(
      ws: WorkSheet,
      opts?: { defval?: unknown; header?: unknown }
    ): T[];

    aoa_to_sheet(data: unknown[][]): WorkSheet;

    /**
     * Membuat sheet dari array objek; kunci objek jadi baris header.
     * Dipakai halaman Data & Export.
     */
    json_to_sheet<T extends object = Record<string, unknown>>(
      data: T[],
      opts?: {
        header?: string[];
        skipHeader?: boolean;
        dateNF?: string;
        cellDates?: boolean;
      }
    ): WorkSheet;

    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void;
  };

  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }

  /** Lebar kolom, dipasang lewat `ws["!cols"]`. */
  export interface ColInfo {
    wch?: number;
    wpx?: number;
    hidden?: boolean;
  }

  // Hasil indexing sengaja `any` supaya akses properti seperti
  // `ws["!cols"]` atau `ws[ref].s = ...` bisa dikompilasi tanpa cast
  // di mana-mana.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type WorkSheet = Record<string, any>;
}
