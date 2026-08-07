import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "./db";
import { authConfig } from "./auth.config";

const nextAuthInstance = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null;

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: credentials.identifier as string },
              { email: credentials.identifier as string },
            ],
          },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return { id: user.id, name: user.username, email: user.email };
      },
    }),
  ],
});

// Exported directly rather than through a hand-written wrapper.
//
// The wrapper that used to live here existed for a dev-only "sign in as the
// first user" fallback — an auth bypass that has since been removed. What was
// left was a pass-through typed `(...args: any[])` with a `@ts-ignore`, which
// erased NextAuth's real overloads and left every `session.user` access
// untyped at the call site.
export const { handlers, signIn, signOut, auth } = nextAuthInstance;
