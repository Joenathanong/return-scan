"use client";

import React, {
  createContext, useContext, useEffect, useState, useCallback,
} from "react";
import type { SessionUser } from "@/types";

/**
 * Auth klien — pengganti AuthProvider berbasis Firebase.
 *
 * Perbedaan penting dari sistem lama:
 *   • Tidak ada SDK Firebase di browser sama sekali.
 *   • Cookie sesi ber-flag httpOnly, jadi JavaScript halaman tidak bisa
 *     membacanya. Dulu uid ditulis ke cookie biasa lewat `document.cookie`,
 *     yang artinya siapa pun bisa memalsukannya dari console browser.
 *   • Status login dipulihkan dengan satu panggilan ke /api/auth/me, yang
 *     memverifikasi tanda tangan cookie DAN memeriksa akun masih aktif.
 *
 * Nama field `appUser` sengaja dipertahankan supaya halaman-halaman yang
 * disalin dari sistem lama tidak perlu diubah pemanggilannya.
 */

interface AuthContextValue {
  appUser: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [appUser, setAppUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { user: SessionUser | null };
      setAppUser(data.user ?? null);
    } catch {
      // Jaringan putus — jangan paksa logout, biarkan halaman menampilkan
      // keadaan terakhir. Request berikutnya yang akan menentukan.
      setAppUser((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as { user?: SessionUser; error?: string };
    if (!res.ok) throw new Error(data.error || "Gagal login.");
    setAppUser(data.user ?? null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAppUser(null);
      window.location.href = "/login";
    }
  }, []);

  return (
    <AuthContext.Provider value={{ appUser, loading, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
