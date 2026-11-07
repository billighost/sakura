import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireRebuildAccount } from "@/rebuild/auth";
export const instant = false;
export default async function Page() { await connection();redirect(await requireRebuildAccount() ? "/home" : "/login"); }
