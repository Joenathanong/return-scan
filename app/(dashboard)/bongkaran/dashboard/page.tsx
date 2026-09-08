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
  Barcode, Clock, Trash2, RefreshCw, FileSpreadsheet,
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
    <div className="max-w-4xl space-y-5">
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
            <p className="font-semibold text-heading text-sm mb-4">14 hari terakhir</p>
            <div className="flex items-end gap-1.5 h-32">
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

          {/* ── Barcode tidak dikenal ── */}
          <div className="card">
            <div className="p-4 pb-2">
              <p className="font-semibold text-heading text-sm flex items-center gap-2">
                <Barcode className="w-4 h-4 text-gray-400" /> Barcode belum terdaftar
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Barcode yang sempat di-scan tapi tidak ada di Master Produk. Namanya
                diketik operator saat itu.
                {isAdmin && " Daftarkan lewat Master Produk supaya tidak berulang."}
              </p>
            </div>
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
            {isAdmin && d.barcodeAsing.length > 0 && (
              <div className="px-4 pb-4">
                <Link href="/admin/produk" className="btn-ghost text-xs">
                  <PackageOpen className="w-3.5 h-3.5" /> Buka Master Produk
                </Link>
              </div>
            )}
          </div>

          {d.waktuMeragukan > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-2.5 text-sm text-amber-800">
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
