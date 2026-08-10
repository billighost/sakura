"use client";

import { drawBlossom, drawWordmark } from "./brandMark";

/**
 * Share-card rendering — five compositions, not one layout in five colours.
 *
 * Everything is drawn to canvas rather than composed in DOM and screenshotted:
 * html2canvas-style approaches can't see cross-origin cover art without
 * tainting the canvas, and the output has to be a real bitmap to hand to
 * `navigator.share`.
 *
 * ── Why these five ──────────────────────────────────────────────────────────
 *
 * The previous card was a blurred artwork wash with floating petals and centred
 * type. Fine, but it had one idea, and "five variants" of it would have been
 * five colourways of the same picture — which is exactly the thing that reads
 * as generated rather than designed.
 *
 * So each of these borrows from a different *physical music artifact*, because
 * that's the vocabulary the subject actually has:
 *
 *   sleeve    — the 12" record sleeve. Full-bleed art, type in the margin
 *               below it rather than on top. The default: it's the one that
 *               makes the artwork the subject.
 *   quote     — liner notes. Type-led, artwork demoted to a small chip. The
 *               right shape when the words are the reason for sharing.
 *   spread    — an editorial spread. Art on a hard diagonal with the type in
 *               the counter-space, so the composition has tension.
 *   stub      — a concert ticket, with a real perforation and metadata rows.
 *               The signature card.
 *   spectrum  — a colour-field print built from the artwork's own palette,
 *               sampled as horizontal bands. Works when the art is a mess.
 *
 * ── Constraints every variant honours ───────────────────────────────────────
 *
 * No decorative gradients (design rule 1). The only ramps here are readability
 * scrims over artwork — one colour, varying opacity — which is the sanctioned
 * exception. Colour otherwise comes from flat, tonally-related fills.
 *
 * Fonts must be loaded before the first `fillText` or the measurement pass
 * silently uses a fallback face and every subsequent layout decision is wrong.
 * `ensureFonts()` is awaited by the renderer, not left to the caller.
 */

export type CardVariant = "sleeve" | "quote" | "spread" | "stub" | "spectrum";
export type CardFormat = "story" | "square" | "landscape";

export interface CardTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
}

export interface RenderOptions {
  track: CardTrack;
  variant?: CardVariant;
  /** Selected lyric lines. The `quote` variant is built around these. */
  lines?: string[];
  accentColor?: string | null;
  format?: CardFormat;
  /** Rendered scale. 1 = export resolution, lower for on-screen previews. */
  scale?: number;
  theme?: "dark" | "light";
}

/**
 * Export dimensions.
 *
 * 1080×1920 is the story standard and 1080×1080 the post standard; both are
 * what Instagram and every clone re-encode to, so exporting larger only costs
 * upload time. Landscape is Open Graph proportions, for the link preview.
 */
const DIMENSIONS: Record<CardFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  landscape: { w: 1200, h: 630 },
};

export const VARIANTS: { key: CardVariant; label: string; hint: string }[] = [
  { key: "sleeve", label: "Sleeve", hint: "Artwork front and centre" },
  { key: "quote", label: "Quote", hint: "The words, set large" },
  { key: "spread", label: "Spread", hint: "Angled, editorial" },
  { key: "stub", label: "Ticket", hint: "A stub you could tear" },
  { key: "spectrum", label: "Spectrum", hint: "Built from the artwork's colour" },
];

/* ── Fonts ───────────────────────────────────────────────────────────────── */

const DISPLAY = '"Fraunces", ui-serif, Georgia, serif';
const BODY = '"Inter", system-ui, -apple-system, sans-serif';

/**
 * Wait for the two brand faces before drawing.
 *
 * `document.fonts.ready` alone is not enough: it resolves once *pending* loads
 * settle, and a face that has never been requested at the needed weight isn't
 * pending. So each is explicitly loaded first, then we await the set. Without
 * this the first render of a session measures against a system fallback, wraps
 * to the wrong number of lines, and shrinks type that would have fit.
 */
let fontsReady: Promise<void> | null = null;

export function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;

  fontsReady = (async () => {
    if (typeof document === "undefined" || !document.fonts) return;
    try {
      await Promise.all([
        document.fonts.load(`600 64px ${DISPLAY}`),
        document.fonts.load(`700 64px ${DISPLAY}`),
        document.fonts.load(`500 32px ${BODY}`),
        document.fonts.load(`700 32px ${BODY}`),
      ]);
      await document.fonts.ready;
    } catch {
      // A font that refuses to load is not worth failing an export over —
      // the fallback face still produces a readable card.
    }
  })();

  return fontsReady;
}

/* ── Colour ──────────────────────────────────────────────────────────────── */

type RGB = [number, number, number];

/** Sakura pink, for when no artwork colour could be extracted. */
const FALLBACK_ACCENT: RGB = [242, 120, 159];

function parseColor(input: string): RGB {
  const value = input.trim();

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full.slice(0, 6), 16);
    if (Number.isNaN(n)) return FALLBACK_ACCENT;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length >= 3 && parts.every((p) => !Number.isNaN(p))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  return FALLBACK_ACCENT;
}

function rgb([r, g, b]: RGB, alpha = 1): string {
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Lighten (positive) or darken (negative) toward white/black. */
function shift([r, g, b]: RGB, amount: number): RGB {
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return [f(r), f(g), f(b)];
}

/** WCAG relative luminance — decides whether text on this colour goes dark. */
function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Ink that will actually be legible on a given fill.
 *
 * The extracted artwork colour is arbitrary — it can come back as pale yellow
 * or near-black — so any variant that puts text on it has to ask rather than
 * assume. 0.45 is where white stops winning in practice.
 */
function inkOn(background: RGB): string {
  return luminance(background) > 0.45 ? "#17131C" : "#FFFFFF";
}

/* ── Drawing helpers ─────────────────────────────────────────────────────── */

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Load an image with CORS enabled, resolving null rather than throwing.
 *
 * Everything not already same-origin goes through /api/image-proxy: a
 * cross-origin cover drawn directly taints the canvas, and a tainted canvas
 * makes `toBlob` return null — so the export fails at the very last step,
 * after the user has already chosen a variant and pressed share.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src =
      url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")
        ? url
        : `/api/image-proxy?url=${encodeURIComponent(url)}`;

    // A CDN that never responds must not hang the share sheet forever.
    setTimeout(() => finish(null), 8000);
  });
}

/** True when text should be laid out right-to-left. */
function isRtl(text: string): boolean {
  return /[\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Thaana}\p{sc=Syriac}]/u.test(text);
}

interface TextLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/**
 * Wrap text to a width, shrinking until it fits `maxLines`.
 *
 * Lyrics and song titles are arbitrary length: a two-word line and a
 * forty-word verse both have to look deliberate on the same card, and a
 * Japanese title has no spaces to break on at all. Hence two passes — word
 * breaking first, then per-character for scripts where that fails.
 */
function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  font: (size: number) => string,
  startSize: number,
  minSize: number,
  lineHeightRatio = 1.34
): TextLayout {
  const step = Math.max(2, Math.round(startSize * 0.05));

  for (let size = startSize; size >= minSize; size -= step) {
    ctx.font = font(size);
    const wrapped = wrap(ctx, text, maxWidth);
    if (wrapped.length <= maxLines) {
      return { lines: wrapped, fontSize: size, lineHeight: size * lineHeightRatio };
    }
  }

  // Didn't fit even at the floor: truncate rather than overflow the card.
  ctx.font = font(minSize);
  const wrapped = wrap(ctx, text, maxWidth).slice(0, maxLines);
  const lastIndex = wrapped.length - 1;
  if (lastIndex >= 0) {
    let last = wrapped[lastIndex];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    wrapped[lastIndex] = `${last.trimEnd()}…`;
  }
  return { lines: wrapped, fontSize: minSize, lineHeight: minSize * lineHeightRatio };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);

    // No spaces at all (CJK) — break per character or the whole line
    // overflows as one unbreakable run.
    if (words.length <= 1 && ctx.measureText(paragraph).width > maxWidth) {
      let current = "";
      for (const ch of paragraph) {
        if (ctx.measureText(current + ch).width > maxWidth && current) {
          out.push(current);
          current = ch;
        } else {
          current += ch;
        }
      }
      if (current) out.push(current);
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) out.push(current);
        // A single word longer than the line still has to break somewhere.
        if (ctx.measureText(word).width > maxWidth) {
          let part = "";
          for (const ch of word) {
            if (ctx.measureText(part + ch).width > maxWidth && part) {
              out.push(part);
              part = ch;
            } else {
              part += ch;
            }
          }
          current = part;
        } else {
          current = word;
        }
      }
    }
    if (current) out.push(current);
  }

  return out.length ? out : [""];
}

/** Shorten to fit the current font, with an ellipsis. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

/* ── Render context passed to each variant ───────────────────────────────── */

interface Scene {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Scale factor against the 1080-wide design space. */
  u: number;
  pad: number;
  track: CardTrack;
  lines: string[];
  cover: HTMLImageElement | null;
  accent: RGB;
  isLight: boolean;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  surface: RGB;
  format: CardFormat;
}

/* ── The renderer ────────────────────────────────────────────────────────── */

export async function renderShareCard(
  canvas: HTMLCanvasElement,
  options: RenderOptions
): Promise<void> {
  const {
    track,
    variant = "sleeve",
    lines = [],
    accentColor,
    format = "story",
    scale = 1,
    theme = "dark",
  } = options;

  // Fonts first. Every layout decision below depends on measurement, and
  // measuring against a fallback face produces a card laid out for type that
  // isn't the type finally drawn.
  await ensureFonts();

  const dims = DIMENSIONS[format];
  const W = Math.round(dims.w * scale);
  const H = Math.round(dims.h * scale);

  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const u = W / dims.w;
  const isLight = theme === "light";
  const accent = parseColor(accentColor || "#F2789F");
  const cover = track.coverUrl ? await loadImage(track.coverUrl) : null;
  const surface: RGB = isLight ? [250, 248, 250] : [16, 13, 18];

  const scene: Scene = {
    ctx,
    W,
    H,
    u,
    pad: Math.round(72 * u),
    track,
    lines: lines.filter((l) => l.trim()),
    cover,
    accent,
    isLight,
    ink: isLight ? "#17131C" : "#FFFFFF",
    inkSoft: isLight ? "rgba(23,19,28,0.64)" : "rgba(255,255,255,0.68)",
    inkFaint: isLight ? "rgba(23,19,28,0.4)" : "rgba(255,255,255,0.42)",
    surface,
    format,
  };

  // Base fill. Flat — variants that want depth build it from stepped panels
  // rather than a gradient.
  ctx.fillStyle = rgb(surface);
  ctx.fillRect(0, 0, W, H);

  switch (variant) {
    case "quote":
      drawQuote(scene);
      break;
    case "spread":
      drawSpread(scene);
      break;
    case "stub":
      drawStub(scene);
      break;
    case "spectrum":
      drawSpectrum(scene);
      break;
    default:
      drawSleeve(scene);
  }
}

/* ── 1. Sleeve ───────────────────────────────────────────────────────────────
 *
 * The 12" record sleeve: art occupying the full width, type set in the margin
 * *below* it rather than over it. Nothing overlaps the artwork, which is the
 * point — a sleeve doesn't print its title across the picture.
 */
function drawSleeve(s: Scene): void {
  const { ctx, W, H, u, pad, track, ink, inkSoft, accent } = s;

  const artSize = W - pad * 2;
  const artY = s.format === "story" ? Math.round(H * 0.13) : pad;

  drawArtwork(s, pad, artY, artSize, artSize, 6 * u);

  let y = artY + artSize + Math.round(64 * u);

  // A short accent rule — the one place colour appears as structure.
  ctx.fillStyle = rgb(accent);
  ctx.fillRect(pad, y, Math.round(72 * u), Math.round(5 * u));
  y += Math.round(44 * u);

  const maxWidth = W - pad * 2;
  const rtl = isRtl(track.title);
  ctx.textAlign = rtl ? "right" : "left";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "top";
  const textX = rtl ? W - pad : pad;

  // The title is the name of a thing — display face, per the type rule.
  const title = layoutText(
    ctx,
    track.title,
    maxWidth,
    2,
    (size) => `600 ${Math.round(size)}px ${DISPLAY}`,
    Math.round(76 * u),
    Math.round(40 * u),
    1.16
  );

  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(title.fontSize)}px ${DISPLAY}`;
  for (const line of title.lines) {
    ctx.fillText(line, textX, y);
    y += title.lineHeight;
  }

  y += Math.round(14 * u);

  // The artist is a name too, but subordinate — body face keeps the hierarchy
  // legible without a second display size competing.
  ctx.fillStyle = inkSoft;
  ctx.font = `500 ${Math.round(36 * u)}px ${BODY}`;
  ctx.fillText(truncate(ctx, track.artist, maxWidth), textX, y);

  ctx.direction = "ltr";
  drawFooter(s);
}

/* ── 2. Quote ────────────────────────────────────────────────────────────────
 *
 * Liner notes. The words are the subject and take the whole upper field; the
 * artwork is demoted to a chip beside the credit, the way a pull quote in
 * print carries a small portrait rather than a full plate.
 */
function drawQuote(s: Scene): void {
  const { ctx, W, H, u, pad, track, lines, accent, isLight } = s;

  const text = lines.length ? lines.join("\n") : track.title;
  const maxWidth = W - pad * 2;
  const rtl = isRtl(text);

  // A tinted panel rather than plain ground — one flat step of the accent, not
  // a ramp. Stops the card reading as a text file.
  const panel: RGB = isLight ? shift(accent, 0.86) : shift(accent, -0.78);
  ctx.fillStyle = rgb(panel);
  ctx.fillRect(0, 0, W, H);

  const panelInk = inkOn(panel);

  // Oversized quote mark as texture, low contrast so it doesn't compete with
  // the words it opens.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = rgb(shift(accent, isLight ? -0.2 : 0.4));
  ctx.font = `700 ${Math.round(340 * u)}px ${DISPLAY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("“", pad - Math.round(24 * u), Math.round(H * 0.06));
  ctx.restore();

  const creditHeight = Math.round(200 * u);
  const available = H - Math.round(H * 0.2) - creditHeight - pad;
  const maxLines = Math.max(3, Math.floor(available / (78 * u)));

  const body = layoutText(
    ctx,
    text,
    maxWidth,
    maxLines,
    (size) => `600 ${Math.round(size)}px ${DISPLAY}`,
    Math.round(82 * u),
    Math.round(34 * u),
    1.4
  );

  // Centred in the field above the credit block, so a two-line quote sits as
  // deliberately as an eight-line one.
  const blockHeight = body.lines.length * body.lineHeight;
  let y = Math.max(Math.round(H * 0.2), (H - creditHeight - blockHeight) / 2);

  ctx.textAlign = rtl ? "right" : "left";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "top";
  ctx.fillStyle = panelInk;
  ctx.font = `600 ${Math.round(body.fontSize)}px ${DISPLAY}`;

  const textX = rtl ? W - pad : pad;
  for (const line of body.lines) {
    ctx.fillText(line, textX, y);
    y += body.lineHeight;
  }
  ctx.direction = "ltr";

  // Credit row: artwork chip, then title and artist.
  const chip = Math.round(96 * u);
  const chipY = H - pad - chip - Math.round(28 * u);
  drawArtwork(s, pad, chipY, chip, chip, 4 * u);

  const creditX = pad + chip + Math.round(28 * u);
  const creditWidth = W - creditX - pad;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = panelInk;
  ctx.font = `700 ${Math.round(34 * u)}px ${BODY}`;
  ctx.fillText(truncate(ctx, track.title, creditWidth), creditX, chipY + Math.round(16 * u));

  ctx.globalAlpha = 0.7;
  ctx.font = `500 ${Math.round(30 * u)}px ${BODY}`;
  ctx.fillText(truncate(ctx, track.artist, creditWidth), creditX, chipY + Math.round(58 * u));
  ctx.globalAlpha = 1;

  drawFooter(s, panelInk);
}

/* ── 3. Spread ───────────────────────────────────────────────────────────────
 *
 * An editorial spread. The artwork is clipped to a hard diagonal and the type
 * sits in the counter-space, so the composition has a real axis instead of
 * being centred. Same angle top and bottom, which is what keeps it looking set
 * rather than skewed.
 */
function drawSpread(s: Scene): void {
  const { ctx, W, H, u, pad, track, lines, accent, isLight, surface } = s;

  const splitY = Math.round(H * 0.52);
  const skew = Math.round(H * 0.07);

  // Upper field: artwork, clipped to the diagonal.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, splitY - skew);
  ctx.lineTo(0, splitY + skew);
  ctx.closePath();
  ctx.clip();

  if (s.cover) {
    drawImageCover(ctx, s.cover, 0, 0, W, splitY + skew);
    // One colour, ramping opacity — the sanctioned readability scrim, so the
    // eyebrow and rule below stay legible against any artwork.
    const scrim = ctx.createLinearGradient(0, 0, 0, splitY + skew);
    scrim.addColorStop(0, "rgba(10,7,12,0)");
    scrim.addColorStop(1, "rgba(10,7,12,0.55)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, splitY + skew);
  } else {
    ctx.fillStyle = rgb(shift(accent, isLight ? 0.3 : -0.35));
    ctx.fillRect(0, 0, W, splitY + skew);
    drawBlossom(ctx, {
      x: W / 2,
      y: (splitY + skew) / 2,
      size: Math.round(120 * u),
      color: rgb(accent),
      opacity: 0.5,
    });
  }
  ctx.restore();

  // A hairline of accent along the cut, so the two fields read as joined
  // rather than as one image simply ending.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, splitY + skew);
  ctx.lineTo(W, splitY - skew);
  ctx.lineWidth = Math.max(2, Math.round(4 * u));
  ctx.strokeStyle = rgb(accent);
  ctx.stroke();
  ctx.restore();

  let y = splitY + skew + Math.round(56 * u);
  const maxWidth = W - pad * 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Eyebrow — a label, so body face, uppercase and tracked.
  ctx.fillStyle = rgb(accent);
  ctx.font = `700 ${Math.round(24 * u)}px ${BODY}`;
  ctx.letterSpacing = `${Math.round(3 * u)}px`;
  ctx.fillText(lines.length ? "LYRIC" : "NOW PLAYING", pad, y);
  ctx.letterSpacing = "0px";
  y += Math.round(48 * u);

  const headline = lines.length ? lines.join(" ") : track.title;
  const head = layoutText(
    ctx,
    headline,
    maxWidth,
    lines.length ? 4 : 3,
    (size) => `600 ${Math.round(size)}px ${DISPLAY}`,
    Math.round(68 * u),
    Math.round(34 * u),
    1.22
  );

  ctx.fillStyle = inkOn(surface);
  ctx.font = `600 ${Math.round(head.fontSize)}px ${DISPLAY}`;
  for (const line of head.lines) {
    ctx.fillText(line, pad, y);
    y += head.lineHeight;
  }

  y += Math.round(28 * u);

  ctx.fillStyle = s.inkSoft;
  ctx.font = `500 ${Math.round(30 * u)}px ${BODY}`;
  const credit = lines.length ? `${track.title} — ${track.artist}` : track.artist;
  ctx.fillText(truncate(ctx, credit, maxWidth), pad, y);

  drawFooter(s);
}

/* ── 4. Stub ─────────────────────────────────────────────────────────────────
 *
 * The signature card: a concert ticket. A real perforation — punched circles
 * cutting through the panel edges plus a dashed tear line — and metadata in
 * labelled rows the way a ticket prints them.
 *
 * The perforation uses `destination-out` compositing rather than circles
 * painted in the background colour, so it stays a genuine hole whatever sits
 * behind the card. Painted discs would become visible the moment the ticket
 * moved onto a different ground.
 */
function drawStub(s: Scene): void {
  const { ctx, W, H, u, track, lines, accent, isLight } = s;

  const margin = Math.round(56 * u);
  const cardX = margin;
  const cardW = W - margin * 2;
  const cardH = s.format === "landscape" ? H - margin * 2 : Math.round(H * 0.74);
  const cardY = Math.round((H - cardH) / 2);
  const radius = Math.round(20 * u);

  // Ticket stock, one step off the ground so it reads as a separate object.
  const stock: RGB = isLight ? [255, 255, 255] : [27, 22, 31];
  const stockInk = inkOn(stock);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = Math.round(50 * u);
  ctx.shadowOffsetY = Math.round(18 * u);
  roundedRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = rgb(stock);
  ctx.fill();
  ctx.restore();

  const artH = Math.round(cardH * 0.52);
  ctx.save();
  roundedRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.clip();
  drawArtworkRaw(s, cardX, cardY, cardW, artH);
  ctx.restore();

  const tearY = cardY + artH + Math.round(52 * u);
  const notch = Math.round(22 * u);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (const cx of [cardX, cardX + cardW]) {
    ctx.beginPath();
    ctx.arc(cx, tearY, notch, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([Math.round(10 * u), Math.round(12 * u)]);
  ctx.lineWidth = Math.max(1.5, Math.round(3 * u));
  ctx.strokeStyle = isLight ? "rgba(23,19,28,0.2)" : "rgba(255,255,255,0.2)";
  ctx.moveTo(cardX + notch + Math.round(14 * u), tearY);
  ctx.lineTo(cardX + cardW - notch - Math.round(14 * u), tearY);
  ctx.stroke();
  ctx.restore();

  const innerPad = Math.round(48 * u);
  const innerX = cardX + innerPad;
  const innerW = cardW - innerPad * 2;

  // Title, in the band between the art and the tear.
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";

  const title = layoutText(
    ctx,
    track.title,
    innerW,
    1,
    (size) => `700 ${Math.round(size)}px ${DISPLAY}`,
    Math.round(46 * u),
    Math.round(28 * u)
  );
  ctx.fillStyle = stockInk;
  ctx.font = `700 ${Math.round(title.fontSize)}px ${DISPLAY}`;
  ctx.fillText(title.lines[0], innerX, cardY + artH - Math.round(4 * u));

  // Metadata below the tear — label above value, as a ticket sets them.
  let y = tearY + Math.round(56 * u);
  ctx.textBaseline = "top";

  const rows: [string, string][] = [["ARTIST", track.artist]];
  if (track.album) rows.push(["FROM", track.album]);
  if (lines.length) rows.push(["LYRIC", lines.join(" ")]);

  for (const [label, value] of rows) {
    ctx.fillStyle = rgb(accent);
    ctx.font = `700 ${Math.round(20 * u)}px ${BODY}`;
    ctx.letterSpacing = `${Math.round(2.5 * u)}px`;
    ctx.fillText(label, innerX, y);
    ctx.letterSpacing = "0px";
    y += Math.round(30 * u);

    const isLyric = label === "LYRIC";
    const valueLayout = layoutText(
      ctx,
      value,
      innerW,
      isLyric ? 2 : 1,
      (size) =>
        isLyric
          ? `500 ${Math.round(size)}px ${DISPLAY}`
          : `600 ${Math.round(size)}px ${BODY}`,
      Math.round(30 * u),
      Math.round(22 * u),
      1.3
    );

    ctx.fillStyle = stockInk;
    ctx.font = isLyric
      ? `500 ${Math.round(valueLayout.fontSize)}px ${DISPLAY}`
      : `600 ${Math.round(valueLayout.fontSize)}px ${BODY}`;
    for (const line of valueLayout.lines) {
      ctx.fillText(line, innerX, y);
      y += valueLayout.lineHeight;
    }
    y += Math.round(22 * u);
  }

  // Blossom in the stub's corner, where a ticket carries its venue mark.
  drawBlossom(ctx, {
    x: cardX + cardW - innerPad - Math.round(12 * u),
    y: cardY + cardH - innerPad,
    size: Math.round(26 * u),
    color: rgb(accent),
    opacity: 0.9,
  });

  drawFooter(s);
}

/* ── 5. Spectrum ─────────────────────────────────────────────────────────────
 *
 * A colour-field print. The artwork is sampled into horizontal bands, so the
 * card is *made of* the song's colours without showing the picture. It's the
 * variant that survives a busy, low-resolution or missing cover best.
 *
 * Flat fills sampled from the image, not a gradient between two stops — which
 * is both the design rule and why it reads as a print rather than a CSS demo.
 */
function drawSpectrum(s: Scene): void {
  const { ctx, W, H, u, pad, track, lines, cover, accent, isLight } = s;

  const bands = sampleBands(cover, accent, 9, isLight);
  const fieldH = Math.round(H * 0.58);
  const bandH = fieldH / bands.length;

  bands.forEach((band, i) => {
    ctx.fillStyle = rgb(band);
    // Ceil + 1 avoids hairline seams from fractional band heights.
    ctx.fillRect(0, Math.round(i * bandH), W, Math.ceil(bandH) + 1);
  });

  const groundColor: RGB = isLight ? [255, 255, 255] : [14, 11, 16];
  ctx.fillStyle = rgb(groundColor);
  ctx.fillRect(0, fieldH, W, H - fieldH);

  const groundInk = inkOn(groundColor);
  let y = fieldH + Math.round(64 * u);
  const maxWidth = W - pad * 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const headline = lines.length ? lines.join(" ") : track.title;
  const head = layoutText(
    ctx,
    headline,
    maxWidth,
    3,
    (size) => `600 ${Math.round(size)}px ${DISPLAY}`,
    Math.round(64 * u),
    Math.round(32 * u),
    1.24
  );

  ctx.fillStyle = groundInk;
  ctx.font = `600 ${Math.round(head.fontSize)}px ${DISPLAY}`;
  for (const line of head.lines) {
    ctx.fillText(line, pad, y);
    y += head.lineHeight;
  }

  y += Math.round(24 * u);

  ctx.globalAlpha = 0.68;
  ctx.fillStyle = groundInk;
  ctx.font = `500 ${Math.round(30 * u)}px ${BODY}`;
  const credit = lines.length ? `${track.title} — ${track.artist}` : track.artist;
  ctx.fillText(truncate(ctx, credit, maxWidth), pad, y);
  ctx.globalAlpha = 1;

  drawFooter(s, groundInk);
}

/**
 * Sample the artwork into N flat bands, top to bottom.
 *
 * Drawn to a 1×N offscreen canvas first: reading 1080 rows of pixels to
 * produce nine averages is wasted work, and the downscale makes the browser do
 * the averaging in optimised native code.
 */
function sampleBands(
  cover: HTMLImageElement | null,
  accent: RGB,
  count: number,
  isLight: boolean
): RGB[] {
  if (cover) {
    try {
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = count;
      const pctx = probe.getContext("2d", { willReadFrequently: true });
      if (pctx) {
        pctx.drawImage(cover, 0, 0, 1, count);
        const { data } = pctx.getImageData(0, 0, 1, count);
        const out: RGB[] = [];
        for (let i = 0; i < count; i++) {
          const o = i * 4;
          out.push([data[o], data[o + 1], data[o + 2]]);
        }
        return out;
      }
    } catch {
      // Tainted despite the proxy — fall through to the accent ramp.
    }
  }

  // No cover: step the accent by luminance. Still flat bands, still derived
  // from the one colour we have.
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return shift(accent, isLight ? 0.72 - t * 0.6 : -0.6 + t * 0.5);
  });
}

/* ── Shared pieces ───────────────────────────────────────────────────────── */

/** Artwork in a rounded panel, with a placeholder when there's no cover. */
function drawArtwork(
  s: Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const { ctx, u } = s;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.round(44 * u);
  ctx.shadowOffsetY = Math.round(16 * u);
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = s.isLight ? "#EAE4EE" : "#221C28";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.clip();
  drawArtworkRaw(s, x, y, w, h);
  ctx.restore();
}

/** The artwork itself, unclipped — callers set up their own clip path. */
function drawArtworkRaw(s: Scene, x: number, y: number, w: number, h: number): void {
  const { ctx, cover, accent, isLight } = s;

  if (cover) {
    drawImageCover(ctx, cover, x, y, w, h);
    return;
  }

  // No artwork: a flat accent panel with the brand mark. Deliberately not a
  // gradient — a missing cover shouldn't be the one place a ramp appears.
  ctx.fillStyle = rgb(shift(accent, isLight ? 0.55 : -0.45));
  ctx.fillRect(x, y, w, h);
  drawBlossom(ctx, {
    x: x + w / 2,
    y: y + h / 2,
    size: Math.min(w, h) * 0.22,
    color: rgb(accent),
    opacity: 0.85,
    rotate: 12,
  });
}

/** `object-fit: cover`, so non-square artwork is cropped rather than squashed. */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const targetRatio = w / h;
  const sourceRatio = img.width / img.height;

  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (sourceRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * The brand lockup, bottom-centre on every variant.
 *
 * Canvas-drawn via `drawWordmark` rather than an emoji: 🌸 renders as a
 * different picture on every OS, and on a machine missing the emoji font it
 * exports a literal empty box into an image people post publicly.
 */
function drawFooter(s: Scene, inkOverride?: string): void {
  const { ctx, W, H, u, accent } = s;

  drawWordmark(ctx, {
    x: W / 2,
    y: H - Math.round(64 * u),
    fontSize: Math.round(26 * u),
    color: inkOverride
      ? withAlpha(inkOverride, 0.5)
      : s.isLight
        ? "rgba(23,19,28,0.45)"
        : "rgba(255,255,255,0.5)",
    markColor: rgb(accent),
  });
}

/** Apply an alpha to a hex or rgb() string, for the footer's derived ink. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) return rgb(parseColor(color), alpha);
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const [r, g, b] = match[1].split(",").map((p) => parseInt(p.trim(), 10));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/* ── Export ──────────────────────────────────────────────────────────────── */

/**
 * Canvas → PNG blob.
 *
 * PNG rather than JPEG: these cards are flat colour and type, which is what
 * PNG compresses well and what JPEG puts ringing artefacts around. `toBlob`
 * resolves null on a tainted canvas — the caller must surface that rather than
 * silently sharing nothing.
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png"
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type);
    } catch {
      resolve(null);
    }
  });
}

export { DIMENSIONS, luminance, parseColor, rgb, shift, inkOn, DISPLAY, BODY };
