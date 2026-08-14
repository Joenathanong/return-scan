"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Halaman ganti password sendiri.
 *
 * User hasil seed / hasil reset admin punya `mustChangePassword = true`
 * dan diarahkan ke sini sampai passwordnya diganti — supaya password
 * sementara dari .env atau dari admin tidak pernah jadi permanen.
 */
export default function GantiPasswordPage() {
  const { appUser, refresh, signOut } = useAuth();
  const router = useRouter();

  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [ulangi, setUlangi] = useState("");
  const [error, setError] = useState("");
  const [proses, setProses] = useState(false);
  const [sukses, setSukses] = useState(false);

  const wajib = appUser?.mustChangePassword ?? false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (baru !== ulangi) {
      setError("Konfirmasi password tidak sama.");
      return;
    }

    setProses(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordLama: lama, passwordBaru: baru }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Gagal mengganti password.");

      setSukses(true);
      await refresh();
      setTimeout(() => router.replace("/dashboard"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengganti password.");
    } finally {
      setProses(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {wajib ? "Buat Password Baru" : "Ganti Password"}
          </h1>
          {wajib && (
            <p className="text-slate-500 text-sm mt-2">
              Password Anda saat ini bersifat sementara. Buat password sendiri
              sebelum melanjutkan.
            </p>
          )}
        </div>

        <form
          onSubmit={submit}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4"
        >
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Password saat ini
            </label>
            <input
              type="password"
              value={lama}
              onChange={(e) => setLama(e.target.value)}
              className="input-field"
              autoComplete="current-password"
              required
              disabled={proses || sukses}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Password baru
            </label>
            <input
              type="password"
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              className="input-field"
              autoComplete="new-password"
              required
              disabled={proses || sukses}
            />
            <p className="text-xs text-slate-400 mt-1">
              Minimal 8 karakter, harus ada huruf dan angka.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Ulangi password baru
            </label>
            <input
              type="password"
              value={ulangi}
              onChange={(e) => setUlangi(e.target.value)}
              className="input-field"
              autoComplete="new-password"
              required
              disabled={proses || sukses}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {sukses && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-700">
                Password berhasil diganti. Mengalihkan...
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={proses || sukses || !lama || !baru || !ulangi}
            className="btn-primary w-full justify-center"
          >
            {proses && <Loader2 className="w-4 h-4 animate-spin" />}
            {proses ? "Menyimpan..." : "Simpan Password"}
          </button>
        </form>

        <button
          onClick={signOut}
          className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-6"
        >
          Keluar
        </button>
      </div>
    </div>
  );
}
