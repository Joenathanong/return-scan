"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ScanLine, History, Printer, Table2,
  Package, Users, Truck, Settings, LogOut, X, KeyRound, Boxes,
  PackageOpen, FileSpreadsheet, LayoutList, XCircle, ClipboardList, UserCog,
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
  /**
   * Grup yang butuh izin modul Bongkaran. Admin selalu lolos.
   * Ini murni soal tampilan — API tetap memeriksa sendiri lewat
   * requireBongkaran(), jadi menyembunyikan menu bukan pengamanannya.
   */
  bongkaranOnly?: boolean;
  /** Grup yang butuh izin modul Cancel Order. Admin selalu lolos. */
  cancelOrderOnly?: boolean;
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
    judul: "Bongkaran",
    bongkaranOnly: true,
    items: [
      { href: "/bongkaran",           label: "Scan Bongkaran", icon: <PackageOpen     className="w-[18px] h-[18px]" /> },
      { href: "/bongkaran/dashboard", label: "Monitoring",     icon: <LayoutList      className="w-[18px] h-[18px]" /> },
      { href: "/bongkaran/operator",  label: "Laporan Operator", icon: <UserCog        className="w-[18px] h-[18px]" /> },
      { href: "/bongkaran/export",    label: "Export",         icon: <FileSpreadsheet className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    judul: "Cancel Order",
    cancelOrderOnly: true,
    items: [
      { href: "/cancel-order",         label: "Scan Cancel Order", icon: <XCircle       className="w-[18px] h-[18px]" /> },
      { href: "/cancel-order/riwayat", label: "Riwayat & Export",  icon: <ClipboardList className="w-[18px] h-[18px]" /> },
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
      { href: "/admin/produk",   label: "Master Produk",   icon: <Boxes    className="w-[18px] h-[18px]" /> },
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
  const bisaBongkaran = isAdmin || appUser?.bisaBongkaran === true;
  const bisaCancelOrder = isAdmin || appUser?.bisaCancelOrder === true;

  /**
   * `startsWith` membuat menu induk ikut menyala di halaman anaknya —
   * "Scan Bongkaran" akan tersorot padahal yang dibuka /bongkaran/export.
   * Menu yang punya anak dicocokkan persis.
   */
  const PUNYA_ANAK = ["/dashboard", "/bongkaran", "/cancel-order"];
  const isActive = (href: string) =>
    PUNYA_ANAK.includes(href) ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-sidebar bg-ocs-sidebar flex flex-col z-40",
          "transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ── Kepala ── */}
        <div className="flex items-center gap-3 px-4 h-topbar flex-shrink-0 border-b border-white/10">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/10 ring-1 ring-white/15">
            <ScanLine className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white text-sm leading-tight">Scan Retur</p>
            <p className="text-white/50 text-xs leading-tight">PT. IEG</p>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-white/60 hover:text-white p-1 rounded -mr-1"
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Menu ── */}
        <nav className="flex-1 overflow-y-auto scroll-slim-dark px-3 py-3">
          {GRUP.filter(
            (g) =>
              (!g.adminOnly || isAdmin) &&
              (!g.bongkaranOnly || bisaBongkaran) &&
              (!g.cancelOrderOnly || bisaCancelOrder)
          ).map((grup, gi) => (
            <div key={grup.judul ?? `grup-${gi}`} className={gi > 0 ? "mt-5" : ""}>
              {grup.judul && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-white/40">
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
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors",
                        // Menu aktif: gradien indigo→pink + garis pink 3px di
                        // tepi kiri. Garis itu yang membuat menu aktif tetap
                        // terbaca sekilas walau latarnya hanya berbeda tipis
                        // dari sekitarnya.
                        aktif
                          ? "bg-ocs-nav text-white font-semibold shadow-[inset_3px_0_0_#F472B6]"
                          : "text-slate-200/85 hover:bg-white/[.08] hover:text-white"
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
        <div className="flex-shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                "text-xs font-semibold ring-1",
                isAdmin
                  ? "bg-accent-pink/20 text-accent-pink400 ring-accent-pink/30"
                  : "bg-white/10 text-white ring-white/15"
              )}
              aria-hidden="true"
            >
              {inisial(appUser?.name)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate leading-tight">
                {appUser?.name ?? "—"}
              </p>
              <p className="text-xs text-white/50 truncate leading-tight">
                {isAdmin ? "Admin" : "Operator"}
              </p>
            </div>

            <Link
              href="/ganti-password"
              onClick={onClose}
              title="Ganti password"
              aria-label="Ganti password"
              className="p-2 rounded-lg text-white/55 hover:text-white hover:bg-white/10 transition-colors"
            >
              <KeyRound className="w-[18px] h-[18px]" />
            </Link>

            <button
              onClick={signOut}
              title="Keluar"
              aria-label="Keluar"
              className="p-2 rounded-lg text-white/55 hover:text-accent-pink400 hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-[18px] h-[18px]" />
            </button>
          </div>
          <p className="text-[11px] text-white/35 text-center mt-2.5">
            © {new Date().getFullYear()} PT. IEG
          </p>
        </div>
      </aside>
    </>
  );
}
