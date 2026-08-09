"use client";

/**
 * Share-card rendering.
 *
 * Everything is drawn to a canvas rather than composed in DOM and screenshotted:
 * `html2canvas`-style approaches can't see cross-origin cover art without
 * tainting the canvas, and the output has to be a real bitmap we can hand to
 * `navigator.share`.
 *
 * The visual system is deliberately *derived*, not fixed. Three inputs — the
 * cover's dominant colour, the track identity, and the sharer's user id —
 * select the gradient, the geometry and the petal placement, so two people
 * sharing the same song get recognisably-Sakura but visibly different cards,
 * and the same person's shares stay stylistically consistent. That's the
 * "unique per user" property without needing a design per user.
 */

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
  /** Selected lyric lines. Empty for a plain "now playing" card. */
  lines?: string[];
  accentColor?: string | null;
  format?: CardFormat;
  /** Stable per-user seed — varies the generative layer between people. */
  seed?: string;
  /** Rendered scale. 1 = share resolution, lower for on-screen previews. */
  scale?: number;
  theme?: "dark" | "light";
}

const DIMENSIONS: Record<CardFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  landscape: { w: 1200, h: 630 },
};

/* ── Deterministic randomness ───────────────────────────────────────────── */

/** FNV-1a. Small, fast, and good enough to decorrelate nearby seeds. */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a seeded PRNG, so a given card always renders identically. */
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Colour ─────────────────────────────────────────────────────────────── */

function parseColor(input: string): [number, number, number] {
  const hex = input.trim();
  if (hex.startsWith("#")) {
    const v = hex.slice(1);
    const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const m = hex.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((n) => parseInt(n.trim(), 10));
    return [r || 0, g || 0, b || 0];
  }
  return [242, 120, 159]; // sakura pink
}

function rgb([r, g, b]: [number, number, number], alpha = 1) {
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

function shift(
  [r, g, b]: [number, number, number],
  amount: number
): [number, number, number] {
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return [f(r), f(g), f(b)];
}

/** Relative luminance — decides whether text on this colour should be dark. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/* ── Drawing primitives ─────────────────────────────────────────────────── */

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A five-petal blossom, drawn at an arbitrary size/rotation. */
function petal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  fill: string,
  alpha: number
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;

  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 * i) / 5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(size * 0.42, -size * 0.28, size * 0.42, -size * 0.85, 0, -size);
    ctx.bezierCurveTo(-size * 0.42, -size * 0.85, -size * 0.42, -size * 0.28, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Wrap text to a width, shrinking the font until it fits `maxLines`.
 *
 * Necessary because lyrics are arbitrary length: a two-word line and a
 * forty-word verse both have to look deliberate on the same card.
 */
function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  fontBuilder: (size: number) => string,
  startSize: number,
  minSize: number
): { lines: string[]; fontSize: number } {
  for (let size = startSize; size >= minSize; size -= Math.max(2, Math.round(size * 0.06))) {
    ctx.font = fontBuilder(size);
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    if (lines.length <= maxLines) return { lines, fontSize: size };
  }

  // Didn't fit even at the floor — truncate with an ellipsis rather than
  // overflowing the card.
  ctx.font = fontBuilder(minSize);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last.trimEnd() + "…";
  }
  return { lines, fontSize: minSize };
}

/** Load an image with CORS enabled; resolves null rather than throwing. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url.startsWith("/") || url.startsWith("data:") 
      ? url 
      : `/api/image-proxy?url=${encodeURIComponent(url)}`;

    // A CDN that never responds shouldn't hang the share sheet forever.
    setTimeout(() => resolve(null), 8000);
  });
}

/* ── The renderer ───────────────────────────────────────────────────────── */

export async function renderShareCard(
  canvas: HTMLCanvasElement,
  options: RenderOptions
): Promise<void> {
  const {
    track,
    lines = [],
    accentColor,
    format = "story",
    seed = track.id,
    scale = 1,
    theme = "dark",
  } = options;

  const dims = DIMENSIONS[format];
  const W = Math.round(dims.w * scale);
  const H = Math.round(dims.h * scale);

  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Work in a normalised 1080-wide space so every measurement below is
  // scale-independent.
  const u = W / dims.w;
  const rng = makeRng(hashString(seed));

  const accent = parseColor(accentColor || "#F2789F");
  const accentLight = shift(accent, 0.35);
  const accentDeep = shift(accent, -0.55);
  const isLight = theme === "light";

  const ink = isLight ? "#1A1620" : "#FFFFFF";
  const inkSoft = isLight ? "rgba(26,22,32,0.62)" : "rgba(255,255,255,0.66)";
  const inkFaint = isLight ? "rgba(26,22,32,0.38)" : "rgba(255,255,255,0.38)";

  /* Background: cover-derived gradient, angle varied by seed. */
  const angle = rng() * Math.PI * 2;
  const gx = Math.cos(angle) * W * 0.5;
  const gy = Math.sin(angle) * H * 0.5;
  const bg = ctx.createLinearGradient(W / 2 - gx, H / 2 - gy, W / 2 + gx, H / 2 + gy);

  if (isLight) {
    bg.addColorStop(0, rgb(shift(accent, 0.72)));
    bg.addColorStop(0.55, "#FAF8FA");
    bg.addColorStop(1, rgb(shift(accent, 0.5)));
  } else {
    bg.addColorStop(0, rgb(accentDeep));
    bg.addColorStop(0.5, "#16121A");
    bg.addColorStop(1, "#0B090C");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cover = track.coverUrl ? await loadImage(track.coverUrl) : null;

  /* Blurred cover wash — gives the card the song's own colour field. */
  if (cover) {
    ctx.save();
    ctx.globalAlpha = isLight ? 0.22 : 0.34;
    ctx.filter = `blur(${Math.round(90 * u)}px) saturate(1.7)`;
    const s = Math.max(W, H) * 1.5;
    ctx.drawImage(cover, (W - s) / 2, (H - s) / 2, s, s);
    ctx.restore();
    ctx.filter = "none";
  }

  /* Generative petal field — the per-user signature. */
  const petalCount = 7 + Math.floor(rng() * 6);
  for (let i = 0; i < petalCount; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const size = (28 + rng() * 78) * u;
    const rot = rng() * Math.PI * 2;
    const tint = rng() > 0.5 ? rgb(accentLight) : "#C9A6E0";
    petal(ctx, px, py, size, rot, tint, 0.05 + rng() * 0.09);
  }

  /* Readability scrim — text has to clear WCAG against arbitrary artwork. */
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  if (isLight) {
    scrim.addColorStop(0, "rgba(255,255,255,0.28)");
    scrim.addColorStop(0.45, "rgba(255,255,255,0.55)");
    scrim.addColorStop(1, "rgba(255,255,255,0.82)");
  } else {
    scrim.addColorStop(0, "rgba(8,6,10,0.34)");
    scrim.addColorStop(0.45, "rgba(8,6,10,0.5)");
    scrim.addColorStop(1, "rgba(8,6,10,0.86)");
  }
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  const hasLyrics = lines.length > 0;

  if (format === "landscape") {
    drawLandscape();
  } else {
    drawPortrait();
  }

  /* ── Layouts ─────────────────────────────────────────────────────────── */

  function drawPortrait() {
    const pad = 96 * u;
    const artSize = hasLyrics ? 300 * u : 620 * u;
    const artX = hasLyrics ? pad : (W - artSize) / 2;
    const artY = hasLyrics ? pad * 1.1 : H * (format === "square" ? 0.11 : 0.14);

    drawArt(artX, artY, artSize);

    let cursor = artY + artSize + (hasLyrics ? 86 * u : 78 * u);

    if (hasLyrics) {
      // Lyric-led: the words are the subject, credits sit underneath.
      const text = lines.join("\n");
      const maxWidth = W - pad * 2;
      const available = H - cursor - 260 * u;
      const maxLines = Math.max(3, Math.floor(available / (76 * u)));

      const { lines: wrapped, fontSize } = layoutText(
        ctx!,
        text.replace(/\n/g, " ⁄ "),
        maxWidth,
        maxLines,
        (s) => `600 ${Math.round(s)}px "Fraunces", ui-serif, Georgia, serif`,
        68 * u,
        30 * u
      );

      // Opening quote mark, set large and low-contrast as a graphic element.
      ctx!.save();
      ctx!.globalAlpha = 0.16;
      ctx!.fillStyle = rgb(accentLight);
      ctx!.font = `700 ${Math.round(180 * u)}px "Fraunces", ui-serif, Georgia, serif`;
      ctx!.textAlign = "left";
      ctx!.textBaseline = "top";
      ctx!.fillText("“", pad - 12 * u, cursor - 92 * u);
      ctx!.restore();

      ctx!.textAlign = "left";
      ctx!.textBaseline = "top";
      ctx!.fillStyle = ink;
      ctx!.font = `600 ${Math.round(fontSize)}px "Fraunces", ui-serif, Georgia, serif`;

      const lineHeight = fontSize * 1.42;
      for (const line of wrapped) {
        ctx!.fillText(line, pad, cursor);
        cursor += lineHeight;
      }

      cursor += 54 * u;

      // Accent rule, then credits.
      ctx!.fillStyle = rgb(accent);
      ctx!.fillRect(pad, cursor, 90 * u, 5 * u);
      cursor += 40 * u;

      ctx!.fillStyle = ink;
      ctx!.font = `700 ${Math.round(38 * u)}px "Inter", system-ui, sans-serif`;
      ctx!.fillText(truncate(track.title, W - pad * 2), pad, cursor);
      cursor += 50 * u;

      ctx!.fillStyle = inkSoft;
      ctx!.font = `500 ${Math.round(32 * u)}px "Inter", system-ui, sans-serif`;
      ctx!.fillText(truncate(track.artist, W - pad * 2), pad, cursor);
    } else {
      // Art-led "now playing" card.
      ctx!.textAlign = "center";
      ctx!.textBaseline = "top";

      ctx!.fillStyle = ink;
      const titleSize = 62 * u;
      ctx!.font = `700 ${Math.round(titleSize)}px "Inter", system-ui, sans-serif`;
      ctx!.fillText(truncate(track.title, W - pad * 2), W / 2, cursor);
      cursor += titleSize * 1.35;

      ctx!.fillStyle = inkSoft;
      ctx!.font = `500 ${Math.round(40 * u)}px "Inter", system-ui, sans-serif`;
      ctx!.fillText(truncate(track.artist, W - pad * 2), W / 2, cursor);
      cursor += 92 * u;

      drawWaveform(W / 2 - 210 * u, cursor, 420 * u, 54 * u);
    }

    drawWatermark();
  }

  function drawLandscape() {
    // Open-graph proportions: art left, text right.
    const pad = 64 * u;
    const artSize = H - pad * 2;
    drawArt(pad, pad, artSize);

    const textX = pad + artSize + 56 * u;
    const maxWidth = W - textX - pad;
    let cursor = pad + 24 * u;

    ctx!.textAlign = "left";
    ctx!.textBaseline = "top";

    if (hasLyrics) {
      const { lines: wrapped, fontSize } = layoutText(
        ctx!,
        lines.join(" ⁄ "),
        maxWidth,
        4,
        (s) => `600 ${Math.round(s)}px "Fraunces", ui-serif, Georgia, serif`,
        48 * u,
        26 * u
      );
      ctx!.fillStyle = ink;
      ctx!.font = `600 ${Math.round(fontSize)}px "Fraunces", ui-serif, Georgia, serif`;
      for (const line of wrapped) {
        ctx!.fillText(line, textX, cursor);
        cursor += fontSize * 1.4;
      }
      cursor += 26 * u;
    }

    ctx!.fillStyle = rgb(accent);
    ctx!.fillRect(textX, cursor, 64 * u, 4 * u);
    cursor += 28 * u;

    ctx!.fillStyle = ink;
    ctx!.font = `700 ${Math.round(40 * u)}px "Inter", system-ui, sans-serif`;
    ctx!.fillText(truncate(track.title, maxWidth), textX, cursor);
    cursor += 52 * u;

    ctx!.fillStyle = inkSoft;
    ctx!.font = `500 ${Math.round(30 * u)}px "Inter", system-ui, sans-serif`;
    ctx!.fillText(truncate(track.artist, maxWidth), textX, cursor);

    drawWatermark();
  }

  /* ── Shared pieces ───────────────────────────────────────────────────── */

  function drawArt(x: number, y: number, size: number) {
    const r = size * 0.055;

    ctx!.save();
    ctx!.shadowColor = "rgba(0,0,0,0.55)";
    ctx!.shadowBlur = 70 * u;
    ctx!.shadowOffsetY = 26 * u;
    roundedRect(ctx!, x, y, size, size, r);
    ctx!.fillStyle = isLight ? "#E8E2EC" : "#221C28";
    ctx!.fill();
    ctx!.restore();

    ctx!.save();
    roundedRect(ctx!, x, y, size, size, r);
    ctx!.clip();

    if (cover) {
      // object-fit: cover, so non-square art isn't distorted.
      const ar = cover.width / cover.height;
      let dw = size;
      let dh = size;
      if (ar > 1) dw = size * ar;
      else dh = size / ar;
      ctx!.drawImage(cover, x - (dw - size) / 2, y - (dh - size) / 2, dw, dh);
    } else {
      const g = ctx!.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, rgb(accent));
      g.addColorStop(1, "#C9A6E0");
      ctx!.fillStyle = g;
      ctx!.fillRect(x, y, size, size);
      petal(ctx!, x + size / 2, y + size / 2, size * 0.26, 0, "rgba(255,255,255,0.85)", 0.9);
    }

    // Inner highlight — stops the art reading as a flat pasted rectangle.
    ctx!.strokeStyle = "rgba(255,255,255,0.16)";
    ctx!.lineWidth = 2 * u;
    roundedRect(ctx!, x + 1, y + 1, size - 2, size - 2, r);
    ctx!.stroke();
    ctx!.restore();
  }

  /** Decorative bars, seeded so they look like this song's waveform. */
  function drawWaveform(x: number, y: number, w: number, h: number) {
    const bars = 42;
    const gap = w / bars;
    const barW = gap * 0.42;
    const wave = makeRng(hashString(track.id + "wave"));

    for (let i = 0; i < bars; i++) {
      // Envelope keeps the ends short so it reads as a clip, not noise.
      const envelope = Math.sin((i / bars) * Math.PI);
      const bh = Math.max(4 * u, h * (0.18 + wave() * 0.82) * envelope);
      ctx!.fillStyle = i / bars < 0.42 ? rgb(accent, 0.95) : rgb(accent, 0.28);
      roundedRect(ctx!, x + i * gap, y + (h - bh) / 2, barW, bh, barW / 2);
      ctx!.fill();
    }
  }

  function drawWatermark() {
    const y = H - 96 * u;

    ctx!.save();
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";

    const label = "SAKURA";
    ctx!.font = `700 ${Math.round(28 * u)}px "Inter", system-ui, sans-serif`;
    const labelW = ctx!.measureText(label).width;
    const markSize = 22 * u;
    const totalW = labelW + markSize * 2 + 18 * u;
    const startX = W / 2 - totalW / 2;

    petal(ctx!, startX + markSize, y, markSize, 0.3, rgb(accent), 0.95);

    ctx!.fillStyle = inkFaint;
    ctx!.textAlign = "left";
    ctx!.letterSpacing = `${3 * u}px`;
    ctx!.fillText(label, startX + markSize * 2 + 18 * u, y + 1);
    ctx!.restore();
  }

  /**
   * Shorten to fit, with an ellipsis.
   *
   * Measures against whatever font is currently set on the context — every
   * caller assigns `ctx.font` immediately before calling, so passing the size
   * in would just be a second, ignorable source of truth.
   */
  function truncate(text: string, maxWidth: number): string {
    if (ctx!.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx!.measureText(out + "…").width > maxWidth) {
      out = out.slice(0, -1);
    }
    return out.trimEnd() + "…";
  }
}

/** Canvas → PNG blob. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

export { DIMENSIONS, luminance, parseColor };
