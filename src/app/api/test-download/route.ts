import { NextResponse } from "next/server";
import { getTelegramClient } from "@/lib/telegram";

export async function GET() {
  try {
    const client = getTelegramClient();
    await client.init();

    console.log("[Test API] Running searchAndSelect for Taylor Swift - Blank Space (Target: 231s)");
    const track = await client.searchAndSelect("Taylor Swift - Blank Space", 231);

    return NextResponse.json({
      success: true,
      track
    });
  } catch (error: any) {
    console.error("[Test API Error]", error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
