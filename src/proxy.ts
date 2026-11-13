import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { rebuildAuthConfig } from "./rebuild/auth-config";
import { isMetadataPreviewPath } from "./rebuild/seo/routes";
const { auth } = NextAuth(rebuildAuthConfig);
export const proxy = auth(request => {
 const path = request.nextUrl.pathname;
 const publicPage = ["/", "/login", "/register", "/about", "/privacy", "/terms", "/offline", "/og-preview", "/og-preview/render"].includes(path) || path.startsWith("/s/") || path.startsWith("/og/") || isMetadataPreviewPath(path);
 if (!request.auth && !publicPage) {
  const url = new URL("/login", request.nextUrl);
  url.searchParams.set("next", path + request.nextUrl.search);
  return NextResponse.redirect(url);
 }
});
export const config = { matcher: ["/((?!api|_next|icons|images|rebuild|sw\\.js|manifest\\.json|.*\\..*).*)"] };
