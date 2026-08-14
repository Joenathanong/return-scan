"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ScanLine, History, Printer, Table2,
  Package, Users, Truck, Settings, LogOut, X, KeyRound,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  /** null = tanpa judul (dipakai untuk Dashboard yang berdiri sendiri) */
  judul: string | null;
  adminOnly?: boolean;
  items: NavItem[];
}

/**
 * Menu dikelompokkan menurut cara kerja sehari-hari, bukan menurut urutan
 * pembuatan halaman: yang dipakai operator tiap hari di atas, laporan di
 * tengah, pengaturan di bawah.
 */
const GRUP: NavGroup[] = [
  {
    judul: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    judul: "Operasional",
    items: [
      { href: "/scan",  label: "Scan Retur", icon: <ScanLine className="w-[18px] h-[18px]" /> },
      { href: "/print", label: "Print",      icon: <Printer  className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    judul: "Laporan",
    items: [
      { href: "/history", label: "History",        icon: <History className="w-[18px] h-[18px]" /> },
      { href: "/data",    label: "Data & Export",  icon: <Table2  className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    judul: "Admin",
    adminOnly: true,
    items: [
      { href: "/claim",          label: "Kelola Claim",    icon: <Package  className="w-[18px] h-[18px]" /> },
      { href: "/admin/users",    label: "Kelola User",     icon: <Users    className="w-[18px] h-[18px]" /> },
      { href: "/admin/expedisi", label: "Master Expedisi", icon: <Truck    className="w-[18px] h-[18px]" /> },
      { href: "/admin/settings", label: "Pengaturan",      icon: <Settings className="w-[18px] h-[18px]" /> },
    ],
  },
];

/** "Eji Operasional" → "EO". Dipakai sebagai avatar teks. */
function inisial(nama: string | undefined): string {
  if (!nama) return "?";
  const bagian = nama.trim().split(/\s+/).slice(0, 2);
  return bagian.map((b) => b[0] ?? "").join("").toUpperCase() || "?";
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { appUser, signOut } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-64 bg-slate-900 flex flex-col z-40",
          "transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ── Kepala ── */}
        <div className="flex items-center gap-3 px-4 h-16 flex-shrink-0 border-b border-slate-800">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <ScanLine className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white text-sm leading-tight">Scan Retur</p>
            <p className="text-slate-500 text-xs leading-tight">PT. IEG</p>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-500 hover:text-white p-1 rounded -mr-1"
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Menu ── */}
        <nav className="flex-1 overflow-y-auto scroll-slim-dark px-3 py-3">
          {GRUP.filter((g) => !g.adminOnly || isAdmin).map((grup, gi) => (
            <div key={grup.judul ?? `grup-${gi}`} className={gi > 0 ? "mt-5" : ""}>
              {grup.judul && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {grup.judul}
                </p>
              )}

              <div className="space-y-0.5">
                {grup.items.map((item) => {
                  const aktif = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={aktif ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                        aktif
                          ? "bg-green-600 text-white font-medium"
                          : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <span className="flex-shrink-0">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Kaki: identitas + aksi akun ── */}
        <div className="flex-shrink-0 border-t border-slate-800 p-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                "text-xs font-semibold",
                isAdmin ? "bg-amber-500/15 text-amber-400" : "bg-green-500/15 text-green-400"
              )}
              aria-hidden="true"
            >
              {inisial(appUser?.name)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate leading-tight">
                {appUser?.name ?? "—"}
              </p>
              <p className="text-xs text-slate-500 truncate leading-tight">
                {isAdmin ? "Admin" : "Operator"}
              </p>
            </div>

            <Link
              href="/ganti-password"
              onClick={onClose}
              title="Ganti password"
              aria-label="Ganti password"
              className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <KeyRound className="w-[18px] h-[18px]" />
            </Link>

            <button
              onClick={signOut}
              title="Keluar"
              aria-label="Keluar"
              className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
            >
              <LogOut className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
