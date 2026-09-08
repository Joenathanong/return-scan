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
} from "lucide-react";

interface Data {
  tanggal: string;
  ringkasan: { resi: number; barang: number; qty: number };
  kondisi: { kondisi: Kondisi; barang: number; qty: number }[];
  grafik: { tanggal: string; resi: number }[];
  operator: { id: string; nama: string; resi: number; terakhir: string | null }[];
  draft: { id: string; noResi: string; tanggal: string; scannedAt: string; oleh: string }[];
  barcodeAsing: { barcode: string; jumlah: number; namaDitulis: string }[];
  waktuMeragukan: number;
  kamera: { kamera: number | null; resi: number }[];
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
            <p className="font-semibold text-heading text-sm p-4 pb-2">Per operator</p>
            {d.operator.length === 0 ? (
              <p className="text-sm text-gray-400 px-4 pb-4">Belum ada input hari ini.</p>
            ) : (
              <div className="divide-y divide-gray-200">
                {d.operator.map((o) => (
                  <div key={o.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-heading">{o.nama}</span>
                    <span className="text-gray-500 flex items-center gap-3">
                      <span>{o.resi} resi</span>
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
              <p className="font-semibold text-heading text-sm">
                Belum selesai
                {d.draft.length > 0 && (
                  <span className="ml-2 badge-warning">{d.draft.length}</span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Resi yang sudah di-scan tapi belum pernah disimpan — biasanya PDT mati
                atau operator keluar di tengah jalan. Isinya kosong, jadi aman dibuang.
              </p>
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
                        {x.tanggal} {jamWIB(x.scannedAt)} · {x.oleh}
                      </p>
                    </div>
                    <button
                      onClick={() => buangDraft(x.id, x.noResi)}
                      className="btn-ghost text-xs text-red-600 hover:bg-red-50 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Buang
                    </button>
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
