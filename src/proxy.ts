import NextAuth from "next-auth";
import { authConfig } from "./lib/auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  const isAuthPage = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isPublicRoute =
    nextUrl.pathname === "/" ||
    nextUrl.pathname.startsWith("/about") ||
    nextUrl.pathname.startsWith("/privacy") ||
    nextUrl.pathname.startsWith("/terms") ||
    // The service worker pre-caches /offline at install time, which can happen
    // while signed out. If this redirected to /login, the cached "offline"
    // fallback would be a login redirect — so every offline cold start would
    // bounce to a page that itself needs the network.
    nextUrl.pathname.startsWith("/offline") ||
    // Shared links — a share is public by design (the person making it wants
    // someone else to see it), so redirecting these to /login would break the
    // one feature that's supposed to bring people *into* the app.
    nextUrl.pathname.startsWith("/s/");

  // Redirect to login if trying to access a protected page while unauthenticated.
  // Preserve where they were headed so login can send them back rather than
  // dumping everyone on /home.
  if (!isLoggedIn && !isAuthPage && !isPublicRoute) {
    const loginUrl = new URL("/login", nextUrl);
    const target = nextUrl.pathname + nextUrl.search;
    if (target && target !== "/") loginUrl.searchParams.set("next", target);
    return Response.redirect(loginUrl);
  }

  // Redirect to home if trying to access login/register while authenticated
  if (isLoggedIn && isAuthPage) {
    return Response.redirect(new URL("/home", nextUrl));
  }
});

export const config = {
  // Everything static has to be excluded explicitly, or the auth redirect
  // swallows it. `sw.js` in particular: a service worker fetched while logged
  // out was being answered with a 307 to /login, so registration failed and
  // offline support silently never worked. The trailing `\\..*` clause covers
  // any other root-level file with an extension (robots.txt, favicon.svg, the
  // web-app icons) without needing to enumerate them.
  matcher: [
    "/((?!api|_next/static|_next/image|icons|images|sw\\.js|manifest\\.json|favicon\\.ico|.*\\..*).*)",
  ],
};
