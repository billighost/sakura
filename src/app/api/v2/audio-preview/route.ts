import { withApiTiming } from "@/rebuild/server/performance";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireRebuildAccount } from "@/rebuild/auth";

/** A fixed, private local audition fixture. Never accepts a filesystem path. */
export async function GET(request: Request) {
  return withApiTiming("/api/v2/audio-preview", request, async () => {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404, headers });
  const account = await requireRebuildAccount();
  if (!account || (request.headers.get("X-Sakura-Account") && request.headers.get("X-Sakura-Account") !== account.id)) {
    return new Response(null, { status: 401, headers });
  }
  try {
    if (new URL(request.url).searchParams.get("audio") !== "1") {
      return Response.json({ title: "Ayra Starr — Commas", url: "/api/v2/audio-preview?audio=1", duration: 24 }, { headers });
    }
    const audio = await readFile(path.join(process.cwd(), ".local", "audio-technology", "source.wav"));
    return new Response(audio, { headers: { ...headers, "Content-Type": "audio/wav", "Content-Length": String(audio.length) } });
  } catch {
    return new Response(null, { status: 404, headers });
  }

  });
}
