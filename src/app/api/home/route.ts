import { NextResponse } from "next/server";
import { queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { updateSystemPlaylist } from "@/lib/charts";
import { getHomeData } from "@/lib/homeData";

// Run updates asynchronously to avoid blocking the home request
function triggerDailyUpdate() {
  setTimeout(async () => {
    try {
      await updateSystemPlaylist("top-50-global", "Top 50 Global", "global");
      await updateSystemPlaylist("top-50-country", "Top 50 in your Country", "country");
      await updateSystemPlaylist("top-50-nigeria", "Top 50 Nigeria", "nigeria");
      await updateSystemPlaylist("top-50-africa", "Top 50 Africa", "africa");
      await updateSystemPlaylist("top-50-community", "Sakura Global Top 50", "community");
      console.log("[Home API] Daily system playlists update completed.");
    } catch (e) {
      console.error("[Home API] Failed to update system playlists:", e);
    }
  }, 100);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;

  // Check if system playlists need updating (older than 24 hours)
  const globalPl = await queryOne<{ updatedAt: Date }>(
    `SELECT "updatedAt" FROM "SystemPlaylist" WHERE "systemId" = 'top-50-global'`
  ).catch(() => null);

  if (!globalPl || Date.now() - new Date(globalPl.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
    triggerDailyUpdate();
  }

  const result = await getHomeData(userId);
  return NextResponse.json(result);
}
