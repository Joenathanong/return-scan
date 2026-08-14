"use client";

import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/types";
import {
  Users, Plus, Loader2, AlertCircle, CheckCircle2, KeyRound,
  ShieldCheck, User as UserIcon, X,
} from "lucide-react";

export default function AdminUsersPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [formBuka, setFormBuka] = useState(false);
  const [fEmail, setFEmail] = useState("");
  const [fNama, setFNama] = useState("");
  const [fRole, setFRole] = useState<"admin" | "operator">("operator");
  const [fPassword, setFPassword] = useState("");
  const [menyimpan, setMenyimpan] = useState(false);

  const [resetUntuk, setResetUntuk] = useState<AppUser | null>(null);
  const [passwordBaru, setPasswordBaru] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/users", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat user.");
      setRows(d.rows as AppUser[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  const buatUser = async () => {
    setMenyimpan(true);
    setError("");
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fEmail, name: fNama, role: fRole, password: fPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal membuat user.");
      setInfo(`Akun ${fEmail} dibuat. Beritahukan passwordnya — user wajib menggantinya saat login pertama.`);
      setFormBuka(false);
      setFEmail(""); setFNama(""); setFPassword(""); setFRole("operator");
      muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenyimpan(false);
    }
  };

  const ubah = async (u: AppUser, data: Partial<AppUser>) => {
    setError("");
    try {
      const r = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal mengubah user.");
      muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const simpanPassword = async () => {
    if (!resetUntuk) return;
    setMenyimpan(true);
    setError("");
    try {
      const r = await fetch(`/api/users/${resetUntuk.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordBaru }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan password.");
      setInfo(`Password ${resetUntuk.email} berhasil diatur. User wajib menggantinya saat login.`);
      setResetUntuk(null);
      setPasswordBaru("");
      muat();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-green-600" /> Kelola User
          </h1>
          <p className="text-slate-500 mt-1">{rows.length} akun terdaftar</p>
        </div>
        <button onClick={() => setFormBuka((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" /> Tambah User
        </button>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {formBuka && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-slate-800">Akun baru</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Email</label>
              <input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Nama</label>
              <input value={fNama} onChange={(e) => setFNama(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Role</label>
              <select
                value={fRole}
                onChange={(e) => setFRole(e.target.value as "admin" | "operator")}
                className="input-field"
              >
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Password awal</label>
              <input
                type="text"
                value={fPassword}
                onChange={(e) => setFPassword(e.target.value)}
                className="input-field font-mono"
                placeholder="min. 8 karakter, huruf + angka"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            User akan diminta mengganti password ini saat login pertama.
          </p>
          <div className="flex gap-2">
            <button
              onClick={buatUser}
              disabled={menyimpan || !fEmail || !fNama || !fPassword}
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
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-slate-100">
            {rows.map((u) => {
              const sendiri = u.id === appUser?.id;
              return (
                <div key={u.id} className="p-4 flex flex-wrap items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                      u.role === "admin" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {u.role === "admin" ? <ShieldCheck className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <p className="font-medium text-slate-800 text-sm">
                      {u.name}
                      {sendiri && <span className="text-xs text-slate-400 font-normal"> · Anda</span>}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className={u.role === "admin" ? "badge-warning" : "badge-gray"}>
                        {u.role === "admin" ? "Admin" : "Operator"}
                      </span>
                      <span className={u.active ? "badge-success" : "badge-danger"}>
                        {u.active ? "Aktif" : "Nonaktif"}
                      </span>
                      {u.mustChangePassword && (
                        <span className="badge-info">Password sementara</span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => { setResetUntuk(u); setPasswordBaru(""); }}
                      className="btn-ghost text-xs"
                      title="Atur password"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Password
                    </button>
                    <button
                      onClick={() => ubah(u, { role: u.role === "admin" ? "operator" : "admin" })}
                      disabled={sendiri}
                      className="btn-ghost text-xs disabled:opacity-40"
                      title={sendiri ? "Tidak bisa mengubah role sendiri" : "Ubah role"}
                    >
                      {u.role === "admin" ? "Jadikan Operator" : "Jadikan Admin"}
                    </button>
                    <button
                      onClick={() => ubah(u, { active: !u.active })}
                      disabled={sendiri}
                      className={cn(
                        "btn-ghost text-xs disabled:opacity-40",
                        u.active ? "text-red-600 hover:bg-red-50" : "text-green-700 hover:bg-green-50"
                      )}
                      title={sendiri ? "Tidak bisa menonaktifkan diri sendiri" : ""}
                    >
                      {u.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dialog atur password */}
      {resetUntuk && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Atur Password</h3>
                <p className="text-sm text-slate-500 mt-0.5">{resetUntuk.email}</p>
              </div>
              <button onClick={() => setResetUntuk(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={passwordBaru}
              onChange={(e) => setPasswordBaru(e.target.value)}
              className="input-field font-mono"
              placeholder="min. 8 karakter, huruf + angka"
              autoFocus
            />
            <p className="text-xs text-slate-400">
              Catat dan sampaikan ke user. Ia wajib menggantinya saat login berikutnya.
            </p>
            <div className="flex gap-2">
              <button
                onClick={simpanPassword}
                disabled={menyimpan || !passwordBaru}
                className="btn-primary flex-1 justify-center"
              >
                {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
              </button>
              <button onClick={() => setResetUntuk(null)} className="btn-ghost">Batal</button>
            </div>
          </div>
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
