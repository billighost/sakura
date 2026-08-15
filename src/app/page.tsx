import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * `instant = false` — this route is allowed to block.
 *
 * Under Cache Components a route that touches `cookies()` outside `<Suspense>`
 * fails prerender validation, and `auth()` is exactly that. There is no fix
 * worth making here: the page renders nothing at all, it only decides where to
 * send you. There is no shell to prerender and no content whose paint could be
 * made instant, so the opt-out is the honest answer rather than a deferral.
 *
 * This does not force the route dynamic; it only marks it as permitted to block.
 */
export const instant = false;

export default async function RootPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/home");
  } else {
    redirect("/login");
  }
}
