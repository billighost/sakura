import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messageId } = await params;
  const msgId = parseInt(messageId, 10);

  if (isNaN(msgId)) {
    return new Response("Invalid messageId", { status: 400 });
  }

  try {
    const client = getTelegramClient();
    await client.init();
    const stream = await client.getAudioStream(msgId);

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[Telegram Stream]", error);
    return new Response("Failed to stream audio from Telegram", { status: 500 });
  }
}
