/**
 * Tabel prefix resi → kode expedisi (normalized).
 *
 * Satu expedisi bisa punya BANYAK awalan resi yang berbeda,
 * namun semuanya akan masuk ke 1 G-Sheet dengan kode yang sama.
 *
 * Diurutkan terpanjang → terpendek agar prefix lebih spesifik
 * dicek lebih dahulu (contoh: "SPXID" sebelum "SPX").
 */
export const PREFIX_MAP: [prefix: string, code: string][] = ([
  // ── Shopee Express ─────────────────────────────────────────
  ["SPXID",     "SPXID"],
  ["SPX",       "SPXID"],
  ["MYSP",      "SPXID"],
  ["SGSP",      "SPXID"],

  // ── J&T Express ────────────────────────────────────────────
  ["JTEXP",     "JX"],
  ["JTID",      "JX"],
  ["JNT",       "JX"],
  ["JT",        "JX"],
  ["JX",        "JX"],

  // ── JNE ────────────────────────────────────────────────────
  ["JNEID",     "JNE"],
  ["JNE",       "JNE"],

  // ── SiCepat ────────────────────────────────────────────────
  ["SICEPAT",   "SICEPAT"],
  ["SCP",       "SICEPAT"],
  ["SIC",       "SICEPAT"],

  // ── Anteraja (GTL) ─────────────────────────────────────────
  ["ANTERAJA",  "GTL"],
  ["GTL",       "GTL"],
  ["ANT",       "GTL"],

  // ── Tokopedia Sameday ──────────────────────────────────────
  ["TKSM",      "TKP"],
  ["TKP",       "TKP"],

  // ── Grab Express ───────────────────────────────────────────
  ["GRAB",      "GRAB"],
  ["GXC",       "GRAB"],
  ["GXS",       "GRAB"],

  // ── ID Express ─────────────────────────────────────────────
  ["IDEXPRESS", "IDEXPRESS"],
  ["IDXP",      "IDEXPRESS"],
  ["IDEX",      "IDEXPRESS"],
  ["IDS",       "IDEXPRESS"],
  ["IDE",       "IDEXPRESS"],

  // ── Lion Parcel ────────────────────────────────────────────
  ["LION",      "LION"],
  ["LPN",       "LION"],
  ["LP",        "LION"],

  // ── Ninja Xpress ───────────────────────────────────────────
  ["NXID",      "NINJA"],
  ["NX",        "NINJA"],

  // ── Wahana ─────────────────────────────────────────────────
  ["WHN",       "WAHANA"],
  ["WH",        "WAHANA"],

  // ── Tiki ───────────────────────────────────────────────────
  ["TIKI",      "TIKI"],
  ["TK",        "TIKI"],

  // ── POS Indonesia ──────────────────────────────────────────
  ["POS",       "POS"],

  // ── Lainnya ────────────────────────────────────────────────
  ["REX",       "REX"],
  ["SAP",       "SAP"],
  ["NCS",       "NCS"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

/** Deteksi kode expedisi dari nomor resi. */
export function detectExpedisi(noResi: string): string {
  const r = String(noResi).toUpperCase().trim();
  for (const [prefix, code] of PREFIX_MAP) {
    if (r.startsWith(prefix)) return code;
  }
  const m = r.match(/^([A-Z]+)/);
  return m ? m[1] : "UNKNOWN";
}

/** Kembalikan semua prefix yang dikenali untuk 1 kode expedisi. */
export function getPrefixesForExpedisi(code: string): string[] {
  return PREFIX_MAP.filter(([, c]) => c === code).map(([p]) => p);
}

/** Map: kode expedisi → array prefix (untuk info di UI). */
export function buildExpedisiPrefixMap(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [prefix, code] of PREFIX_MAP) {
    if (!m.has(code)) m.set(code, []);
    m.get(code)!.push(prefix);
  }
  return m;
}
