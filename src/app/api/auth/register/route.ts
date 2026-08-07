import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { username, email, password } = await req.json();

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 }
      );
    }

    if (typeof username !== "string" || username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Username must be 3-30 characters" },
        { status: 400 }
      );
    }

    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
    });

    if (existing) {
      const field = existing.username === username ? "Username" : "Email";
      return NextResponse.json(
        { error: `${field} is already taken` },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // The findFirst check above is a fast path for a friendly error message,
    // not the actual guarantee — two simultaneous signups with the same
    // username both pass it. The unique constraint is what really enforces
    // this, so translate its violation into the same 409 rather than a 500.
    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          settings: {
            create: {},
          },
        },
        select: { id: true, username: true, email: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const field = Array.isArray(err.meta?.target) && err.meta.target.includes("email")
          ? "Email"
          : "Username";
        return NextResponse.json({ error: `${field} is already taken` }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[Register]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
