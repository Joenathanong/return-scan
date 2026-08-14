import { redirect } from "next/navigation";

/**
 * Halaman akar hanya meneruskan ke dashboard.
 * Kalau belum login, middleware yang akan melempar ke /login.
 */
export default function Home() {
  redirect("/dashboard");
}
