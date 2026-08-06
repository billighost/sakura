import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth";

/**
 * POST /api/auth/signout
 *
 * Thin server wrapper around NextAuth's signOut so client components
 * can trigger it without importing server-only modules.
 */
export async function POST() {
  try {
    await signOut({ redirect: false });
  } catch {
    // Some NextAuth versions throw on redirect:false — safe to swallow.
  }
  return NextResponse.json({ ok: true });
}
