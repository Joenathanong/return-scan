"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { formatTanggalPanjang } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  ScanLine, Package, PackageOpen, Database, Loader2,
  AlertCircle, ArrowRight, TrendingUp,
} from "lucide-react";

interface Stats {
  tanggal: string;
  totalHariIni: number;
  karungHariIni: number;
  karungTerbuka: number;
  totalKeseluruhan: number;
  perEkspedisi: { expedisiId: string; name: string; code: string; jumlah: number }[];
  harian: { date: string; jumlah: number }[];
}

const n = (v: number) => v.toLocaleString("id-ID");

export default function DashboardPage() {
  const { appUser } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal memuat data.");
        setStats(data as Stats);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2 max-w-xl">
        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{error || "Data tidak tersedia."}</p>
      </div>
    );
  }

  const puncak = Math.max(1, ...stats.harian.map((h) => h.jumlah));

  const kartu = [
    { label: "Resi hari ini", nilai: stats.totalHariIni, icon: ScanLine, warna: "text-green-600 bg-green-50" },
    { label: "Karung hari ini", nilai: stats.karungHariIni, icon: Package, warna: "text-blue-600 bg-blue-50" },
    { label: "Karung belum dikunci", nilai: stats.karungTerbuka, icon: PackageOpen, warna: "text-amber-600 bg-amber-50" },
    { label: "Total resi tersimpan", nilai: stats.totalKeseluruhan, icon: Database, warna: "text-slate-600 bg-slate-100" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Halo, {appUser?.name?.split(" ")[0] ?? "—"}
          </h1>
          <p className="text-slate-500 mt-1">{formatTanggalPanjang(stats.tanggal)}</p>
        </div>
        <Link href="/scan" className="btn-primary">
          <ScanLine className="w-4 h-4" /> Mulai Scan
        </Link>
      </div>

      {/* Kartu angka */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kartu.map((k) => (
          <div key={k.label} className="card p-4">
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", k.warna)}>
              <k.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{n(k.nilai)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tujuh hari terakhir */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-green-600" /> Tujuh hari terakhir
        </h2>
        <div className="flex items-end gap-2 h-32">
          {stats.harian.map((h) => (
            <div key={h.date} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <span className="text-xs font-medium text-slate-600 tabular-nums">
                {h.jumlah > 0 ? n(h.jumlah) : ""}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-md transition-all",
                  h.date === stats.tanggal ? "bg-green-600" : "bg-green-200"
                )}
                style={{ height: `${Math.max(3, (h.jumlah / puncak) * 100)}%` }}
                title={`${h.date}: ${n(h.jumlah)} resi`}
              />
              <span className="text-[10px] text-slate-400 truncate w-full text-center">
                {h.date.slice(8)}/{h.date.slice(5, 7)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per ekspedisi */}
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800 mb-4">Per ekspedisi hari ini</h2>
        {stats.perEkspedisi.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            Belum ada scan hari ini.
          </p>
        ) : (
          <div className="space-y-2">
            {stats.perEkspedisi.map((e) => (
              <div key={e.expedisiId} className="flex items-center gap-3">
                <span className="text-sm text-slate-700 w-40 truncate">{e.name}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-green-500 h-full rounded-full"
                    style={{ width: `${(e.jumlah / stats.perEkspedisi[0].jumlah) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-800 tabular-nums w-14 text-right">
                  {n(e.jumlah)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Link
        href="/scan"
        className="card p-4 flex items-center gap-3 hover:border-green-300 transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
          <ScanLine className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-slate-800 text-sm">Scan resi retur</p>
          <p className="text-xs text-slate-500">Pilih ekspedisi dan karung, lalu mulai scan</p>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-400" />
      </Link>
    </div>
  );
}
