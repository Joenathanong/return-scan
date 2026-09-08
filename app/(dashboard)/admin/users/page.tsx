"use client";

import { useEffect, useState, useCallback } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import type { AppUser } from "@/types";
import {
   Plus, Loader2, AlertCircle, CheckCircle2, KeyRound,
  ShieldCheck, User as UserIcon, X, MonitorSmartphone, PackageOpen, LogOut, XCircle,
} from "lucide-react";

export default function AdminUsersPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

/** "2026-09-07T03:12:00Z" → "7 Sep, 10.12" (WIB). */
function jamSingkat(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
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
  const [fBongkaran, setFBongkaran] = useState(false);
  const [fCancel, setFCancel] = useState(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const [resetUntuk, setResetUntuk] = useState<AppUser | null>(null);
  const [passwordBaru, setPasswordBaru] = useState("");
  const [keluarkanUntuk, setKeluarkanUntuk] = useState<AppUser | null>(null);

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const d = await mintaJson<{ rows: AppUser[] }>("/api/users");
      setRows(d.rows);
    } catch (e) {
      setError(pesanError(e, "Gagal memuat user."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  const buatUser = async () => {
    setMenyimpan(true);
    setError("");
    try {
      await mintaJson("/api/users", {
        method: "POST",
        body: {
          email: fEmail, name: fNama, role: fRole,
          password: fPassword, bisaBongkaran: fBongkaran, bisaCancelOrder: fCancel,
        },
      });
      setInfo(
        `Akun ${fEmail} dibuat. Beritahukan passwordnya — user wajib menggantinya saat login pertama.`
      );
      setFormBuka(false);
      setFEmail(""); setFNama(""); setFPassword("");
      setFRole("operator"); setFBongkaran(false); setFCancel(false);
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal membuat user."));
    } finally {
      setMenyimpan(false);
    }
  };

  const ubah = async (u: AppUser, data: Partial<AppUser>) => {
    setError("");
    try {
      await mintaJson(`/api/users/${u.id}`, { method: "PATCH", body: data });
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal mengubah user."));
    }
  };

  const simpanPassword = async () => {
    if (!resetUntuk) return;
    setMenyimpan(true);
    setError("");
    try {
      await mintaJson(`/api/users/${resetUntuk.id}/password`, {
        method: "POST",
        body: { password: passwordBaru },
      });
      setInfo(
        `Password ${resetUntuk.email} berhasil diatur. User wajib menggantinya saat login, ` +
          "dan ikatan ke perangkat lamanya sudah dilepas."
      );
      setResetUntuk(null);
      setPasswordBaru("");
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal menyimpan password."));
    } finally {
      setMenyimpan(false);
    }
  };

  const keluarkan = async () => {
    if (!keluarkanUntuk) return;
    setMenyimpan(true);
    setError("");
    try {
      const d = await mintaJson<{ diriSendiri?: boolean; sudahKosong?: boolean }>(
        `/api/users/${keluarkanUntuk.id}/keluarkan`,
        { method: "POST" }
      );
      // Admin mengeluarkan dirinya sendiri: sesi yang sedang dipakai halaman
      // ini baru saja dihapus. Ke /login sekarang, jangan menunggu klik
      // berikutnya gagal dengan pesan yang membingungkan.
      if (d.diriSendiri) {
        window.location.href = "/login?alasan=sesi";
        return;
      }
      setInfo(
        d.sudahKosong
          ? `${keluarkanUntuk.email} memang sedang tidak terikat ke perangkat mana pun.`
          : `${keluarkanUntuk.email} dikeluarkan. Perangkat lamanya akan kembali ke halaman login.`
      );
      setKeluarkanUntuk(null);
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal mengeluarkan dari perangkat."));
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="shell">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Kelola User</h1>
          <p className="page-sub">{rows.length} akun terdaftar</p>
        </div>
        <button onClick={() => setFormBuka((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" /> Tambah User
        </button>
      </div>

      <div className="bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 flex gap-2.5">
        <MonitorSmartphone className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600">
          Satu akun hanya bisa aktif di <strong>satu perangkat</strong>. Login baru
          selalu menggusur yang lama, jadi tidak ada akun yang bisa terkunci —
          termasuk akun admin. Pakai <em>Keluarkan</em> kalau perangkatnya hilang
          atau ditinggal dalam keadaan masih login.
        </p>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {formBuka && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-heading">Akun baru</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Email</label>
              <input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Nama</label>
              <input value={fNama} onChange={(e) => setFNama(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Role</label>
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
              <label className="text-sm font-medium text-ink mb-1.5 block">Password awal</label>
              <input
                type="text"
                value={fPassword}
                onChange={(e) => setFPassword(e.target.value)}
                className="input-field font-mono"
                placeholder="min. 8 karakter, huruf + angka"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={fRole === "admin" || fBongkaran}
                disabled={fRole === "admin"}
                onChange={(e) => setFBongkaran(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 disabled:opacity-50"
              />
              <span className="text-sm text-ink">
                Menu <strong>Bongkaran</strong>
                {fRole === "admin" && (
                  <span className="text-gray-400"> — admin selalu bisa</span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={fRole === "admin" || fCancel}
                disabled={fRole === "admin"}
                onChange={(e) => setFCancel(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 disabled:opacity-50"
              />
              <span className="text-sm text-ink">
                Menu <strong>Cancel Order</strong>
                {fRole === "admin" && (
                  <span className="text-gray-400"> — admin selalu bisa</span>
                )}
              </span>
            </label>
          </div>

          <p className="text-xs text-gray-400">
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
          <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-gray-200">
            {rows.map((u) => {
              const sendiri = u.id === appUser?.id;
              const admin = u.role === "admin";
              return (
                <div key={u.id} className="p-4 flex flex-wrap items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                      admin ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {admin ? <ShieldCheck className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <p className="font-medium text-heading text-sm">
                      {u.name}
                      {sendiri && <span className="text-xs text-gray-400 font-normal"> · Anda</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className={admin ? "badge-warning" : "badge-gray"}>
                        {admin ? "Admin" : "Operator"}
                      </span>
                      <span className={u.active ? "badge-success" : "badge-danger"}>
                        {u.active ? "Aktif" : "Nonaktif"}
                      </span>
                      {(admin || u.bisaBongkaran) && (
                        <span className="badge-info inline-flex items-center gap-1">
                          <PackageOpen className="w-3 h-3" /> Bongkaran
                        </span>
                      )}
                      {(admin || u.bisaCancelOrder) && (
                        <span className="badge-info inline-flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Cancel Order
                        </span>
                      )}
                      {u.mustChangePassword && (
                        <span className="badge-info">Password sementara</span>
                      )}
                    </div>

                    {/* Keadaan perangkat — inti dari aturan satu perangkat */}
                    <p className="text-xs mt-1.5 flex items-center gap-1.5">
                      <MonitorSmartphone
                        className={cn(
                          "w-3.5 h-3.5 flex-shrink-0",
                          u.sedangLogin ? "text-brand-600" : "text-gray-300"
                        )}
                      />
                      {u.sedangLogin ? (
                        <span className="text-gray-600">
                          Login di <strong>{u.perangkatLabel ?? "perangkat tidak dikenal"}</strong>
                          {u.sesiSejak && (
                            <span className="text-gray-400"> · sejak {jamSingkat(u.sesiSejak)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">Tidak sedang login</span>
                      )}
                    </p>
                  </div>

                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => setKeluarkanUntuk(u)}
                      disabled={!u.sedangLogin}
                      className="btn-ghost text-xs disabled:opacity-30"
                      title={
                        u.sedangLogin
                          ? "Lepaskan ikatan akun ini dari perangkatnya"
                          : "Akun ini sedang tidak terikat ke perangkat mana pun"
                      }
                    >
                      <LogOut className="w-3.5 h-3.5" /> Keluarkan
                    </button>
                    <button
                      onClick={() => { setResetUntuk(u); setPasswordBaru(""); }}
                      className="btn-ghost text-xs"
                      title="Atur password"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Password
                    </button>
                    <button
                      onClick={() => ubah(u, { bisaBongkaran: !u.bisaBongkaran })}
                      disabled={admin}
                      className="btn-ghost text-xs disabled:opacity-30"
                      title={
                        admin
                          ? "Admin selalu punya akses Bongkaran"
                          : u.bisaBongkaran
                            ? "Cabut akses menu Bongkaran"
                            : "Beri akses menu Bongkaran"
                      }
                    >
                      {u.bisaBongkaran ? "Cabut Bongkaran" : "Beri Bongkaran"}
                    </button>
                    <button
                      onClick={() => ubah(u, { bisaCancelOrder: !u.bisaCancelOrder })}
                      disabled={admin}
                      className="btn-ghost text-xs disabled:opacity-30"
                      title={
                        admin
                          ? "Admin selalu punya akses Cancel Order"
                          : u.bisaCancelOrder
                            ? "Cabut akses menu Cancel Order"
                            : "Beri akses menu Cancel Order"
                      }
                    >
                      {u.bisaCancelOrder ? "Cabut Cancel Order" : "Beri Cancel Order"}
                    </button>
                    <button
                      onClick={() => ubah(u, { role: admin ? "operator" : "admin" })}
                      disabled={sendiri}
                      className="btn-ghost text-xs disabled:opacity-40"
                      title={sendiri ? "Tidak bisa mengubah role sendiri" : "Ubah role"}
                    >
                      {admin ? "Jadikan Operator" : "Jadikan Admin"}
                    </button>
                    <button
                      onClick={() => ubah(u, { active: !u.active })}
                      disabled={sendiri}
                      className={cn(
                        "btn-ghost text-xs disabled:opacity-40",
                        u.active ? "text-red-600 hover:bg-red-50" : "text-brand-700 hover:bg-brand-50"
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
        <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-heading">Atur Password</h3>
                <p className="text-sm text-gray-500 mt-0.5">{resetUntuk.email}</p>
              </div>
              <button onClick={() => setResetUntuk(null)} className="text-gray-400 hover:text-ink">
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
            <p className="text-xs text-gray-400">
              Catat dan sampaikan ke user. Ia wajib menggantinya saat login berikutnya,
              dan ikatan ke perangkat lamanya ikut dilepas.
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

      {/* Dialog keluarkan dari perangkat */}
      {keluarkanUntuk && (
        <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-heading">Keluarkan dari perangkat?</h3>
                <p className="text-sm text-gray-500 mt-0.5">{keluarkanUntuk.email}</p>
              </div>
              <button onClick={() => setKeluarkanUntuk(null)} className="text-gray-400 hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-sm text-amber-800">
              <p>
                <strong>{keluarkanUntuk.perangkatLabel ?? "Perangkat"}</strong> akan
                kembali ke halaman login pada permintaan berikutnya.
              </p>
              {keluarkanUntuk.id === appUser?.id && (
                <p className="mt-1.5 font-medium">
                  Ini akun Anda sendiri — Anda akan ikut keluar sekarang juga.
                </p>
              )}
            </div>

            <p className="text-xs text-gray-400">
              Data yang sedang diketik di perangkat itu dan belum disimpan akan hilang.
              Password user tidak berubah; ia bisa langsung login lagi.
            </p>

            <div className="flex gap-2">
              <button
                onClick={keluarkan}
                disabled={menyimpan}
                className="btn-danger flex-1 justify-center"
              >
                {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />} Keluarkan
              </button>
              <button onClick={() => setKeluarkanUntuk(null)} className="btn-ghost">Batal</button>
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
