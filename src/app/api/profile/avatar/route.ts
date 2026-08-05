import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadAvatar } from "@/lib/cloudinary";
import { execute } from "@/lib/sql";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.startsWith("image/")) {
    return NextResponse.json({ error: "Expected an image file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await req.arrayBuffer());

    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
    }

    const avatarUrl = await uploadAvatar(buffer);

    await execute(`UPDATE "User" SET "avatarUrl" = $1 WHERE id = $2`, [
      avatarUrl,
      session.user.id,
    ]);

    return NextResponse.json({ avatarUrl });
  } catch (err) {
    console.error("Failed to upload avatar:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
