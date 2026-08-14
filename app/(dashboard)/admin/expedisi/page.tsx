"use client";

import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import type { Expedisi } from "@/types";
import {
  Truck, Plus, Loader2, AlertCircle, CheckCircle2, X, Pencil, Trash2, Info,
} from "lucide-react";

/** Usulan kode dari nama — hanya saran, admin boleh menggantinya. */
function saranKode(nama: string): string {
  return nama.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
}

export default function AdminExpedisiPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [rows, setRows] = useState<Expedisi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [formBuka, setFormBuka] = useState(false);
  const [fNama, setFNama] = useState("");
  const [fKode, setFKode] = useState("");
  const [kodeDisentuh, setKodeDisentuh] = useState(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editNama, setEditNama] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/expedisi?all=1", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat ekspedisi.");
      setRows(d.rows as Expedisi[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  const buat = async () => {
    setMenyimpan(true);
    setError("");
    try {
      const r = await fetch("/api/expedisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fNama, code: fKode || saranKode(fNama) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal membuat ekspedisi.");
      setInfo(`Ekspedisi "${fNama}" dibuat dengan kode ${d.expedisi.code}.`);
      setFormBuka(false);
      setFNama(""); setFKode(""); setKodeDisentuh(false);
      muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenyimpan(false);
    }
  };

  const simpanNama = async (id: string) => {
    setError("");
    try {
      const r = await fetch(`/api/expedisi/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editNama }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan.");
      setEditId(null);
      muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ubahAktif = async (e: Expedisi) => {
    setError("");
    try {
      const r = await fetch(`/api/expedisi/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !e.active }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal mengubah status.");
      muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const hapus = async (e: Expedisi) => {
    setError("");
    try {
      const r = await fetch(`/api/expedisi/${e.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menghapus.");
      setInfo(`Ekspedisi "${e.name}" dihapus.`);
      muat();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-green-600" /> Master Ekspedisi
          </h1>
          <p className="text-slate-500 mt-1">
            {rows.length} terdaftar · {rows.filter((r) => r.active).length} aktif
          </p>
        </div>
        <button onClick={() => setFormBuka((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" /> Tambah
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          <strong>Kode tidak bisa diubah setelah dibuat.</strong> Kode dipakai
          sebagai nama tab saat ekspor ke Google Sheets, jadi ia harus tetap
          sama selamanya. Nama ekspedisi boleh diganti kapan saja tanpa
          memengaruhi data yang sudah ada — berbeda dari sistem lama, di mana
          mengganti nama ikut mengubah kode dan memutus hubungan dengan data lama.
        </p>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {formBuka && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-slate-800">Ekspedisi baru</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Nama</label>
              <input
                value={fNama}
                onChange={(e) => {
                  setFNama(e.target.value);
                  if (!kodeDisentuh) setFKode(saranKode(e.target.value));
                }}
                className="input-field"
                placeholder="mis. JNE Express"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                Kode <span className="text-slate-400 font-normal">(permanen)</span>
              </label>
              <input
                value={fKode}
                onChange={(e) => {
                  setKodeDisentuh(true);
                  setFKode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"));
                }}
                className="input-field font-mono"
                placeholder="JNE_EXPRESS"
              />
              <p className="text-xs text-slate-400 mt-1">
                Huruf kapital, angka, garis bawah. 2–32 karakter.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={buat}
              disabled={menyimpan || !fNama.trim() || fKode.length < 2}
              className="btn-primary"
            >
              {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
            </button>
            <button onClick={() => setFormBuka(false)} className="btn-ghost">Batal</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-green-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Belum ada ekspedisi.</p>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y divide-slate-100">
          {rows.map((e) => (
            <div key={e.id} className="p-4 flex flex-wrap items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  e.active ? "bg-green-50 text-green-600" : "bg-slate-100 text-slate-400"
                )}
              >
                <Truck className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-[160px]">
                {editId === e.id ? (
                  <div className="flex gap-2">
                    <input
                      value={editNama}
                      onChange={(ev) => setEditNama(ev.target.value)}
                      onKeyDown={(ev) => { if (ev.key === "Enter") simpanNama(e.id); }}
                      className="input-field py-1.5"
                      autoFocus
                    />
                    <button onClick={() => simpanNama(e.id)} className="btn-primary px-3">
                      Simpan
                    </button>
                    <button onClick={() => setEditId(null)} className="btn-ghost px-2">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="font-medium text-slate-800 text-sm">{e.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{e.code}</p>
                  </>
                )}
              </div>

              {editId !== e.id && (
                <div className="flex gap-1.5 items-center flex-wrap">
                  <span className={e.active ? "badge-success" : "badge-gray"}>
                    {e.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button
                    onClick={() => { setEditId(e.id); setEditNama(e.name); }}
                    className="btn-ghost text-xs"
                    title="Ubah nama"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => ubahAktif(e)} className="btn-ghost text-xs">
                    {e.active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                  <button
                    onClick={() => hapus(e)}
                    className="btn-ghost text-xs text-red-600 hover:bg-red-50"
                    title="Hanya bisa kalau belum pernah dipakai"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
        err ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
      )}
    >
      {err
        ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />}
      <p className={cn("text-sm flex-1", err ? "text-red-700" : "text-green-700")}>{pesan}</p>
      <button onClick={onTutup} className={err ? "text-red-400" : "text-green-500"}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
