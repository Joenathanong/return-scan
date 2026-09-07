import { prisma } from "@/lib/db";
import { handle, requireAdmin, notFound, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/users/[id]/keluarkan — lepaskan ikatan akun ke perangkatnya.
 *
 * Kenapa tombol ini WAJIB ada, bukan sekadar enak dipunya: sejak satu akun
 * hanya boleh aktif di satu perangkat, PDT yang hilang, rusak, atau
 * ditinggalkan dalam keadaan masih login akan terus memegang sesi itu sampai
 * cookie-nya kedaluwarsa 12 jam kemudian.
 *
 * Memang benar user tetap bisa masuk tanpa tombol ini — arahnya "login
 * terbaru menang", jadi login baru selalu menggusur yang lama. Tombol ini
 * untuk kasus sebaliknya: admin ingin MEMASTIKAN perangkat yang hilang itu
 * tidak bisa dipakai lagi, tanpa harus mengganti password orangnya.
 *
 * Setelah ini, permintaan berikutnya dari perangkat lama dijawab
 * SESI_DIGANTI dan layarnya kembali ke halaman login.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, sesiAktif: true, perangkatLabel: true },
    });
    if (!target) throw notFound("User tidak ditemukan.");

    if (!target.sesiAktif) {
      // Bukan error: hasil akhirnya persis yang diminta admin.
      return { ok: true, sudahKosong: true };
    }

    await prisma.user.update({
      where: { id },
      data: { sesiAktif: null, perangkatLabel: null, sesiSejak: null },
    });

    await writeAudit(
      me.id, me.name, "KELUARKAN_PERANGKAT",
      `${target.email} dikeluarkan dari ${target.perangkatLabel ?? "perangkatnya"}`
    );

    // Admin yang mengeluarkan DIRINYA SENDIRI ikut terputus — sesinya baru
    // saja dihapus. Klien diberi tahu supaya bisa langsung ke /login,
    // bukan menunggu permintaan berikutnya gagal dengan pesan aneh.
    return { ok: true, diriSendiri: target.id === me.id };
  });
}
