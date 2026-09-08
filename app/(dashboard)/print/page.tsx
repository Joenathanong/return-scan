"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { formatTanggalPanjang, todayWIB } from "@/lib/date";
import type { Karung } from "@/types";
import {
  Printer, ArrowLeft, Loader2, Lock, Package, FileText,
  Truck, CheckSquare, Square, AlertCircle, RefreshCw,
} from "lucide-react";

// ── Konfigurasi kapasitas per ukuran kertas ──────────────────────────────────
//
// Angka-angka ini DIUKUR dari hasil cetak sungguhan (Letter, 544 resi,
// dirender 110 dpi lalu dihitung posisi garis tabelnya):
//   • batas bawah cetak yang benar-benar terpakai  y ≈ 1189 px dari 1210 px
//   • tinggi satu baris tabel .............. 23,1 px
//   • kop besar (logo + judul + kotak info)  176 px lebih tinggi dari kop
//     ringkas halaman lanjutan  →  setara 7,6 baris
//   • kaki dokumen (total + Keterangan + tanda
//     tangan + baris penutup) .............. 276 px  →  setara 12 baris
//     (250 px bila baris "Halaman X dari Y" dimatikan)
//   • baris "Halaman X dari Y" ............. 26 px   →  setara 1,1 baris
//   • posisi awal tabel: y=66 (kop ringkas), y=242 (kop besar)
//
// Kapasitas = (batas bawah − posisi awal tabel − kaki) ÷ 23,1 − 1 baris judul:
//   Letter tengah   (1189 − 66)        ÷ 23,1 − 1 = 47,6  → 47
//   Letter pertama  (1189 − 242)       ÷ 23,1 − 1 = 40,0  → 39  (sisa 1 baris
//                                                    cadangan; di sinilah dulu
//                                                    luberan terjadi)
//   Letter terakhir (1189 − 66 − 250)  ÷ 23,1 − 1 = 36,8  → 36
//   Letter tunggal  (1189 − 242 − 250) ÷ 23,1 − 1 = 29,2  → 28
//
// Karena itu halaman punya TIGA kapasitas berbeda, bukan dua:
//
//   TC_FIRST   halaman pertama  — dikurangi 8 baris untuk kop besar
//   TC_MIDDLE  halaman tengah   — kapasitas penuh
//   TC_LAST    halaman terakhir — dikurangi 14 baris untuk kaki dokumen
//   TC_ONLY    satu-satunya halaman — menanggung kop besar DAN kaki dokumen
//
// Sistem lama hanya punya TC_FIRST dan TC_MIDDLE, dan selisih TC_FIRST-nya
// cuma 3 baris (41 vs 44) padahal kop besar memakan 7,6 baris. Akibatnya
// halaman pertama selalu kelebihan satu baris, yang tumpah ke lembar
// berikutnya bersama baris judul tabel — itulah "halaman 2 yang isinya
// sedikit". Kaki dokumen tidak pernah diperhitungkan sama sekali; dulu tidak
// ketahuan karena halaman terakhir kebetulan selalu kebagian sisa yang
// sedikit.
type PaperSize = "a4" | "letter";

interface PaperConfig {
  /** Batas maksimum untuk tampilan 1 kolom (kop besar + kaki, satu halaman). */
  SC_ONLY: number;
  /** Baris PER KOLOM pada mode 2 kolom. */
  TC_ONLY: number;
  TC_FIRST: number;
  TC_MIDDLE: number;
  TC_LAST: number;
  /**
   * Cetak baris "Halaman X dari Y" di kaki tiap halaman?
   * Dimatikan untuk Letter atas permintaan operator: kertas dot matrix
   * bersambung dicetak berurutan dan tidak pernah tertukar, jadi penanda
   * itu hanya memakan ruang yang bisa dipakai satu baris resi lagi.
   */
  nomorHalaman: boolean;
  /** String CSS untuk @page size */
  cssSize: string;
  /** Label untuk tombol pemilih */
  label: string;
}

const PAPER: Record<PaperSize, PaperConfig> = {
  // A4 — JANGAN diubah tanpa mengukur hasil cetak A4 yang sebenarnya.
  //
  // SC_ONLY, TC_FIRST, dan TC_MIDDLE dikembalikan persis seperti sistem lama
  // (22 / 44 / 48) karena operator memastikan hasil cetak A4 selama ini sudah
  // pas. Saya sempat menurunkan TC_FIRST 44 → 40 dengan menerapkan hasil
  // pengukuran Letter ke A4; itu keliru — A4 lebih tinggi 17,6 mm, jadi
  // angkanya tidak bisa dipinjam begitu saja.
  //
  // TC_LAST dan TC_ONLY memang TIDAK ADA di sistem lama, jadi tidak ada nilai
  // lama yang bisa dikembalikan. Keduanya wajib ada sekarang karena pembagian
  // halaman tidak lagi menyisakan remah untuk halaman terakhir; tanpa jatah
  // kaki dokumen, blok tanda tangan akan tumpah ke lembar berikutnya.
  // Jatahnya 12 baris — hasil pengukuran langsung tinggi kaki dokumen
  // (276 px ÷ 23,1 px), dan itu TIDAK bergantung pada ukuran kertas karena
  // isinya HTML yang sama persis.
  //   TC_LAST = TC_MIDDLE − 12 = 36
  //   TC_ONLY = TC_FIRST  − 12 = 32   (kop besar dan kaki di satu halaman)
  a4: {
    SC_ONLY: 22,
    TC_ONLY: 32, TC_FIRST: 44, TC_MIDDLE: 48, TC_LAST: 36,
    nomorHalaman: true,
    cssSize: "210mm 297mm",
    label: "A4",
  },
  // Halaman tengah 44 → 47 (batas cetak 1189 px, bukan tebakan).
  // Halaman terakhir 30 → 36: perkiraan awal saya memberi jatah 14 baris
  // untuk kaki dokumen, padahal pengukuran menunjukkan hanya 12 — dan
  // tinggal 250 px setelah nomor halaman dimatikan. Selisih itulah ruang
  // kosong yang terlihat di bawah tanda tangan.
  letter: {
    SC_ONLY: 20,
    TC_ONLY: 28, TC_FIRST: 39, TC_MIDDLE: 47, TC_LAST: 36,
    nomorHalaman: false,
    cssSize: "215.9mm 279.4mm",
    label: 'Letter (8.5"×11")',
  },
};

interface PageResult { pages: string[][][]; twoCol: boolean; }

/** Kapasitas halaman ke-i dari total n halaman, dalam BARIS (2 kolom). */
function kapasitasHalaman(i: number, n: number, cfg: PaperConfig): number {
  const perKolom =
    n === 1        ? cfg.TC_ONLY   :
    i === 0        ? cfg.TC_FIRST  :
    i === n - 1    ? cfg.TC_LAST   :
                     cfg.TC_MIDDLE;
  return perKolom * 2;
}

/**
 * Bagi baris menjadi halaman.
 *
 *   ≤ SC_ONLY baris → 1 kolom, 1 halaman
 *   selebihnya      → 2 kolom, disebar SEBANDING dengan kapasitas tiap halaman
 *
 * Sebanding, bukan rata: halaman pertama dan terakhir memang punya ruang
 * lebih sempit, jadi membaginya rata justru membuat keduanya kelebihan.
 * Dengan cara ini setiap halaman terisi pada persentase yang sama dari
 * kapasitasnya sendiri — itulah yang terlihat sebagai "sama penuh".
 *
 * Jumlah halaman tetap yang paling sedikit; yang berubah hanya sebarannya,
 * jadi tidak ada kertas tambahan yang terpakai.
 */
function buildPages(rows: string[][], cfg: PaperConfig): PageResult {
  if (rows.length === 0) return { pages: [[]], twoCol: false };
  if (rows.length <= cfg.SC_ONLY) return { pages: [rows], twoCol: false };

  const total = rows.length;

  // 1. Jumlah halaman paling sedikit yang masih memuat semuanya.
  let n = 1;
  let daya = kapasitasHalaman(0, 1, cfg);
  while (daya < total) {
    n++;
    daya = 0;
    for (let i = 0; i < n; i++) daya += kapasitasHalaman(i, n, cfg);
  }

  const kap = Array.from({ length: n }, (_, i) => kapasitasHalaman(i, n, cfg));

  // 2. Bagi dalam satuan PASANGAN (satu baris kiri + satu baris kanan),
  //    bukan per baris.
  //
  //    Tampilan dua kolom membelah isi halaman di tengah: baris paruh
  //    pertama ke kolom kiri, sisanya ke kanan. Kalau jumlah baris satu
  //    halaman ganjil, pembelahan itu tidak bisa rata dan kolom kiri
  //    kelebihan satu — terlihat sebagai kolom kanan yang lebih pendek.
  //
  //    Menghitung dalam pasangan membuat setiap halaman otomatis genap,
  //    jadi kedua kolomnya selalu sama panjang. Semua kapasitas memang
  //    kelipatan dua (baris per kolom × 2), jadi tidak ada yang hilang.
  const kapPasangan = kap.map((c) => c / 2);
  const totalPasangan = Math.ceil(total / 2);
  const jumlahKapPasangan = kapPasangan.reduce((a, b) => a + b, 0);

  const ideal = kapPasangan.map((c) => (totalPasangan * c) / jumlahKapPasangan);
  const pasangan = ideal.map((v) => Math.floor(v));

  // Sisa pembulatan diberikan ke halaman dengan pecahan terbesar dulu.
  let sisa = totalPasangan - pasangan.reduce((a, b) => a + b, 0);
  const urut = ideal
    .map((v, i) => ({ pecahan: v - Math.floor(v), i }))
    .sort((a, b) => b.pecahan - a.pecahan);
  for (const { i } of urut) {
    if (sisa <= 0) break;
    if (pasangan[i] < kapPasangan[i]) { pasangan[i]++; sisa--; }
  }
  while (sisa > 0) {
    let ada = false;
    for (let i = 0; i < n && sisa > 0; i++) {
      if (pasangan[i] < kapPasangan[i]) { pasangan[i]++; sisa--; ada = true; }
    }
    if (!ada) break;
  }

  // 3. Kembalikan ke satuan baris. Kalau jumlah resi seluruhnya ganjil,
  //    tepat satu baris berlebih — dibuang dari halaman TERAKHIR, supaya
  //    ketidakseimbangan satu baris itu jatuh di halaman penutup dan tidak
  //    terlihat di tengah dokumen.
  const isi = pasangan.map((p) => p * 2);
  let kelebihan = isi.reduce((a, b) => a + b, 0) - total;
  for (let i = n - 1; i >= 0 && kelebihan > 0; i--) {
    const potong = Math.min(kelebihan, isi[i]);
    isi[i] -= potong;
    kelebihan -= potong;
  }

  const pages: string[][][] = [];
  let pos = 0;
  for (const n2 of isi) {
    if (n2 <= 0) continue; // halaman kosong tidak pernah dicetak
    pages.push(rows.slice(pos, pos + n2));
    pos += n2;
  }
  return { pages, twoCol: true };
}

interface ExpedisiGroup {
  expedisiId: string;
  expedisiName: string;
  karungList: Karung[];
}

interface PrintData {
  karung: Karung[];
  rows: string[][];
  total: number;
  expedisiName: string;
  date: string;
  settings: { namaPerusahaan: string; noteTandaTerima: string };
}

export default function PrintPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      }
    >
      <PrintPageInner />
    </Suspense>
  );
}

function PrintPageInner() {
  const params = useSearchParams();
  const router = useRouter();

  const karungIdSingle = params.get("karungId");
  const karungIdsParam = params.get("karungIds");
  const activeIds: string[] = karungIdsParam
    ? karungIdsParam.split(",").filter(Boolean)
    : karungIdSingle
    ? [karungIdSingle]
    : [];

  const today = todayWIB();

  // ── Tampilan cetak ────────────────────────────────────────────────────────
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [paperSize, setPaperSize] = useState<PaperSize>("a4");
  const [dialogKertas, setDialogKertas] = useState(false);
  /** Ukuran yang diminta operator; cetak dijalankan setelah DOM ter-render. */
  const [mintaCetak, setMintaCetak] = useState<PaperSize | null>(null);

  // ── Pemilih karung ────────────────────────────────────────────────────────
  const [selectorDate, setSelectorDate] = useState(today);
  const [expedisiGroups, setExpedisiGroups] = useState<ExpedisiGroup[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeExpedisi, setActiveExpedisi] = useState<string | null>(null);

  // ── Muat data cetak ───────────────────────────────────────────────────────
  const muatData = useCallback(async (ids: string[]) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/print?karungIds=${encodeURIComponent(ids.join(","))}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat data cetak.");
      setData(d as PrintData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeIds.length === 0) return;
    muatData(activeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [karungIdsParam, karungIdSingle]);

  // ── Muat daftar karung untuk pemilih ──────────────────────────────────────
  const muatPemilih = useCallback(async (date: string) => {
    setSelectorLoading(true);
    setSelectedIds(new Set());
    setActiveExpedisi(null);
    try {
      const r = await fetch(`/api/karung?date=${encodeURIComponent(date)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat karung.");

      const groups: Record<string, ExpedisiGroup> = {};
      for (const k of d.rows as Karung[]) {
        if (!groups[k.expedisiId]) {
          groups[k.expedisiId] = {
            expedisiId: k.expedisiId,
            expedisiName: k.expedisiName,
            karungList: [],
          };
        }
        groups[k.expedisiId].karungList.push(k);
      }
      setExpedisiGroups(
        Object.values(groups).sort((a, b) =>
          a.expedisiName.localeCompare(b.expedisiName, "id")
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelectorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeIds.length > 0) return;
    muatPemilih(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pilihan karung — hanya satu ekspedisi per dokumen ─────────────────────
  const toggleKarung = (k: Karung) => {
    const baru = new Set(selectedIds);
    if (baru.has(k.id)) {
      baru.delete(k.id);
      if (baru.size === 0) setActiveExpedisi(null);
    } else {
      if (activeExpedisi && activeExpedisi !== k.expedisiId) baru.clear();
      baru.add(k.id);
      setActiveExpedisi(k.expedisiId);
    }
    setSelectedIds(baru);
  };

  const toggleSemua = (g: ExpedisiGroup) => {
    const semuaTerpilih = g.karungList.every((k) => selectedIds.has(k.id));
    const baru = new Set(selectedIds);
    if (semuaTerpilih) {
      g.karungList.forEach((k) => baru.delete(k.id));
      if (baru.size === 0) setActiveExpedisi(null);
    } else {
      if (activeExpedisi && activeExpedisi !== g.expedisiId) baru.clear();
      g.karungList.forEach((k) => baru.add(k.id));
      setActiveExpedisi(g.expedisiId);
    }
    setSelectedIds(baru);
  };

  const cetakTerpilih = () => {
    if (selectedIds.size === 0) return;
    router.push(`/print?karungIds=${Array.from(selectedIds).join(",")}`);
  };

  // ── Cetak: kunci dulu semua karung yang masih terbuka ─────────────────────
  const jalankanCetak = async () => {
    if (!data) return;
    const terbuka = data.karung.filter((k) => k.status !== "locked");

    if (terbuka.length > 0) {
      setLocking(true);
      try {
        const hasil = await Promise.allSettled(
          terbuka.map((k) =>
            fetch(`/api/karung/${k.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ aksi: "lock" }),
            }).then(async (r) => {
              if (!r.ok) {
                const d = await r.json();
                throw new Error(d.error || "Gagal mengunci karung.");
              }
            })
          )
        );
        const gagal = hasil.filter((h) => h.status === "rejected").length;
        if (gagal > 0) {
          // Penguncian gagal berarti tanda terima ini belum tentu final.
          // Lebih baik operator tahu daripada mencetak dokumen yang
          // karungnya masih bisa ditambahi.
          setError(
            `${gagal} karung gagal dikunci. Dokumen belum final — coba lagi sebelum mencetak.`
          );
          setLocking(false);
          return;
        }
        setData({
          ...data,
          karung: data.karung.map((k) =>
            terbuka.some((t) => t.id === k.id) ? { ...k, status: "locked" as const } : k
          ),
        });
      } finally {
        setLocking(false);
      }
    }

    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 300);
  };

  /**
   * Cetak dipicu lewat efek, bukan langsung di penangan klik.
   *
   * Ukuran kertas menentukan @page size, jumlah baris per halaman, dan mode
   * hitam-putih. Kalau window.print() dipanggil pada klik yang sama dengan
   * setPaperSize, dialog cetak peramban bisa terbuka memakai tata letak
   * ukuran LAMA. Penjaga `mintaCetak !== paperSize` memastikan cetak baru
   * berjalan setelah React selesai me-render ukuran yang dipilih.
   */
  useEffect(() => {
    if (!mintaCetak || mintaCetak !== paperSize) return;
    let batal = false;
    (async () => {
      await jalankanCetak();
      if (!batal) setMintaCetak(null);
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintaCetak, paperSize]);

  // ══════════════════════════════════════════════════════════════════════════
  // TAMPILAN PEMILIH
  // ══════════════════════════════════════════════════════════════════════════
  if (activeIds.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="page-title">Print Tanda Terima</h1>
          <p className="page-sub">
            Pilih karung per ekspedisi — bisa beberapa sekaligus
          </p>
        </div>

        <div className="card p-4">
          <label className="text-xs text-slate-500 mb-1 block">Tanggal</label>
          <input
            type="date"
            value={selectorDate}
            onChange={(e) => { setSelectorDate(e.target.value); muatPemilih(e.target.value); }}
            className="input-field max-w-xs"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="sticky top-4 z-20 bg-brand-600 text-white rounded-2xl px-5 py-3 flex items-center justify-between shadow-lg shadow-brand-200">
            <span className="text-sm font-medium">
              {selectedIds.size} karung dipilih ·{" "}
              {expedisiGroups.find((g) => g.expedisiId === activeExpedisi)?.expedisiName}
            </span>
            <button
              onClick={cetakTerpilih}
              className="bg-white text-brand-700 font-semibold text-sm px-4 py-1.5 rounded-xl flex items-center gap-2 hover:bg-brand-50 transition-colors"
            >
              <Printer className="w-4 h-4" /> Print Gabungan
            </button>
          </div>
        )}

        {selectorLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
          </div>
        ) : expedisiGroups.length === 0 ? (
          <div className="card p-8 text-center text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Tidak ada karung untuk tanggal ini</p>
          </div>
        ) : (
          <div className="space-y-4">
            {expedisiGroups.map((group) => {
              const allSel = group.karungList.every((k) => selectedIds.has(k.id));
              const someSel = group.karungList.some((k) => selectedIds.has(k.id));
              const nonaktif = activeExpedisi !== null && activeExpedisi !== group.expedisiId;

              return (
                <div
                  key={group.expedisiId}
                  className={`card overflow-hidden transition-all ${nonaktif ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <Truck className="w-4 h-4 text-slate-500" />
                      <span className="font-semibold text-slate-800">{group.expedisiName}</span>
                      <span className="badge-info text-xs">{group.karungList.length} karung</span>
                    </div>
                    {!nonaktif && (
                      <button
                        onClick={() => toggleSemua(group)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-700 transition-colors"
                      >
                        {allSel
                          ? <CheckSquare className="w-4 h-4 text-brand-600" />
                          : <Square className="w-4 h-4" />}
                        {allSel ? "Batalkan semua" : "Pilih semua"}
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.karungList.map((k) => {
                      const checked = selectedIds.has(k.id);
                      return (
                        <label
                          key={k.id}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors select-none
                            ${nonaktif ? "cursor-not-allowed" : "hover:bg-slate-50"}
                            ${checked ? "bg-brand-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={nonaktif}
                            onChange={() => !nonaktif && toggleKarung(k)}
                            className="sr-only"
                          />
                          <div
                            className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center border-2 transition-colors
                              ${checked ? "bg-brand-600 border-brand-600" : "border-slate-300"}`}
                          >
                            {checked && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-slate-800 text-sm">Karung #{k.nomorKarung}</p>
                            <p className="text-xs text-slate-400">{k.totalResi} resi</p>
                          </div>
                          {k.status === "locked" && (
                            <span className="badge-warning flex items-center gap-1 text-xs">
                              <Lock className="w-3 h-3" /> Terkunci
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.preventDefault(); router.push(`/print?karungId=${k.id}`); }}
                            className="btn-ghost px-2.5 py-1.5 text-xs text-slate-400 hover:text-brand-700"
                            title="Print karung ini saja"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </label>
                      );
                    })}
                  </div>

                  {someSel && (
                    <div className="px-4 py-3 bg-brand-50 border-t border-brand-100">
                      <button onClick={cetakTerpilih} className="btn-primary w-full text-sm">
                        <Printer className="w-4 h-4" />
                        Print Gabungan {selectedIds.size} Karung ({group.expedisiName})
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAMPILAN CETAK
  // ══════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[300px] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        <p className="text-sm text-slate-400">Menyiapkan tanda terima...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-700 text-sm">Gagal menyiapkan tanda terima</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => muatData(activeIds)} className="btn-secondary">
            <RefreshCw className="w-4 h-4" /> Coba lagi
          </button>
          <button onClick={() => router.push("/print")} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.karung.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Karung tidak ditemukan</p>
        <button onClick={() => router.push("/print")} className="btn-secondary mt-4">
          Kembali
        </button>
      </div>
    );
  }

  const { karung, rows, settings } = data;
  const expedisiName = data.expedisiName;
  const karungNomors = karung.map((k) => `#${k.nomorKarung}`).join(", ");
  const printDate = data.date;
  const namaPerusahaan = settings.namaPerusahaan || "PT. IEG";
  const noteTandaTerima = settings.noteTandaTerima;
  const anyLocked = karung.some((k) => k.status === "locked");

  const cfg = PAPER[paperSize];
  const isDM = paperSize === "letter"; // mode dot matrix hitam-putih
  const { pages, twoCol } = buildPages(rows, cfg);
  const totalPages = Math.max(1, pages.length);

  return (
    <>
      {/* ── Dialog pilih ukuran kertas ─────────────────────────────────────
          Muncul saat tombol cetak ditekan, bukan sebagai pilihan yang selalu
          tampil. Ukuran kertas adalah keputusan sesaat sebelum mencetak —
          menaruhnya sebagai saklar permanen membuat operator gampang lupa
          memeriksanya dan mencetak dengan ukuran sisa dari cetakan lalu. */}
      {dialogKertas && (
        <div
          className="no-print fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setDialogKertas(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Printer className="w-5 h-5 text-brand-600" /> Pilih Ukuran Kertas
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {rows.length} resi · {expedisiName}
              </p>
            </div>

            <div className="space-y-2">
              {(["a4", "letter"] as PaperSize[]).map((ps) => {
                const hal = buildPages(rows, PAPER[ps]).pages.length;
                return (
                  <button
                    key={ps}
                    onClick={() => {
                      setPaperSize(ps);
                      setDialogKertas(false);
                      setMintaCetak(ps);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl border-2 border-slate-200
                               hover:border-brand-500 hover:bg-brand-50 transition-colors"
                  >
                    <p className="font-medium text-slate-800">{PAPER[ps].label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {hal} halaman
                      {ps === "letter" && " · hitam-putih, untuk printer dot matrix"}
                      {ps === "a4" && " · berwarna, dengan logo"}
                    </p>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-slate-400">
              Mencetak akan mengunci karung ini. Setelah terkunci, resi tidak
              bisa ditambahkan lagi kecuali dibuka admin.
            </p>

            <button
              onClick={() => setDialogKertas(false)}
              className="btn-ghost w-full justify-center"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Bar aksi */}
      <div className="no-print max-w-5xl mx-auto mb-6 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/print")} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Preview Tanda Terima</h1>
            <p className="text-sm text-slate-500">
              {expedisiName} · Karung {karungNomors} · {rows.length} resi
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {anyLocked && (
            <span className="badge-warning flex items-center gap-1">
              <Lock className="w-3 h-3" /> Ada karung terkunci
            </span>
          )}

          <button
            onClick={() => setDialogKertas(true)}
            disabled={printing || locking}
            className="btn-primary"
          >
            {printing || locking
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Printer className="w-4 h-4" />}
            {locking ? "Mengunci karung..." : "Print Tanda Terima"}
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print max-w-5xl mx-auto mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm flex-1">{error}</p>
          <button onClick={() => setError("")} className="btn-ghost text-xs text-red-600">
            Tutup
          </button>
        </div>
      )}

      {rows.length === 0 && (
        <div className="no-print max-w-5xl mx-auto mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-amber-800 text-sm">
            Karung ini belum berisi resi apa pun. Tanda terima akan tercetak kosong.
          </p>
        </div>
      )}

      {/* Halaman cetak */}
      <div className="print-container max-w-4xl mx-auto space-y-6">
        {pages.map((pageRows, pageIndex) => (
          <div
            key={pageIndex}
            className={`bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:shadow-none print:overflow-visible ${
              pageIndex > 0 ? "print:break-before-page" : ""
            }`}
            style={pageIndex < totalPages - 1 ? { pageBreakAfter: "always", breakAfter: "page" } : {}}
          >
            <div style={{ padding: "20px 24px", fontFamily: "Arial, sans-serif" }}>
              {/* ── Kepala dokumen ── */}
              {pageIndex === 0 ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      {isDM ? (
                        <span style={{ fontSize: "16px", fontWeight: "700", color: "#000", letterSpacing: "0.5px" }}>
                          {namaPerusahaan}
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src="/logo.png"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.src.endsWith("/logo.jpg")) img.src = "/logo.jpg";
                          }}
                          alt={namaPerusahaan}
                          style={{ height: "48px", maxWidth: "160px", objectFit: "contain" }}
                        />
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        TANDA TERIMA
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>
                        Barang Retur dari Ekspedisi
                      </div>
                    </div>
                  </div>

                  <div style={{ height: "3px", background: isDM ? "#000" : "linear-gradient(to right, #0f172a, #334155)", borderRadius: isDM ? "0" : "2px", margin: "8px 0 10px" }} />

                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr",
                    border: isDM ? "1px solid #000" : "1px solid #e2e8f0",
                    borderRadius: isDM ? "0" : "6px",
                    overflow: "hidden", marginBottom: "12px", fontSize: "11px",
                  }}>
                    {[
                      ["Ekspedisi", expedisiName],
                      ["Tanggal", formatTanggalPanjang(printDate)],
                      ["No. Karung", karung.map((k) => k.nomorKarung).join(", ")],
                      ["Total Resi", `${rows.length} item`],
                    ].map(([label, value], i) => (
                      <div key={i} style={{
                        padding: "5px 12px",
                        borderRight: i % 2 === 0 ? (isDM ? "1px solid #000" : "1px solid #e2e8f0") : "none",
                        borderBottom: i < 2 ? (isDM ? "1px solid #000" : "1px solid #e2e8f0") : "none",
                        backgroundColor: isDM ? "#fff" : (i % 2 === 0 ? "#f8fafc" : "#ffffff"),
                      }}>
                        <span style={{ color: isDM ? "#000" : "#94a3b8", fontSize: "9px", display: "block", marginBottom: "1px" }}>{label}</span>
                        <span style={{ fontWeight: "600", color: "#0f172a" }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {!isDM && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src="/logo.png"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.src.endsWith("/logo.jpg")) img.src = "/logo.jpg";
                          }}
                          alt={namaPerusahaan}
                          style={{ height: "28px", maxWidth: "90px", objectFit: "contain" }}
                        />
                      )}
                      <span style={{ fontSize: "12px", fontWeight: "700", color: isDM ? "#000" : "#0f172a" }}>
                        {isDM ? namaPerusahaan + " · " : ""}TANDA TERIMA{" "}
                        <span style={{ fontWeight: "400", color: isDM ? "#000" : "#64748b" }}>(Lanjutan)</span>
                      </span>
                    </div>
                    <div style={{ fontSize: "10px", color: "#64748b" }}>
                      {expedisiName} · {formatTanggalPanjang(printDate)} · Hal. {pageIndex + 1}/{totalPages}
                    </div>
                  </div>
                  <div style={{ height: "2px", background: isDM ? "#000" : "#e2e8f0", margin: "8px 0 10px" }} />
                </div>
              )}

              {/* ── Tabel ── */}
              {twoCol ? (
                (() => {
                  const mid = Math.ceil(pageRows.length / 2);
                  const leftRows = pageRows.slice(0, mid);
                  const rightRows = pageRows.slice(mid);

                  const TD_STYLE: React.CSSProperties = {
                    padding: "2px 4px",
                    border: isDM ? "1px solid #000" : "1px solid #e2e8f0",
                  };
                  const TH_STYLE: React.CSSProperties = {
                    padding: "4px 4px",
                    color: isDM ? "#000" : "#fff",
                    fontWeight: "700",
                    fontSize: isDM ? "10px" : "9px",
                    border: isDM ? "1px solid #000" : "1px solid #1e293b",
                    whiteSpace: "nowrap",
                    ...(isDM ? { borderBottom: "2px solid #000", backgroundColor: "#fff" } : {}),
                  };

                  const ColTable = ({ colRows }: { colRows: string[][] }) => (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isDM ? "10px" : "9px" }}>
                      <thead>
                        <tr style={{ backgroundColor: isDM ? "#fff" : "#0f172a" }}>
                          <th style={{ ...TH_STYLE, width: "22px", textAlign: "center" }}>No.</th>
                          <th style={{ ...TH_STYLE, width: "98px", textAlign: "left" }}>Kode Resi</th>
                          <th style={{ ...TH_STYLE, width: "44px", textAlign: "center" }}>No.Krg</th>
                          <th style={{ ...TH_STYLE, width: isDM ? "50px" : undefined, textAlign: "left" }}>Di Scan Oleh</th>
                          <th style={{ ...TH_STYLE, width: "42px", textAlign: "center" }}>Jam</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colRows.map((row, i) => (
                          <tr key={i} style={{ backgroundColor: isDM ? "#fff" : (i % 2 === 0 ? "#ffffff" : "#f8fafc") }}>
                            <td style={{ ...TD_STYLE, textAlign: "center", color: isDM ? "#000" : "#94a3b8", fontSize: isDM ? "9px" : "8px" }}>{row[0]}</td>
                            <td style={{ ...TD_STYLE, fontFamily: "monospace", fontWeight: "600", color: isDM ? "#000" : "#0f172a" }}>{row[1]}</td>
                            <td style={{ ...TD_STYLE, textAlign: "center", color: isDM ? "#000" : "#334155" }}>{row[2]}</td>
                            <td style={{ ...TD_STYLE, color: isDM ? "#000" : "#334155" }}>{row[3]}</td>
                            <td style={{ ...TD_STYLE, textAlign: "center", color: isDM ? "#000" : "#475569" }}>{row[5]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );

                  return (
                    <div style={{ display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}><ColTable colRows={leftRows} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}><ColTable colRows={rightRows} /></div>
                    </div>
                  );
                })()
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isDM ? "11px" : "10px", marginBottom: "10px" }}>
                  <thead>
                    <tr style={{ backgroundColor: isDM ? "#fff" : "#0f172a" }}>
                      {["No.", "Kode Resi", "No. Karung", "Di Scan Oleh", "Tanggal", "Jam"].map((h, i) => (
                        <th key={i} style={{
                          padding: "5px 6px",
                          color: isDM ? "#000" : "#ffffff",
                          fontWeight: "600",
                          fontSize: isDM ? "11px" : "10px",
                          border: isDM ? "1px solid #000" : "1px solid #1e293b",
                          ...(isDM ? { borderBottom: "2.5px solid #000", backgroundColor: "#fff" } : {}),
                          textAlign: i === 0 || i >= 4 ? "center" : "left",
                          whiteSpace: "nowrap",
                          ...(i === 0 ? { width: "30px" } : {}),
                          ...(i === 1 ? { width: "120px" } : {}),
                          ...(i === 2 ? { width: "65px" } : {}),
                          ...(i === 3 ? { width: isDM ? "80px" : "155px" } : {}),
                          ...(i === 4 ? { width: "72px" } : {}),
                          ...(i === 5 ? { width: "52px" } : {}),
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, i) => (
                      <tr key={i} style={{ backgroundColor: isDM ? "#fff" : (i % 2 === 0 ? "#ffffff" : "#f8fafc") }}>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", textAlign: "center", color: isDM ? "#000" : "#94a3b8", fontSize: isDM ? "10px" : "9px" }}>{row[0]}</td>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", fontFamily: "monospace", fontWeight: "600", color: isDM ? "#000" : "#0f172a", fontSize: isDM ? "11px" : "10px" }}>{row[1]}</td>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", textAlign: "center", color: isDM ? "#000" : "#334155" }}>{row[2]}</td>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", color: isDM ? "#000" : "#334155" }}>{row[3]}</td>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", textAlign: "center", color: isDM ? "#000" : "#475569" }}>{row[4]}</td>
                        <td style={{ padding: "3px 6px", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", textAlign: "center", color: isDM ? "#000" : "#475569" }}>{row[5]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Total — halaman terakhir */}
              {pageIndex === totalPages - 1 && (
                <div style={{ textAlign: "right", fontWeight: "700", fontSize: "10px", color: "#0f172a", padding: "4px 6px", backgroundColor: isDM ? "#fff" : "#f1f5f9", border: isDM ? "1px solid #000" : "1px solid #e2e8f0", marginBottom: "10px" }}>
                  Total Keseluruhan : {rows.length} resi
                </div>
              )}

              {/* Kaki dokumen — halaman terakhir */}
              {pageIndex === totalPages - 1 && (
                <>
                  <div style={{
                    border: isDM ? "none" : "1px solid #fcd34d",
                    borderLeft: isDM ? "3px solid #000" : "4px solid #f59e0b",
                    borderRadius: isDM ? "0" : "4px",
                    padding: "7px 12px",
                    marginBottom: "18px",
                    backgroundColor: isDM ? "#fff" : "#fffbeb",
                    fontSize: "9px",
                    color: isDM ? "#000" : "#78350f",
                    lineHeight: "1.4",
                  }}>
                    <span style={{ fontWeight: "700", color: isDM ? "#000" : "#92400e" }}>Keterangan : </span>
                    {noteTandaTerima}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px" }}>
                    {[
                      { label: "Yang Menyerahkan,", sub: expedisiName },
                      { label: "Yang Menerima,", sub: namaPerusahaan },
                    ].map((sig, i) => (
                      <div key={i} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "10px", fontWeight: "600", color: isDM ? "#000" : "#334155", marginBottom: isDM ? "28px" : "52px" }}>
                          {sig.label}
                        </div>
                        <div style={{ borderTop: isDM ? "1.5px solid #000" : "1.5px solid #94a3b8", paddingTop: "6px" }}>
                          <div style={{ fontSize: "9px", color: isDM ? "#000" : "#94a3b8" }}>(Nama &amp; Tanda Tangan)</div>
                          <div style={{ fontSize: "10px", fontWeight: "600", color: isDM ? "#000" : "#334155", marginTop: "2px" }}>{sig.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    marginTop: "16px",
                    paddingTop: "8px",
                    borderTop: isDM ? "1px solid #000" : "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "9px",
                    color: isDM ? "#000" : "#cbd5e1",
                  }}>
                    <span>Dokumen ini dicetak secara otomatis oleh sistem</span>
                    <span>
                      {namaPerusahaan} · Dicetak:{" "}
                      {new Date().toLocaleDateString("id-ID", {
                        timeZone: "Asia/Jakarta",
                        day: "2-digit", month: "long", year: "numeric",
                      })}
                    </span>
                  </div>
                </>
              )}

              {cfg.nomorHalaman && totalPages > 1 && (
                <div style={{ marginTop: "12px", textAlign: "right", fontSize: "9px", color: isDM ? "#000" : "#cbd5e1" }}>
                  Halaman {pageIndex + 1} dari {totalPages}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .print-container {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-container > div {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          @page {
            size: ${PAPER[paperSize].cssSize} portrait;
            margin: 1.4cm 1.8cm 2cm 1.8cm;
          }
        }
      `}</style>
    </>
  );
}
