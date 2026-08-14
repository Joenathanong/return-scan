/**
 * fix-claim-table.mjs — bangun ulang tabel `claim_expedisi_sheets`.
 *
 * ═══ KENAPA INI PERLU ═══
 *
 * `prisma db push` gagal dengan:
 *
 *     Error: Unsupported drop primary key when the table is using
 *            clustered index
 *
 * TiDB membuat primary key non-integer sebagai CLUSTERED INDEX — artinya
 * baris fisik tabel diurutkan menurut primary key itu sendiri. Konsekuensinya
 * primary key TIDAK BISA diubah atau dihapus setelah tabel jadi; satu-satunya
 * jalan adalah membuat ulang tabelnya.
 *
 * Yang berubah: primary key `claim_expedisi_sheets` dipindah dari
 * `expedisi_id` ke `code`, supaya kode ekspedisi hasil deteksi prefix resi
 * yang belum terdaftar di master tetap bisa disimpan konfigurasinya.
 *
 * ═══ CARA PAKAI ═══
 *
 *     node tools/fix-claim-table.mjs        # cadangkan isinya lalu DROP tabel
 *     npm run db:push                       # Prisma membuat ulang dengan skema baru
 *     npm run db:generate
 *     node tools/fix-claim-table.mjs --restore   # kembalikan isi dari cadangan
 *
 * Langkah --restore hanya perlu kalau tabelnya memang berisi data. Kalau
 * kosong (kemungkinan besar, karena halaman Claim baru saja jadi), skrip ini
 * langsung bilang dan Anda cukup lanjut ke db:push.
 *
 * Semua dikerjakan dengan SQL mentah, bukan lewat model Prisma, supaya tidak
 * bergantung pada Prisma Client versi mana yang sedang ter-generate.
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();
const RESTORE = process.argv.includes("--restore");
const CADANGAN = "claim-config-backup.json";

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const hr = () => log(c.dim("─".repeat(70)));

async function tabelAda(nama) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    nama
  );
  return Number(r?.[0]?.n ?? 0) > 0;
}

async function kolomTabel(nama) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    nama
  );
  return new Set(r.map((x) => x.c));
}

// ─── Mode: kembalikan isi ─────────────────────────────────────────────────

async function restore() {
  log("");
  log(c.b("  Kembalikan isi claim_expedisi_sheets"));
  hr();

  if (!fs.existsSync(CADANGAN)) {
    log(c.y(`\n  ${CADANGAN} tidak ada — tidak ada yang perlu dikembalikan.\n`));
    return;
  }
  const data = JSON.parse(fs.readFileSync(CADANGAN, "utf8"));
  const baris = data.rows ?? [];
  if (baris.length === 0) {
    log(c.g("\n  Cadangan kosong — tidak ada yang perlu dikembalikan.\n"));
    return;
  }

  const kolom = await kolomTabel("claim_expedisi_sheets");
  if (!kolom.has("code")) {
    log(c.r("\n  ✗ Tabel belum memakai skema baru (kolom `code` tidak ada)."));
    log(c.dim("    Jalankan `npm run db:push` dulu.\n"));
    process.exit(1);
  }

  let masuk = 0, lewat = 0;
  for (const b of baris) {
    const code = String(b.code ?? "").trim().toUpperCase();
    if (!code) { lewat++; continue; }
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO claim_expedisi_sheets
           (code, expedisi_id, spreadsheet_id, url, updated_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           expedisi_id = VALUES(expedisi_id),
           spreadsheet_id = VALUES(spreadsheet_id),
           url = VALUES(url)`,
        code, b.expedisi_id ?? null, b.spreadsheet_id ?? "", b.url ?? ""
      );
      masuk++;
    } catch (e) {
      log(c.y(`  ! ${code}: ${e.message.slice(0, 90)}`));
      lewat++;
    }
  }

  log(`\n  ${c.g(masuk + " baris dikembalikan")}${lewat ? c.y(`, ${lewat} dilewati`) : ""}`);
  log(c.dim(`  Cadangan tetap disimpan di ${CADANGAN} — hapus kalau sudah yakin.\n`));
}

// ─── Mode: cadangkan lalu drop ────────────────────────────────────────────

async function dropDenganCadangan() {
  log("");
  log(c.b("  Bangun ulang claim_expedisi_sheets"));
  hr();

  if (!(await tabelAda("claim_expedisi_sheets"))) {
    log(c.g("\n  Tabel belum ada — tidak ada yang perlu dibongkar."));
    log(c.dim("  Langsung jalankan `npm run db:push`.\n"));
    return;
  }

  const kolom = await kolomTabel("claim_expedisi_sheets");
  if (kolom.has("code")) {
    log(c.g("\n  Tabel SUDAH memakai skema baru (kolom `code` ada)."));
    log(c.dim("  Tidak ada yang perlu dikerjakan.\n"));
    return;
  }

  // Ambil isinya, sekalian cari kode ekspedisinya lewat join ke master.
  const baris = await prisma.$queryRawUnsafe(
    `SELECT c.expedisi_id, c.spreadsheet_id, c.url, e.code
       FROM claim_expedisi_sheets c
       LEFT JOIN expedisi e ON e.id = c.expedisi_id`
  );

  log(`\n  Isi tabel saat ini: ${c.b(baris.length)} baris`);

  if (baris.length > 0) {
    fs.writeFileSync(
      CADANGAN,
      JSON.stringify(
        { dibuat: new Date().toISOString(), rows: baris },
        null, 2
      ),
      "utf8"
    );
    log(`  Dicadangkan ke    : ${c.b(CADANGAN)}`);

    const tanpaKode = baris.filter((b) => !b.code);
    if (tanpaKode.length) {
      log(c.y(`\n  ! ${tanpaKode.length} baris tidak punya kode ekspedisi yang cocok.`));
      log(c.dim("    Baris itu tidak akan bisa dikembalikan otomatis —"));
      log(c.dim("    atur ulang lewat halaman Kelola Claim setelah selesai."));
    }
  } else {
    log(c.dim("  Kosong — tidak perlu dicadangkan."));
  }

  await prisma.$executeRawUnsafe(`DROP TABLE claim_expedisi_sheets`);
  log(c.g("\n  ✓ Tabel dihapus."));

  hr();
  log(c.cy("  Langkah berikutnya:\n"));
  log("      npm run db:push");
  log("      npm run db:generate");
  if (baris.length > 0) {
    log("      node tools/fix-claim-table.mjs --restore");
  }
  log("      npm run typecheck\n");
}

(RESTORE ? restore() : dropDenganCadangan())
  .catch((e) => {
    console.error("\n  ✗ Gagal:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
