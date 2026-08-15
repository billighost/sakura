import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHomeData } from "@/lib/homeData";
import { isOnboarded } from "@/lib/taste";
import { FirstRun, Greeting, HomeFeed } from "./HomeFeed";
import { HomeSkeleton } from "./HomeSkeleton";
import styles from "./page.module.css";

/**
 * Home.
 *
 * Server component: auth, the data fetch, and the page frame. Everything the
 * user can touch lives in `HomeFeed.tsx`, because nearly every card here starts
 * playback rather than navigating — see the note at the top of that file.
 *
 * The feed is wrapped in Suspense so the header and the greeting paint on the
 * first byte while `getHomeData` (eleven queries on a cold cache) resolves. The
 * fallback is shaped like the content that replaces it, so nothing jumps.
 */

function initials(name?: string | null) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function Feed({ userId }: { userId: string }) {
  const data = await getHomeData(userId);

  // Nothing played and nothing liked: a first-run account, which needs an
  // invitation rather than a grid of whatever the catalogue happened to return.
  const cold = data.quickPicks.length === 0 && data.recentlyPlayed.length === 0;
  if (cold) return <FirstRun hasCharts={data.systemPlaylists.length > 0} />;

  return <HomeFeed data={data} />;
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // First run: send them through taste onboarding before the empty home page.
  // A cold home screen is a bad first impression, and the two minutes spent
  // here is what makes every mix below actually personal.
  if (!(await isOnboarded(session.user.id!))) redirect("/onboarding");

  const user = session.user;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Greeting name={user.name ?? "there"} />

        <Link href="/profile" className={`${styles.avatarLink} pressable`} aria-label="Open your profile">
          {user.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={user.image} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatarFallback} aria-hidden="true">
              {initials(user.name)}
            </span>
          )}
        </Link>
      </header>

      <Suspense fallback={<HomeSkeleton />}>
        <Feed userId={user.id!} />
      </Suspense>
    </div>
  );
}
