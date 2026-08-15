"use client";

import React, {
  createContext, useContext, useEffect, useState, useCallback,
} from "react";
import { mintaJson } from "@/lib/http";
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
  /** Terisi kalau /api/auth/me gagal karena masalah jaringan/server. */
  gangguan: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [appUser, setAppUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [gangguan, setGangguan] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await mintaJson<{ user: SessionUser | null }>("/api/auth/me");
      setAppUser(data.user ?? null);
      setGangguan("");
    } catch (e) {
      // Jaringan putus atau server bermasalah — JANGAN paksa logout.
      // Keadaan terakhir dipertahankan; permintaan berikutnya yang menentukan.
      // Pesannya disimpan supaya halaman login bisa menjelaskan, alih-alih
      // hanya menampilkan form yang gagal terus tanpa alasan.
      setGangguan(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await mintaJson<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setAppUser(data.user ?? null);
    setGangguan("");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await mintaJson("/api/auth/logout", { method: "POST" });
    } catch {
      // Gagal memberi tahu server bukan alasan untuk menahan orang tetap
      // masuk — sesi lokal tetap dibuang.
    } finally {
      setAppUser(null);
      window.location.href = "/login";
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ appUser, loading, gangguan, signIn, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
