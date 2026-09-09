"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import { LABEL_KONDISI, type Kondisi } from "@/lib/bongkaran";
import {
  Loader2, AlertCircle, CheckCircle2, X, PackageOpen,
  Barcode, Clock, Trash2, RefreshCw, FileSpreadsheet, Video, Wand2,
  Eye, Save, ChevronRight, Brush, FileWarning,
} from "lucide-react";

/**
 * "3 jam lalu" / "2 hari lalu".
 *
 * Umur JAUH lebih berguna daripada jam absolut di panel ini: yang ingin
 * diketahui bukan "pukul berapa", melainkan "apakah ini masih mungkin
 * sedang dikerjakan seseorang".
 */
function umurSingkat(iso: string, sekarang = Date.now()): string {
  const ms = sekarang - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const menit = Math.floor(ms / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

interface Data {
  tanggal: string;
  ringkasan: { resi: number; barang: number; qty: number };
  kondisi: { kondisi: Kondisi; barang: number; qty: number }[];
  grafik: { tanggal: string; resi: number }[];
  operator: {
    id: string; nama: string; resi: number;
    /** Berapa di antaranya dibongkar tanpa nomor resi. */
    tanpaResi: number;
    terakhir: string | null;
  }[];
  /** Total paket tanpa nomor resi hari ini. */
  tanpaResi: number;
  draft: { id: string; noResi: string; tanggal: string; scannedAt: string; oleh: string }[];
  /** Seluruh draft yang ada, termasuk yang tidak ikut ditampilkan. */
  draftTotal: number;
  /** Ambang umur penyapuan otomatis, dari server. */
  draftUmurSapuJam: number;
  barcodeAsing: { barcode: string; jumlah: number; namaDitulis: string }[];
  waktuMeragukan: number;
  kamera: { kamera: number | null; resi: number }[];
}

/** Isi satu draft, dari GET /api/bongkaran/[id]. */
interface IsiDraft {
  id: string;
  noResi: string;
  scannedAt: string;
  date: string;
  status: string;
  waktuDariKlien: boolean;
  scannedByName: string;
  items: {
    id: string;
    urutan: number;
    kondisi: string;
    barcode: string | null;
    sku: string | null;
    namaProduk: string | null;
    namaDiterima: string | null;
    qty: number;
    batch: string | null;
    edDate: string | null;
  }[];
}

/**
 * Warna kartu kondisi — versi lembut dari warna yang sama dengan tombol di
 * layar scan, supaya angka di dashboard dan tombol yang menghasilkannya
 * terbaca sebagai hal yang sama.
 */
const WARNA: Record<Kondisi, string> = {
  BAGUS:         "bg-ok-bg text-ok-strong border-ok/30",
  RUSAK_KEMASAN: "bg-warn-bg text-warn border-warn/30",
  RUSAK_TOTAL:   "bg-bad-bg text-bad border-bad/25",
  ISI_SALAH:     "bg-accent/5 text-accent border-accent/25",
};

function jamWIB(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export default function BongkaranDashboardPage() {
  return (
    <AuthGuard>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  /**
   * Diisi langsung dengan tanggal WIB hari ini, bukan dibiarkan kosong lalu
   * ditambal dari balasan server: kalau kosong, pengisian dari balasan akan
   * mengubah dependensi `muat` dan halaman memuat dua kali setiap dibuka.
   */
  const [tanggal, setTanggal] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())
  );
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      setD(await mintaJson<Data>(`/api/bongkaran/dashboard?tanggal=${tanggal}`));
    } catch (e) {
      setError(pesanError(e, "Gagal memuat dashboard."));
    } finally {
      setLoading(false);
    }
  }, [tanggal]);

  useEffect(() => { muat(); }, [muat]);

  const [mencocokkan, setMencocokkan] = useState(false);

  /**
   * Mencocokkan ulang barcode "belum terdaftar" dengan Master Produk.
   *
   * Tanda "belum terdaftar" itu benar SAAT barangnya di-scan. Begitu admin
   * mendaftarkan barcode-nya, tanda tadi jadi usang — tapi baris lamanya
   * tetap menyandangnya dan terus muncul di daftar ini, sehingga orang
   * menyimpulkan pendaftarannya gagal padahal berhasil. Tombol ini yang
   * membereskannya, dan sekaligus menjawab pertanyaan "barcode ini
   * sebenarnya sudah terdaftar belum?" dengan memeriksa, bukan menebak.
   */
  const cocokkanUlang = async () => {
    setMencocokkan(true);
    setError("");
    try {
      const r = await mintaJson<{
        diperbaiki: number; barisDiperbaiki: number; masihAsing: string[];
      }>("/api/bongkaran/cocokkan", { method: "POST", body: {}, timeoutMs: 60_000 });

      if (r.barisDiperbaiki === 0) {
        setInfo(
          r.masihAsing.length > 0
            ? `Tidak ada yang cocok. ${r.masihAsing.length} barcode memang belum ada di Master Produk — daftarkan dulu di sana, lalu tekan tombol ini lagi.`
            : "Tidak ada barcode yang perlu dicocokkan."
        );
      } else {
        setInfo(
          `${r.diperbaiki} barcode cocok — ${r.barisDiperbaiki} baris diperbaiki` +
            (r.masihAsing.length > 0
              ? `. ${r.masihAsing.length} barcode masih belum terdaftar.`
              : ". Daftarnya bersih sekarang.")
        );
      }
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal mencocokkan barcode."));
    } finally {
      setMencocokkan(false);
    }
  };

  /**
   * Draft yang sedang diperiksa isinya. `null` = dialog tertutup.
   *
   * Isinya ditarik SAAT tombol ditekan, bukan diikutkan di balasan
   * dashboard: daftar draft bisa memuat lima puluh baris, dan menarik
   * seluruh barang untuk semuanya hanya demi satu yang mungkin dibuka
   * adalah kerja yang hampir pasti terbuang.
   */
  const [periksa, setPeriksa] = useState<IsiDraft | null>(null);
  const [memuatIsi, setMemuatIsi] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  const lihatIsi = async (id: string) => {
    setMemuatIsi(id);
    setError("");
    try {
      setPeriksa(await mintaJson<IsiDraft>(`/api/bongkaran/${id}`));
    } catch (e) {
      setError(pesanError(e, "Gagal membuka isi draft."));
    } finally {
      setMemuatIsi(null);
    }
  };

  const finalkan = async (x: IsiDraft) => {
    setMemproses(true);
    setError("");
    try {
      const r = await mintaJson<{ jumlahBarang: number }>(
        `/api/bongkaran/${x.id}/finalkan`,
        { method: "POST", body: {} }
      );
      setInfo(`${x.noResi} disimpan — ${r.jumlahBarang} barang masuk ke laporan.`);
      setPeriksa(null);
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal menyimpan draft."));
    } finally {
      setMemproses(false);
    }
  };

  const [menyapu, setMenyapu] = useState(false);

  /**
   * Membersihkan draft basi SEKARANG.
   *
   * Server sudah menyapu sendiri sekali sejam, jadi tombol ini bukan
   * syarat kerja — ia untuk hari yang kacau, saat admin ingin daftarnya
   * bersih sebelum menutup laporan.
   */
  const sapuDraft = async () => {
    setMenyapu(true);
    setError("");
    try {
      const r = await mintaJson<{ pesan: string }>("/api/bongkaran/draft/sapu", {
        method: "POST", body: {}, timeoutMs: 30_000,
      });
      setInfo(r.pesan);
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal membersihkan draft."));
    } finally {
      setMenyapu(false);
    }
  };

  const buangDraft = async (id: string, noResi: string) => {
    try {
      await mintaJson(`/api/bongkaran/${id}`, { method: "DELETE" });
      setInfo(`Draft ${noResi} dibuang.`);
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal membuang draft."));
    }
  };

  const puncak = Math.max(1, ...(d?.grafik.map((g) => g.resi) ?? [1]));

  return (
    <div className="shell">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard Bongkaran</h1>
          <p className="page-sub">Pantauan input harian</p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            className="input-field w-auto"
          />
          <button onClick={muat} className="btn-ghost text-sm">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Muat
          </button>
          <Link href="/bongkaran/export" className="btn-ghost text-sm">
            <FileSpreadsheet className="w-4 h-4" /> Export
          </Link>
        </div>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {loading && !d ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
        </div>
      ) : d ? (
        <>
          {/* ── Angka utama ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Angka label="Resi" nilai={d.ringkasan.resi} />
            <Angka label="Barang" nilai={d.ringkasan.barang} />
            <Angka label="Total Qty" nilai={d.ringkasan.qty} />
          </div>

          {/* ── Kondisi ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {d.kondisi.map((k) => (
              <div key={k.kondisi} className={cn("rounded-xl border p-3", WARNA[k.kondisi])}>
                <p className="text-xs font-medium">{LABEL_KONDISI[k.kondisi]}</p>
                <p className="text-2xl font-bold tabular-nums mt-0.5">{k.barang.toLocaleString("id-ID")}</p>
                <p className="text-xs opacity-70">{k.qty.toLocaleString("id-ID")} pcs</p>
              </div>
            ))}
          </div>

          {/* ── Grafik 14 hari ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="accent-bar" aria-hidden="true" />
              <p className="font-semibold text-heading text-sm">14 hari terakhir</p>
            </div>
            <div className="flex items-end gap-1.5 h-40 sm:h-48">
              {d.grafik.map((g) => (
                <div key={g.tanggal} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100">
                    {g.resi}
                  </span>
                  <div
                    className={cn(
                      "w-full rounded-t transition-colors",
                      g.tanggal === d.tanggal ? "bg-brand-600" : "bg-gray-200 group-hover:bg-gray-300"
                    )}
                    style={{ height: `${Math.max(2, (g.resi / puncak) * 100)}%` }}
                    title={`${g.tanggal}: ${g.resi} resi`}
                  />
                  <span className="text-[9px] text-gray-400">{g.tanggal.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Sebaran kamera ── */}
          <div className="card p-5">
            <p className="font-semibold text-heading text-sm flex items-center gap-2">
              <Video className="w-4 h-4 text-gray-400" /> Kamera meja bongkar
            </p>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">
              Dipakai mencocokkan jam scan dengan rekaman CCTV. Kalau beberapa meja
              berjalan tapi angkanya menumpuk di satu kamera, ada yang salah pilih di awal.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {d.kamera.map((k) => (
                <div
                  key={k.kamera ?? "tanpa"}
                  className={cn(
                    "rounded-xl border p-3",
                    k.kamera === null
                      ? "bg-gray-50 border-gray-300"
                      : k.resi > 0
                        ? "bg-brand-50 border-brand-200"
                        : "bg-white border-gray-300"
                  )}
                >
                  <p className="text-xs font-medium text-gray-600">
                    {k.kamera === null ? "Tanpa kamera" : `Kamera ${k.kamera}`}
                  </p>
                  <p
                    className={cn(
                      "text-2xl font-bold tabular-nums mt-0.5",
                      k.kamera === null ? "text-gray-400" : "text-brand-700"
                    )}
                  >
                    {k.resi.toLocaleString("id-ID")}
                  </p>
                  <p className="text-xs text-gray-400">resi</p>
                </div>
              ))}
            </div>
          </div>

          {/*
            Dua panel berdampingan di layar lebar.
            Sebelumnya semuanya bertumpuk satu kolom, jadi di layar desktop
            separuh kanan kosong sementara panel-panel pendek ini memanjang
            ke bawah dan memaksa gulir untuk hal yang justru dibaca
            bersamaan tiap pagi.
          */}
          <div className="grid lg:grid-cols-2 gap-5 items-start">
          {/* ── Operator ── */}
          <div className="card">
            <div className="p-4 pb-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-heading text-sm">Per operator</p>
                {d.tanpaResi > 0 && (
                  <p className="text-xs text-warn flex items-center gap-1 mt-0.5">
                    <FileWarning className="w-3 h-3" />
                    {d.tanpaResi} paket dibongkar tanpa nomor resi hari ini
                  </p>
                )}
              </div>
              <Link href="/bongkaran/operator" className="btn-ghost text-xs">
                Lihat detail <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            {d.operator.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 pb-4">Belum ada input hari ini.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {d.operator.map((o) => (
                  <div key={o.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-heading">{o.nama}</span>
                    <span className="text-gray-500 flex items-center gap-3">
                      <span>{o.resi} resi</span>
                      {/* Hanya muncul kalau ADA. Kolom yang selalu terlihat
                          dengan angka 0 berhenti dibaca; angka yang muncul
                          hanya saat berarti sesuatu justru menarik mata. */}
                      {o.tanpaResi > 0 && (
                        <span
                          className="badge-warning inline-flex items-center gap-1"
                          title="Dibongkar tanpa nomor resi — label sobek/tidak terbaca"
                        >
                          <FileWarning className="w-3 h-3" /> {o.tanpaResi} tanpa resi
                        </span>
                      )}
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {jamWIB(o.terakhir)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Draft belum selesai ── */}
          <div className="card">
            <div className="p-4 pb-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-heading text-sm">
                  Belum selesai
                  {d.draftTotal > 0 && (
                    <span className="ml-2 badge-warning">{d.draftTotal}</span>
                  )}
                </p>
                {isAdmin && d.draftTotal > 0 && (
                  <button
                    onClick={sapuDraft}
                    disabled={menyapu}
                    className="btn-ghost text-xs flex-shrink-0"
                    title={`Buang semua draft kosong yang lebih tua dari ${d.draftUmurSapuJam} jam`}
                  >
                    {menyapu
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Brush className="w-3.5 h-3.5" />}
                    Bersihkan
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Resi yang sudah di-scan tapi belum pernah disimpan. Satu baris lahir
                pada detik resi dibaca — itulah yang membuat jam scan bisa dipercaya —
                jadi setiap sesi yang ditinggalkan meninggalkan satu di sini.
                Barang dan status ditulis dalam satu transaksi, jadi draft{" "}
                <em>seharusnya</em> selalu kosong; tekan <strong>Lihat isi</strong>{" "}
                untuk memastikan sendiri.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Yang kosong dan sudah lewat {d.draftUmurSapuJam} jam dibuang otomatis.
                Sesi yang terputus sekarang juga dipulihkan sendiri di layar scan, jadi
                daftar ini seharusnya tinggal berisi yang benar-benar hari ini.
              </p>
              {d.draftTotal > d.draft.length && (
                <p className="text-xs text-gray-400 mt-1">
                  Menampilkan {d.draft.length} terbaru dari {d.draftTotal.toLocaleString("id-ID")}.
                </p>
              )}
            </div>
            {d.draft.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 pb-4">Tidak ada. Bagus.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {d.draft.map((x) => (
                  <div key={x.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-heading truncate">{x.noResi}</p>
                      <p className="text-xs text-gray-400">
                        {x.tanggal} {jamWIB(x.scannedAt)} · {x.oleh} ·{" "}
                        {umurSingkat(x.scannedAt)}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => lihatIsi(x.id)}
                        disabled={memuatIsi === x.id}
                        className="btn-ghost text-xs"
                      >
                        {memuatIsi === x.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Eye className="w-3.5 h-3.5" />}
                        Lihat isi
                      </button>
                      <button
                        onClick={() => buangDraft(x.id, x.noResi)}
                        className="btn-ghost text-xs text-bad hover:bg-bad-bg"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Buang
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          </div>

          {/* ── Barcode tidak dikenal ── */}
          <div className="card">
            <div className="p-4 pb-2">
              <p className="font-semibold text-heading text-sm flex items-center gap-2">
                <Barcode className="w-4 h-4 text-gray-400" /> Barcode belum terdaftar
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Barcode yang sempat di-scan tapi tidak ada di Master Produk saat itu.
                Kalau barcode-nya sekarang <em>sudah</em> terdaftar, tekan{" "}
                <strong>Cocokkan ulang</strong> — barisnya akan diperbaiki dengan
                nama resmi dari master dan hilang dari daftar ini.
              </p>
            </div>
            {d.barcodeAsing.length > 0 && (
              <div className="px-4 pb-3 flex flex-wrap gap-2">
                <button
                  onClick={cocokkanUlang}
                  disabled={mencocokkan}
                  className="btn-secondary text-xs"
                >
                  {mencocokkan
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Wand2 className="w-3.5 h-3.5" />}
                  Cocokkan ulang dengan Master Produk
                </button>
                {isAdmin && (
                  <Link href="/admin/produk" className="btn-ghost text-xs">
                    <PackageOpen className="w-3.5 h-3.5" /> Buka Master Produk
                  </Link>
                )}
              </div>
            )}

            {d.barcodeAsing.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 pb-4">Tidak ada.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {d.barcodeAsing.map((b) => (
                  <div key={b.barcode} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-heading truncate">{b.barcode}</p>
                      <p className="text-xs text-gray-500 truncate">{b.namaDitulis || "—"}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{b.jumlah}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {d.waktuMeragukan > 0 && (
            <div className="bg-warn-bg border border-warn/30 rounded-xl px-4 py-3 flex gap-2.5 text-sm text-warn">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                {d.waktuMeragukan} resi dalam 14 hari terakhir waktunya diambil dari jam
                PDT, bukan dari server — perangkatnya sedang tidak terhubung saat resi
                di-scan. Jam pada baris itu hanya seakurat jam perangkatnya.
              </p>
            </div>
          )}
        </>
      ) : null}

      {periksa && (
        <DialogIsiDraft
          draft={periksa}
          memproses={memproses}
          onTutup={() => setPeriksa(null)}
          onSimpan={() => finalkan(periksa)}
          onBuang={() => {
            setPeriksa(null);
            buangDraft(periksa.id, periksa.noResi);
          }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Dialog: isi sebuah draft
   ══════════════════════════════════════════════════════════════════════════ */

function DialogIsiDraft({
  draft, memproses, onTutup, onSimpan, onBuang,
}: {
  draft: IsiDraft;
  memproses: boolean;
  onTutup: () => void;
  onSimpan: () => void;
  onBuang: () => void;
}) {
  const kosong = draft.items.length === 0;

  return (
    <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-heading">Isi draft</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-mono">{draft.noResi}</span> · {draft.date}{" "}
              {jamWIB(draft.scannedAt)} · {draft.scannedByName}
            </p>
          </div>
          <button onClick={onTutup} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {kosong ? (
          <div className="bg-gray-50 border border-gray-300 rounded-xl px-4 py-6 text-center space-y-1.5">
            <p className="font-medium text-heading">Benar-benar kosong</p>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Tidak ada satu pun barang di draft ini. Yang tersimpan hanya nomor
              resi dan jam scan-nya. Tidak ada yang bisa diselamatkan — kalau
              barangnya masih ada, scan ulang resinya di layar Bongkaran.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-warn-bg border border-warn/30 rounded-xl px-4 py-3 text-sm text-warn">
              Draft ini <strong>berisi {draft.items.length} barang</strong> — di luar
              dugaan, karena barang dan status semestinya tersimpan bersamaan.
              Jangan dibuang: simpan saja, datanya sah dan waktunya tetap menunjuk
              saat resi ini di-scan.
            </div>

            <div className="overflow-x-auto scroll-slim border border-gray-300 rounded-xl">
              <table className="w-full text-sm">
                <thead className="thead-ocs">
                  <tr>
                    <th className="num">#</th>
                    <th>Kondisi</th>
                    <th>Barcode</th>
                    <th>Nama</th>
                    <th className="num">Qty</th>
                    <th>Batch</th>
                    <th>ED</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {draft.items.map((i) => (
                    <tr key={i.id} className="row-hover">
                      <td className="px-4 py-2 num tabular-nums text-gray-400">{i.urutan}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {LABEL_KONDISI[i.kondisi as Kondisi] ?? i.kondisi}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{i.barcode || "—"}</td>
                      <td className="px-4 py-2">
                        {i.namaProduk || i.namaDiterima || "—"}
                      </td>
                      <td className="px-4 py-2 num tabular-nums">{i.qty}</td>
                      <td className="px-4 py-2 font-mono text-xs">{i.batch || "—"}</td>
                      <td className="px-4 py-2 text-xs">{i.edDate || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!kosong && (
            <button onClick={onSimpan} disabled={memproses} className="btn-primary flex-1 justify-center">
              {memproses ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan {draft.items.length} barang ini
            </button>
          )}
          <button
            onClick={onBuang}
            disabled={memproses}
            className={cn("btn-ghost text-bad hover:bg-bad-bg", kosong && "flex-1 justify-center")}
          >
            <Trash2 className="w-4 h-4" /> Buang draft
          </button>
          <button onClick={onTutup} className="btn-ghost">Tutup</button>
        </div>
      </div>
    </div>
  );
}

function Angka({ label, nilai }: { label: string; nilai: number }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-heading tabular-nums mt-1">{nilai.toLocaleString("id-ID")}</p>
    </div>
  );
}

function Kotak({
  jenis, pesan, onTutup,
}: { jenis: "error" | "info"; pesan: string; onTutup: () => void }) {
  const err = jenis === "error";
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 flex gap-2 items-start border",
        err ? "bg-bad-bg border-bad/25" : "bg-ok-bg border-ok/30"
      )}
    >
      {err
        ? <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 text-ok-strong flex-shrink-0 mt-0.5" />}
      <p className={cn("text-sm flex-1", err ? "text-bad" : "text-ok-strong")}>{pesan}</p>
      <button onClick={onTutup} className={err ? "text-bad/60" : "text-ok"}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
