"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
  Loader2, AlertCircle, CheckCircle2, X, Users, RefreshCw, Download,
  LayoutList, Coffee, Gauge, Clock,
} from "lucide-react";

interface Operator {
  id: string;
  nama: string;
  resi: number;
  barang: number;
  qty: number;
  mulai: string;
  selesai: string;
  rentangMenit: number;
  jamAktif: number;
  rataPerJamAktif: number;
  rataPerJamRentang: number;
  jamTersibuk: number | null;
  resiDiJamTersibuk: number;
  jedaTerpanjangMenit: number;
  jedaTerpanjangMulai: string;
  medianAntarResiMenit: number;
  perJam: number[];
}

interface Data {
  dari: string;
  sampai: string;
  terpotong: boolean;
  totalResi: number;
  operator: Operator[];
  jamTim: number[];
}

const hariIniWIB = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/** 95 → "1j 35m". Menit mentah sulit dibaca begitu melewati satu jam. */
function durasi(menit: number): string {
  if (menit <= 0) return "—";
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return j > 0 ? `${j}j ${m}m` : `${m}m`;
}

const jamLabel = (j: number) => `${String(j).padStart(2, "0")}:00`;

export default function LaporanOperatorPage() {
  return (
    <AuthGuard>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [dari, setDari] = useState(hariIniWIB);
  const [sampai, setSampai] = useState(hariIniWIB);
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      setD(await mintaJson<Data>(`/api/bongkaran/operator?dari=${dari}&sampai=${sampai}`));
    } catch (e) {
      setError(pesanError(e, "Gagal memuat laporan."));
    } finally {
      setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => { muat(); }, [muat]);

  const unduh = async () => {
    if (!d || d.operator.length === 0) return;
    try {
      const XLSX = await import("xlsx");

      const ringkas = d.operator.map((o, i) => ({
        "No.": i + 1,
        "Operator": o.nama,
        "Resi": o.resi,
        "Barang": o.barang,
        "Total Qty": o.qty,
        "Mulai": o.mulai,
        "Selesai": o.selesai,
        "Rentang": durasi(o.rentangMenit),
        "Jam Aktif": o.jamAktif,
        "Rata-rata / Jam Aktif": o.rataPerJamAktif,
        "Rata-rata / Jam Rentang": o.rataPerJamRentang,
        "Jam Tersibuk": o.jamTersibuk === null ? "—" : jamLabel(o.jamTersibuk),
        "Resi di Jam Tersibuk": o.resiDiJamTersibuk,
        "Jeda Terpanjang": durasi(o.jedaTerpanjangMenit),
        "Jeda Mulai": o.jedaTerpanjangMulai || "—",
        "Median Antar-Resi (menit)": o.medianAntarResiMenit,
      }));

      // Sheet kedua: matriks operator × jam. Bentuk inilah yang biasanya
      // ditempel ke laporan shift, dan memaksanya jadi satu sheet dengan
      // ringkasan akan membuat keduanya sulit dibaca.
      const perJam = d.operator.map((o) => {
        const baris: Record<string, string | number> = { Operator: o.nama };
        o.perJam.forEach((n, j) => { baris[jamLabel(j)] = n; });
        baris["Total"] = o.resi;
        return baris;
      });
      const total: Record<string, string | number> = { Operator: "TOTAL" };
      d.jamTim.forEach((n, j) => { total[jamLabel(j)] = n; });
      total["Total"] = d.totalResi;
      perJam.push(total);

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(ringkas);
      ws1["!cols"] = [
        { wch: 5 }, { wch: 24 }, { wch: 8 }, { wch: 9 }, { wch: 11 },
        { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
        { wch: 22 }, { wch: 13 }, { wch: 19 }, { wch: 15 }, { wch: 11 }, { wch: 22 },
      ];
      XLSX.utils.book_append_sheet(wb, ws1, "Ringkasan");
      const ws2 = XLSX.utils.json_to_sheet(perJam);
      ws2["!cols"] = [{ wch: 24 }, ...Array(24).fill({ wch: 6 }), { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Per Jam");
      XLSX.writeFile(wb, `laporan-operator-${dari}_sd_${sampai}.xlsx`);
      setInfo("Laporan diunduh.");
    } catch (e) {
      setError(pesanError(e, "Gagal membuat file Excel."));
    }
  };

  const puncakTim = Math.max(1, ...(d?.jamTim ?? [1]));

  return (
    <div className="shell">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Laporan Operator</h1>
          <p className="page-sub">
            Hasil per operator dari scan pertama sampai terakhir, sebarannya per jam,
            dan kecepatan sebenarnya.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="date" value={dari} onChange={(e) => setDari(e.target.value)}
                 className="input-field w-auto" />
          <span className="text-gray-400 text-sm">s/d</span>
          <input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)}
                 className="input-field w-auto" />
          <button onClick={muat} className="btn-ghost text-sm">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Muat
          </button>
          <button onClick={unduh} disabled={!d || d.operator.length === 0}
                  className="btn-secondary text-sm disabled:opacity-40">
            <Download className="w-4 h-4" /> Excel
          </button>
          <Link href="/bongkaran/dashboard" className="btn-ghost text-sm">
            <LayoutList className="w-4 h-4" /> Dashboard
          </Link>
        </div>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {d?.terpotong && (
        <div className="bg-warn-bg border border-warn/30 rounded-xl px-4 py-3 flex gap-2.5 text-sm text-warn">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>
            Rentang tanggalnya terlalu lebar — angka di bawah dihitung dari sebagian
            data saja. Persempit rentangnya supaya laporannya bisa dipercaya.
          </p>
        </div>
      )}

      {loading && !d ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
        </div>
      ) : !d || d.operator.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            Belum ada bongkaran pada rentang tanggal ini.
          </p>
        </div>
      ) : (
        <>
          {/* ── Sebaran jam seluruh tim ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="accent-bar" aria-hidden="true" />
              <p className="font-semibold text-heading text-sm">Sebaran per jam — seluruh tim</p>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {d.totalResi.toLocaleString("id-ID")} resi. Lembah di tengah grafik
              biasanya jam istirahat; lembah di luar itu layak ditanyakan.
            </p>
            <div className="flex items-end gap-1 h-40 sm:h-48">
              {d.jamTim.map((n, j) => (
                <div key={j} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-gray-400 tabular-nums opacity-0 group-hover:opacity-100">
                    {n}
                  </span>
                  <div
                    className={cn(
                      "w-full rounded-t transition-colors",
                      n > 0 ? "bg-brand-500 group-hover:bg-brand-600" : "bg-gray-200"
                    )}
                    style={{ height: `${Math.max(2, (n / puncakTim) * 100)}%` }}
                    title={`${jamLabel(j)} — ${n} resi`}
                  />
                  <span className="text-[9px] text-gray-400 tabular-nums">
                    {String(j).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Kartu per operator ── */}
          <div className="grid xl:grid-cols-2 gap-5 items-start">
            {d.operator.map((o) => (
              <KartuOperator key={o.id} o={o} />
            ))}
          </div>

          {/* ── Tabel ringkas ── */}
          <div className="card overflow-hidden">
            <div className="p-4 pb-2">
              <p className="font-semibold text-heading text-sm">Ringkasan</p>
              <p className="text-xs text-gray-500 mt-0.5">
                <strong>Rata-rata/jam aktif</strong> menjawab seberapa cepat ia bekerja
                saat sedang bekerja. <strong>Rata-rata/jam rentang</strong> menjawab
                berapa hasilnya per jam shift, termasuk saat berhenti. Kalau keduanya
                berjauhan, yang bermasalah bukan kecepatannya melainkan jedanya.
              </p>
            </div>
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="thead-ocs">
                  <tr>
                    <th>Operator</th>
                    <th className="num">Resi</th>
                    <th className="num">Barang</th>
                    <th className="num">Qty</th>
                    <th>Mulai</th>
                    <th>Selesai</th>
                    <th>Rentang</th>
                    <th className="num">Jam aktif</th>
                    <th className="num">Rata/jam aktif</th>
                    <th className="num">Rata/jam rentang</th>
                    <th className="num">Median antar-resi</th>
                    <th>Jeda terpanjang</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {d.operator.map((o) => (
                    <tr key={o.id} className="row-hover">
                      <td className="px-4 py-3 font-medium text-heading">{o.nama}</td>
                      <td className="px-4 py-3 num tabular-nums font-semibold">{o.resi}</td>
                      <td className="px-4 py-3 num tabular-nums">{o.barang}</td>
                      <td className="px-4 py-3 num tabular-nums">{o.qty.toLocaleString("id-ID")}</td>
                      <td className="px-4 py-3 tabular-nums">{o.mulai}</td>
                      <td className="px-4 py-3 tabular-nums">{o.selesai}</td>
                      <td className="px-4 py-3 tabular-nums">{durasi(o.rentangMenit)}</td>
                      <td className="px-4 py-3 num tabular-nums">{o.jamAktif}</td>
                      <td className="px-4 py-3 num tabular-nums font-medium text-brand-700">
                        {o.rataPerJamAktif}
                      </td>
                      <td className="px-4 py-3 num tabular-nums">{o.rataPerJamRentang}</td>
                      <td className="px-4 py-3 num tabular-nums">
                        {o.medianAntarResiMenit ? `${o.medianAntarResiMenit}m` : "—"}
                      </td>
                      <td className={cn("px-4 py-3 tabular-nums",
                                        o.jedaTerpanjangMenit >= 60 && "text-warn font-medium")}>
                        {durasi(o.jedaTerpanjangMenit)}
                        {o.jedaTerpanjangMulai && (
                          <span className="text-gray-400"> · dari {o.jedaTerpanjangMulai}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kartu satu operator
   ══════════════════════════════════════════════════════════════════════════ */

function KartuOperator({ o }: { o: Operator }) {
  const puncak = Math.max(1, ...o.perJam);
  // Hanya jam yang relevan yang digambar — memaksa 24 batang membuat
  // separuh grafik kosong dan batang yang berisi jadi terlalu rapat.
  const jamAda = o.perJam.map((n, j) => ({ n, j })).filter((x) => x.n > 0);
  const awal = jamAda.length ? jamAda[0].j : 0;
  const akhir = jamAda.length ? jamAda[jamAda.length - 1].j : 23;
  const rentang = o.perJam.map((n, j) => ({ n, j })).filter((x) => x.j >= awal && x.j <= akhir);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-heading truncate">{o.nama}</p>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {o.mulai} – {o.selesai} · {durasi(o.rentangMenit)}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-3xl font-bold text-brand-700 tabular-nums leading-none">{o.resi}</p>
          <p className="text-xs text-gray-400 mt-1">resi</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Petak label="Rata/jam aktif" nilai={String(o.rataPerJamAktif)} ikon={<Gauge className="w-3.5 h-3.5" />} />
        <Petak label="Median antar-resi" nilai={o.medianAntarResiMenit ? `${o.medianAntarResiMenit}m` : "—"} />
        <Petak
          label="Jeda terpanjang"
          nilai={durasi(o.jedaTerpanjangMenit)}
          ikon={<Coffee className="w-3.5 h-3.5" />}
          waspada={o.jedaTerpanjangMenit >= 60}
        />
      </div>

      <div>
        <div className="flex items-end gap-1 h-20">
          {rentang.map(({ n, j }) => (
            <div key={j} className="flex-1 flex flex-col items-center gap-1 group">
              <div
                className={cn(
                  "w-full rounded-t",
                  n === 0
                    ? "bg-gray-200"
                    : j === o.jamTersibuk
                      ? "bg-accent"
                      : "bg-brand-400"
                )}
                style={{ height: `${Math.max(3, (n / puncak) * 100)}%` }}
                title={`${jamLabel(j)} — ${n} resi`}
              />
              <span className="text-[9px] text-gray-400 tabular-nums">
                {String(j).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
        {o.jamTersibuk !== null && (
          <p className="text-xs text-gray-500 mt-2">
            Tersibuk {jamLabel(o.jamTersibuk)} — {o.resiDiJamTersibuk} resi
            {o.jedaTerpanjangMulai && o.jedaTerpanjangMenit >= 30 && (
              <> · berhenti {durasi(o.jedaTerpanjangMenit)} sejak {o.jedaTerpanjangMulai}</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Petak({
  label, nilai, ikon, waspada,
}: { label: string; nilai: string; ikon?: React.ReactNode; waspada?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border p-2.5",
      waspada ? "bg-warn-bg border-warn/30" : "bg-gray-50 border-gray-300"
    )}>
      <p className="text-[11px] text-gray-500 flex items-center gap-1">{ikon} {label}</p>
      <p className={cn(
        "text-lg font-bold tabular-nums mt-0.5",
        waspada ? "text-warn" : "text-heading"
      )}>
        {nilai}
      </p>
    </div>
  );
}

function Kotak({
  jenis, pesan, onTutup,
}: { jenis: "error" | "info"; pesan: string; onTutup: () => void }) {
  const err = jenis === "error";
  return (
    <div className={cn(
      "rounded-xl px-4 py-3 flex gap-2 items-start border",
      err ? "bg-bad-bg border-bad/25" : "bg-ok-bg border-ok/30"
    )}>
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
