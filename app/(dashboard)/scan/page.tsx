"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { playSuccess, playFailed } from "@/lib/audio";
import { cn } from "@/lib/utils";
import type { Expedisi, Karung, ScanRecord, ScanResult } from "@/types";
import {
  ScanLine, ChevronRight, ChevronLeft, Plus, Loader2, AlertCircle,
  CheckCircle2, XCircle, Lock, Package, Truck, Printer, RefreshCw,
} from "lucide-react";

type Step = "expedisi" | "karung" | "scanning";
type Feedback = "idle" | "success" | "duplicate" | "failed";

/** Di bawah panjang ini resi ditandai mencurigakan — tidak ditolak. */
const WARN_LEN = 8;

/** Buang karakter yang biasa ikut terbawa scanner (prefix/suffix, spasi). */
function bersihkanResi(v: string): string {
  return v.replace(/[\s\r\n\t]+/g, "").toUpperCase();
}

export default function ScanPage() {
  const { appUser } = useAuth();

  const [step, setStep] = useState<Step>("expedisi");
  const [expedisiList, setExpedisiList] = useState<Expedisi[]>([]);
  const [karungList, setKarungList] = useState<Karung[]>([]);
  const [expedisi, setExpedisi] = useState<Expedisi | null>(null);
  const [karung, setKarung] = useState<Karung | null>(null);

  const [muatExpedisi, setMuatExpedisi] = useState(true);
  const [muatKarung, setMuatKarung] = useState(false);
  const [error, setError] = useState("");

  // Form karung baru
  const [nomorBaru, setNomorBaru] = useState("");
  const [buatKarung, setBuatKarung] = useState(false);

  // Keadaan scanning
  const [feedback, setFeedback] = useState<Feedback>("idle");
  const [pesan, setPesan] = useState("");
  const [subPesan, setSubPesan] = useState("");
  const [total, setTotal] = useState(0);
  const [terakhir, setTerakhir] = useState<ScanRecord[]>([]);
  const [proses, setProses] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  /** Kunci sinkron — mencegah double-submit dari scanner yang cepat. */
  const kunciRef = useRef(false);

  // ── Muat ekspedisi ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/expedisi", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Gagal memuat ekspedisi.");
        setExpedisiList(d.rows as Expedisi[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setMuatExpedisi(false));
  }, []);

  // ── Muat karung saat ekspedisi dipilih ────────────────────────────────────
  const muatDaftarKarung = useCallback(async (expedisiId: string) => {
    setMuatKarung(true);
    setError("");
    try {
      const r = await fetch(`/api/karung?expedisiId=${encodeURIComponent(expedisiId)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat karung.");
      setKarungList(d.rows as Karung[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMuatKarung(false);
    }
  }, []);

  const pilihExpedisi = (e: Expedisi) => {
    setExpedisi(e);
    setKarung(null);
    setStep("karung");
    muatDaftarKarung(e.id);
  };

  // ── Buat karung ───────────────────────────────────────────────────────────
  const submitKarungBaru = async () => {
    if (!expedisi || !nomorBaru.trim() || buatKarung) return;
    setBuatKarung(true);
    setError("");
    try {
      const r = await fetch("/api/karung", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expedisiId: expedisi.id, nomorKarung: nomorBaru.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal membuat karung.");
      setNomorBaru("");
      setKarungList((prev) => [d.karung as Karung, ...prev]);
      pilihKarung(d.karung as Karung);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuatKarung(false);
    }
  };

  // ── Pilih karung → masuk mode scanning ────────────────────────────────────
  const pilihKarung = async (k: Karung) => {
    setKarung(k);
    setTotal(k.totalResi);
    setStep("scanning");
    setFeedback("idle");
    setPesan("");
    setSubPesan("");

    try {
      const r = await fetch(`/api/scan?karungId=${encodeURIComponent(k.id)}&limit=20`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (r.ok) setTerakhir(((d.rows ?? []) as ScanRecord[]).slice(-10).reverse());
    } catch {
      // Daftar resi terakhir hanya pelengkap — kegagalan di sini tidak
      // boleh menghalangi operator mulai scan.
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const resetFeedback = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFeedback("idle");
      setPesan("");
      setSubPesan("");
      inputRef.current?.focus();
    }, 1800);
  }, []);

  // ── Kirim satu scan ───────────────────────────────────────────────────────
  const kirimScan = useCallback(
    async (nilai: string) => {
      const resi = bersihkanResi(nilai);
      if (!resi || !karung) {
        kunciRef.current = false;
        return;
      }

      setProses(true);
      try {
        const r = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ karungId: karung.id, noResi: resi }),
        });
        const hasil = (await r.json()) as ScanResult & { error?: string };

        if (!r.ok && hasil.error) {
          setFeedback("failed");
          setPesan(resi);
          setSubPesan(hasil.error);
          await playFailed();
          resetFeedback();
          return;
        }

        switch (hasil.outcome) {
          case "success": {
            setFeedback("success");
            setPesan(resi);
            setSubPesan(
              resi.length < WARN_LEN
                ? `Hanya ${resi.length} karakter — mohon dicek ulang.`
                : ""
            );
            if (typeof hasil.totalResi === "number") setTotal(hasil.totalResi);
            if (hasil.scan) {
              setTerakhir((prev) => [hasil.scan as ScanRecord, ...prev].slice(0, 10));
            }
            await playSuccess();
            break;
          }
          case "duplicate": {
            setFeedback("duplicate");
            setPesan(resi);
            setSubPesan(hasil.duplicateInfo ?? "Sudah pernah di-scan.");
            await playFailed();
            break;
          }
          case "locked": {
            setFeedback("failed");
            setPesan("KARUNG TERKUNCI");
            setSubPesan(hasil.message ?? "");
            await playFailed();
            break;
          }
          default: {
            setFeedback("failed");
            setPesan(resi);
            setSubPesan(hasil.message ?? "Gagal menyimpan.");
            await playFailed();
          }
        }
        resetFeedback();
      } catch {
        setFeedback("failed");
        setPesan(resi);
        // Ini poin penting: kalau jaringan putus, operator DIBERI TAHU dan
        // resi tidak masuk. Di sistem lama, kegagalan pengiriman terjadi
        // diam-diam di latar belakang sementara layar tetap hijau.
        setSubPesan("Koneksi bermasalah — resi BELUM tersimpan. Scan ulang.");
        await playFailed();
        resetFeedback();
      } finally {
        kunciRef.current = false;
        setProses(false);
      }
    },
    [karung, resetFeedback]
  );

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const gayaFeedback = {
    idle: "border-gray-300 bg-white",
    success: "border-brand-400 bg-brand-50",
    duplicate: "border-amber-400 bg-amber-50",
    failed: "border-red-400 bg-red-50",
  }[feedback];

  // ── Tampilan: pilih ekspedisi ─────────────────────────────────────────────
  if (step === "expedisi") {
    return (
      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="page-title">Pilih Ekspedisi</h1>
          <p className="page-sub">Langkah 1 dari 3</p>
        </div>

        {error && <Pesan error={error} />}

        {muatExpedisi ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
          </div>
        ) : expedisiList.length === 0 ? (
          <div className="card p-8 text-center space-y-3">
            <p className="text-gray-500">Belum ada ekspedisi terdaftar.</p>
            {appUser?.role === "admin" ? (
              <p className="text-sm text-gray-400">
                Halaman Master Ekspedisi belum dipindahkan. Sementara ini
                ekspedisi bisa ditambahkan lewat <code className="font-mono">POST /api/expedisi</code>,
                atau dengan menjalankan <code className="font-mono">npm run db:seed</code> setelah
                menyalin <code className="font-mono">seed-master.json</code> dari sistem lama.
              </p>
            ) : (
              <p className="text-sm text-gray-400">Minta admin menambahkannya dulu.</p>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {expedisiList.map((e) => (
              <button
                key={e.id}
                onClick={() => pilihExpedisi(e)}
                className="card p-4 flex items-center gap-3 text-left hover:border-brand-400 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                  <Truck className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-heading truncate">{e.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{e.code}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Tampilan: pilih / buat karung ─────────────────────────────────────────
  if (step === "karung") {
    return (
      <div className="max-w-2xl space-y-5">
        <button
          onClick={() => { setStep("expedisi"); setError(""); }}
          className="text-sm text-gray-500 hover:text-heading flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" /> Ganti ekspedisi
        </button>

        <div>
          <h1 className="page-title">Pilih Karung</h1>
          <p className="page-sub">
            Langkah 2 dari 3 · {expedisi?.name}
          </p>
        </div>

        {error && <Pesan error={error} />}

        <div className="card p-4">
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Buat karung baru
          </label>
          <div className="flex gap-2">
            <input
              value={nomorBaru}
              onChange={(e) => setNomorBaru(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitKarungBaru(); }}
              placeholder="Nomor karung, mis. 1"
              className="input-field flex-1"
              disabled={buatKarung}
            />
            <button
              onClick={submitKarungBaru}
              disabled={!nomorBaru.trim() || buatKarung}
              className="btn-primary flex-shrink-0"
            >
              {buatKarung ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Buat
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-600">Karung hari ini</p>
            <button
              onClick={() => expedisi && muatDaftarKarung(expedisi.id)}
              className="text-xs text-gray-400 hover:text-ink flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Muat ulang
            </button>
          </div>

          {muatKarung ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
            </div>
          ) : karungList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Belum ada karung hari ini. Buat satu di atas.
            </p>
          ) : (
            <div className="space-y-2">
              {karungList.map((k) => {
                const terkunci = k.status === "locked";
                return (
                  <button
                    key={k.id}
                    onClick={() => pilihKarung(k)}
                    disabled={terkunci}
                    className={cn(
                      "card p-4 w-full flex items-center gap-3 text-left transition-colors",
                      terkunci
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:border-brand-400"
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0">
                      {terkunci ? <Lock className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-heading">Karung #{k.nomorKarung}</p>
                      <p className="text-xs text-gray-500">
                        {k.totalResi} resi · dibuat {k.createdByName}
                      </p>
                    </div>
                    {terkunci ? (
                      <span className="badge-danger">Terkunci</span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tampilan: scanning ────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-4">
      <button
        onClick={() => { setStep("karung"); setTerakhir([]); }}
        className="text-sm text-gray-500 hover:text-heading flex items-center gap-1"
      >
        <ChevronLeft className="w-4 h-4" /> Ganti karung
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-heading">
            {expedisi?.name} · Karung #{karung?.nomorKarung}
          </h1>
          <p className="text-gray-500 text-sm">{karung?.date}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-brand-600 tabular-nums">{total}</p>
          <p className="text-xs text-gray-500">resi tersimpan</p>
        </div>
      </div>

      {/* Kotak input + umpan balik */}
      <div className={cn("rounded-2xl border-2 p-5 transition-colors", gayaFeedback)}>
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Scan atau ketik kode resi, lalu Enter"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const val = (inputRef.current?.value ?? "").trim();
            if (inputRef.current) inputRef.current.value = "";
            if (!val || kunciRef.current) return;
            kunciRef.current = true;
            kirimScan(val);
          }}
          disabled={proses}
          className="w-full px-4 py-5 rounded-xl border-2 border-gray-300 text-2xl font-mono
                     tracking-widest text-center focus:outline-none focus:ring-4
                     focus:ring-brand-200 focus:border-brand-400 transition-all
                     disabled:opacity-60"
        />

        <div className="mt-4 min-h-[64px] flex items-center justify-center text-center">
          {feedback === "idle" ? (
            <p className="text-sm text-gray-400">
              {proses ? "Menyimpan..." : "Siap menerima scan"}
            </p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-2">
                {feedback === "success" && <CheckCircle2 className="w-5 h-5 text-brand-600" />}
                {feedback === "duplicate" && <AlertCircle className="w-5 h-5 text-amber-600" />}
                {feedback === "failed" && <XCircle className="w-5 h-5 text-red-600" />}
                <span
                  className={cn(
                    "font-mono font-semibold text-lg break-all",
                    feedback === "success" && "text-brand-700",
                    feedback === "duplicate" && "text-amber-700",
                    feedback === "failed" && "text-red-700"
                  )}
                >
                  {pesan}
                </span>
              </div>
              {subPesan && (
                <p
                  className={cn(
                    "text-sm",
                    feedback === "success" ? "text-amber-600" :
                    feedback === "duplicate" ? "text-amber-700" : "text-red-600"
                  )}
                >
                  {subPesan}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mencetak akan MENGUNCI karung ini — setelah itu tidak bisa
          ditambah scan lagi kecuali dibuka admin. */}
      <Link
        href={`/print?karungId=${karung?.id ?? ""}`}
        className="btn-secondary w-full justify-center"
      >
        <Printer className="w-4 h-4" /> Cetak tanda terima
      </Link>

      {/* Sepuluh terakhir */}
      {terakhir.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">Sepuluh terakhir</p>
          <div className="space-y-1.5">
            {terakhir.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <ScanLine className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                <span className="font-mono text-ink flex-1 truncate">{s.noResi}</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {new Date(s.scannedAt).toLocaleTimeString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Pesan({ error }: { error: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
      <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-700">{error}</p>
    </div>
  );
}
