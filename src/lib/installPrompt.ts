"use client";

/**
 * When to ask someone to install Sakura.
 *
 * The default answer most apps give is "immediately", which is why most people
 * have learned to dismiss install prompts without reading them. Nobody decides
 * they want a music app on their home screen ten seconds after landing on it —
 * at that point they haven't heard anything yet, so the ask is pure cost with
 * no argument behind it.
 *
 * So this module doesn't ask on a timer. It waits for a moment where installing
 * is the obvious next thought the user was already having, and there are
 * exactly two of those in a music app:
 *
 *  1. **A download just finished.** This is the strong one. The user has said,
 *     in the clearest way the app allows, "I want this available later". A home
 *     screen icon is the rest of that sentence: later, with no browser, no
 *     signal, one tap. The ask isn't an interruption, it's the same idea.
 *
 *  2. **They keep coming back to listen.** Someone who has finished a real
 *     number of tracks across more than one day is a returning user whether or
 *     not they've downloaded anything. Streaming listeners deserve the offer
 *     too; they just have to earn it over a slower signal.
 *
 * Both gate on the app having been opened on at least two separate days, which
 * is the cheapest available proxy for "came back on purpose". A single long
 * first session is enthusiasm; a second day is intent.
 *
 * Dismissal is a snooze ladder, not a boolean. Asking once and never again
 * wastes the majority of cases where "not now" meant exactly that, and asking
 * every session is how you train someone to reflex-dismiss. Two weeks, then two
 * months, then never — three refusals is a decision and it gets respected.
 */

/** The Chromium-only event that hands us the native install flow. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/** Which of the two arguments earned the prompt, or `null` for "not yet". */
export type InstallMoment = "download" | "listening";

export type InstallRoute =
  /** Chromium handed us a deferred prompt — one tap installs, no explanation. */
  | "native"
  /** iOS Safari has no API. We have to show where the buttons are. */
  | "ios-safari"
  /** Installable in principle, but not from this browser. */
  | "unsupported";

interface Ledger {
  /** `YYYY-MM-DD` for each day the app was opened. Bounded — see touchDay. */
  days: string[];
  /** Tracks played to completion, all time. */
  plays: number;
  /** Downloads that finished successfully, all time. */
  downloads: number;
  /** How many times the prompt has been turned down. */
  dismissals: number;
  /** Epoch ms; the prompt stays out of the way until this passes. */
  snoozeUntil: number;
  /** Latched once we've seen the app running installed. Never unlatched. */
  installed: boolean;
}

const KEY = "sakura-install";

const EMPTY: Ledger = {
  days: [],
  plays: 0,
  downloads: 0,
  dismissals: 0,
  snoozeUntil: 0,
  installed: false,
};

/** Distinct days before either moment is allowed to fire. */
const MIN_DAYS = 2;
/** Completed tracks for the listening moment, if no download has happened. */
const MIN_PLAYS = 8;
/** How long the current session must have run before the listening moment. */
const MIN_SESSION_MS = 3 * 60_000;
/** Snooze added per refusal. A fourth entry would never be reached. */
const SNOOZE_LADDER_MS = [14 * 86_400_000, 60 * 86_400_000];
/** Only the last 30 day-stamps matter; the rest is unbounded history. */
const MAX_DAYS_TRACKED = 30;

/**
 * Read the ledger defensively. Anything in localStorage is attacker- or
 * bug-writable and this app has already been bitten once by trusting the shape
 * of stored JSON, so every field is validated individually rather than the
 * whole object being cast.
 */
function read(): Ledger {
  if (typeof localStorage === "undefined") return { ...EMPTY };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    const o = parsed as Record<string, unknown>;

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

    return {
      days: Array.isArray(o.days)
        ? o.days.filter((d): d is string => typeof d === "string").slice(-MAX_DAYS_TRACKED)
        : [],
      plays: num(o.plays),
      downloads: num(o.downloads),
      dismissals: num(o.dismissals),
      snoozeUntil: num(o.snoozeUntil),
      installed: o.installed === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(next: Ledger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, or quota. The prompt degrades to "never shown", which is
    // the correct failure direction for something this interruptive.
  }
}

function update(mutate: (l: Ledger) => void) {
  const l = read();
  mutate(l);
  write(l);
  emit();
}

/* ── Platform detection ─────────────────────────────────────────────────── */

/**
 * Already installed?
 *
 * Three checks because the platforms disagree. `display-mode: standalone` is
 * the standard and covers Android/desktop; iOS Safari only ever implemented the
 * non-standard `navigator.standalone`; and a window-controls-overlay or
 * fullscreen install is still an install, so those count too.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const displayModes = ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"];
  if (window.matchMedia && displayModes.some((m) => window.matchMedia(`(display-mode: ${m})`).matches)) {
    return true;
  }

  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports a desktop Mac UA, so the touch-point count is the only
  // thing that separates an iPad from a trackpad Mac.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** iPad's share button lives top-right; iPhone's is in the bottom toolbar. */
export function isIPad(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Safari specifically, not "a browser on iOS".
 *
 * Add to Home Screen is a Safari feature. Chrome, Firefox and Edge on iOS are
 * all WebKit underneath but none of them can create a real standalone web app —
 * at best they make a shortcut that reopens Safari. Walking someone through a
 * Share menu that doesn't contain the item we're describing is worse than
 * staying quiet, so those browsers get no prompt at all.
 */
function isIOSSafari(): boolean {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|Brave/i.test(ua);
  return /Safari/i.test(ua) && !otherBrowser;
}

/** In-app webviews (Instagram, Facebook, Telegram) can't install anything. */
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|WhatsApp|Telegram/i.test(
    navigator.userAgent
  );
}

/* ── The deferred native prompt ─────────────────────────────────────────── */

let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

/**
 * Listeners are attached at module evaluation, not from an effect.
 *
 * `beforeinstallprompt` fires early — often before React has hydrated — and it
 * is not replayed. An effect-based listener misses it on a fast connection,
 * which presents as the install prompt working locally and never appearing in
 * production. Module scope runs as soon as the chunk is parsed, which is the
 * earliest point available to app code.
 */
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Without preventDefault, Chrome shows its own mini-infobar at a moment of
    // its choosing — which defeats the entire point of this module.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    update((l) => {
      l.installed = true;
    });
  });

  // A cold start in standalone mode is proof, and it's the only signal iOS
  // gives us at all — there is no `appinstalled` there.
  if (isStandalone()) {
    const l = read();
    if (!l.installed) {
      l.installed = true;
      write(l);
    }
  }

  /*
   * The listening moment depends on session age, which no event announces.
   * Without this nudge a qualifying user would sit at "not yet" until some
   * unrelated signal happened to re-render them past the threshold.
   */
  setTimeout(emit, MIN_SESSION_MS + 500);
}

/** Which flow this browser can actually offer. */
export function installRoute(): InstallRoute {
  if (deferred) return "native";
  if (isIOSSafari()) return "ios-safari";
  return "unsupported";
}

/**
 * Run the native flow. Resolves to whether the app was installed.
 *
 * The deferred event is single-use: once `prompt()` has been called the browser
 * won't let it fire again, so it's cleared either way. If the user declines, the
 * caller records a dismissal and the snooze ladder takes over.
 */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") {
      update((l) => {
        l.installed = true;
      });
      return true;
    }
    return false;
  } catch {
    // Chrome throws if the event has already been consumed, or if the call
    // didn't come from a user gesture.
    return false;
  } finally {
    emit();
  }
}

/* ── Engagement ledger ─────────────────────────────────────────────────── */

/** Local date, not UTC — "two separate days" should mean the user's days. */
function today(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

const sessionStartedAt = Date.now();

/** Record that the app was opened today. Idempotent within a day. */
export function touchDay() {
  const stamp = today();
  const l = read();
  if (l.days[l.days.length - 1] === stamp) return;
  if (!l.days.includes(stamp)) {
    l.days = [...l.days, stamp].slice(-MAX_DAYS_TRACKED);
    write(l);
    emit();
  }
}

/**
 * Bank an engagement signal.
 *
 * Called from PlayerContext at the two points that matter. Kept deliberately
 * cheap and synchronous — it runs on the "ended" event of every track, so it
 * must not be something that can block playback moving on.
 */
export function recordSignal(kind: "play" | "download") {
  update((l) => {
    if (kind === "play") l.plays += 1;
    else l.downloads += 1;
  });
}

/** Turn the offer down. Escalates the snooze; the third refusal is final. */
export function snooze() {
  update((l) => {
    const step = SNOOZE_LADDER_MS[l.dismissals];
    l.dismissals += 1;
    // No step left on the ladder means this was refusal three. Park it a
    // century out rather than adding a separate "never" flag to check.
    l.snoozeUntil = Date.now() + (step ?? 100 * 365 * 86_400_000);
  });
}

/**
 * Which moment, if any, currently justifies asking. `null` means don't.
 *
 * Ordering matters: the download moment outranks the listening one because its
 * argument is more specific, and a user who has done both should get the better
 * pitch.
 */
export function currentMoment(): InstallMoment | null {
  if (typeof window === "undefined") return null;

  const l = read();
  if (l.installed || isStandalone()) return null;
  if (isInAppBrowser()) return null;
  if (Date.now() < l.snoozeUntil) return null;
  if (installRoute() === "unsupported") return null;

  // Distinct days is the gate both moments share.
  const distinctDays = new Set(l.days).size;
  if (distinctDays < MIN_DAYS) return null;

  if (l.downloads > 0) return "download";

  if (l.plays >= MIN_PLAYS && Date.now() - sessionStartedAt >= MIN_SESSION_MS) {
    return "listening";
  }

  return null;
}

/** Has the user turned this down for the last time? Hides the manual entry. */
export function isRetired(): boolean {
  const l = read();
  return l.installed || l.dismissals >= SNOOZE_LADDER_MS.length + 1;
}

/* ── Subscription ──────────────────────────────────────────────────────── */

/**
 * The ledger is an external store, so components read it through
 * `useSyncExternalStore` rather than mirroring it into state. Anything that
 * mutates it calls `emit()`.
 */
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Snapshot for `useSyncExternalStore`, which requires a stable value between
 * changes — returning a fresh object every call would loop forever. The moment
 * and route are both short strings, so they compare by value for free.
 */
export function snapshot(): string {
  return `${currentMoment() ?? ""}|${installRoute()}`;
}

export function serverSnapshot(): string {
  return "|unsupported";
}

