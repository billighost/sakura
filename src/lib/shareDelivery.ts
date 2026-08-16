"use client";

/**
 * Getting a finished file out of the app.
 *
 * `navigator.share` is awkward in three separate ways and each needs handling:
 *
 *   1. A cancelled share sheet rejects with `AbortError`. That is the user
 *      changing their mind — not an error. Showing "Sharing failed" because
 *      someone pressed Cancel is the most common bug in share implementations.
 *   2. Some targets accept files but silently drop accompanying text or URL.
 *      So the richest payload is offered first and narrowed on rejection,
 *      rather than assuming one shape works everywhere.
 *   3. `canShare` can report true and `share` still throw `NotAllowedError`
 *      when the call has drifted outside the user-activation window — exactly
 *      what happens after a slow video export. That must fall through to a
 *      download rather than dead-ending.
 */

export type ShareOutcome =
  | { kind: "shared" }
  | { kind: "cancelled" }
  | { kind: "downloaded" }
  | { kind: "copied" }
  | { kind: "failed"; message: string };

export interface DeliverOptions {
  blob: Blob;
  filename: string;
  /** Caption text. Dropped by some targets; never required. */
  text?: string;
  /** Landing page for the share, if one was minted. */
  url?: string;
  title?: string;
}

/** True if this browser can share a file of this type at all. */
export function canShareFiles(blob: Blob, filename: string): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

export async function deliverShare({
  blob,
  filename,
  text,
  url,
  title,
}: DeliverOptions): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: blob.type });

  // Richest first, then narrower. Each candidate is gated on `canShare` so an
  // unsupported combination is skipped rather than thrown.
  const attempts: ShareData[] = [
    { files: [file], text, url, title },
    { files: [file], title },
    { files: [file] },
  ];

  for (const data of attempts) {
    if (!navigator.canShare?.(data)) continue;
    try {
      await navigator.share(data);
      return { kind: "shared" };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Deliberate cancel. Stop here — retrying with a narrower payload
        // would re-open the sheet the user just dismissed.
        return { kind: "cancelled" };
      }
      // Anything else: try the next shape, then fall through to download.
    }
  }

  return downloadBlob(blob, filename);
}

/** Save to the device. The universal fallback — every browser can do this. */
export function downloadBlob(blob: Blob, filename: string): ShareOutcome {
  try {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Revoked on a delay, not immediately: Safari cancels an in-flight
    // download if the object URL is revoked in the same task as the click.
    setTimeout(() => URL.revokeObjectURL(href), 30_000);

    return { kind: "downloaded" };
  } catch {
    return { kind: "failed", message: "Couldn't save the file." };
  }
}

/** Copy a link, with the pre-Clipboard-API fallback still in place. */
export async function copyLink(url: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return { kind: "copied" };
  } catch {
    // execCommand is deprecated but remains the only path in a non-secure
    // context, or where clipboard permission was refused.
    try {
      const input = document.createElement("textarea");
      input.value = url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      return ok ? { kind: "copied" } : { kind: "failed", message: "Couldn't copy the link." };
    } catch {
      return { kind: "failed", message: "Couldn't copy the link." };
    }
  }
}

/** Copy an image to the clipboard, where the browser supports it. */
export async function copyImage(blob: Blob): Promise<ShareOutcome> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      return { kind: "failed", message: "This browser can't copy images." };
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return { kind: "copied" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { kind: "cancelled" };
    }
    return { kind: "failed", message: "Couldn't copy the image." };
  }
}

/**
 * Mint a durable short link for the share.
 *
 * Failure is deliberately non-fatal: the image or video is worth sharing on
 * its own, so a dead /api/shares degrades to a file-only share rather than
 * blocking the thing the user actually asked for.
 *
 * Which is exactly why it's on a timeout. Without one, a request that never
 * settles — a captive portal, a phone that lost signal mid-export — left the
 * sheet sitting on "Preparing…" indefinitely after the file was already
 * finished. Four seconds is long enough for a slow-but-live connection and short
 * enough not to read as a hang; past it the share goes ahead without a link.
 */
const SHARE_LINK_TIMEOUT_MS = 4000;

export async function createShareLink(payload: {
  kind: "lyric" | "track";
  trackId: string;
  title: string;
  artist: string;
  coverUrl?: string;
  lines?: string[];
  startTime?: number;
  accentColor?: string | null;
}): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHARE_LINK_TIMEOUT_MS);
  try {
    const res = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: payload.kind, payload }),
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const { url } = await res.json();
    return typeof url === "string" ? url : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Filesystem-safe name for the exported file. */
export function shareFilename(
  track: { title: string; artist: string },
  extension: string
): string {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      // Anything a filesystem or a share target might choke on.
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);

  const name = [clean(track.artist), clean(track.title)].filter(Boolean).join("-");
  return `${name || "sakura"}.${extension}`;
}
