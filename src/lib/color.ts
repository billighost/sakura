// Extracts a usable "mood" accent color from an image (album art).
// Result is cached per URL since this runs on every track change.

// Bounded so a long listening session can't grow the map without limit —
// a few hundred entries covers any realistic queue, and eviction is
// insertion-ordered (Map preserves it), which approximates LRU well enough
// for what is only a memory guard.
const MAX_CACHE_ENTRIES = 300;

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function remember(url: string, value: string | null) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, value);
}

export async function extractDominantColor(url: string | undefined | null): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;
  if (inflight.has(url)) return inflight.get(url)!;

  const promise = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);

        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent
          const rr = data[i], gg = data[i + 1], bb = data[i + 2];
          const max = Math.max(rr, gg, bb);
          const min = Math.min(rr, gg, bb);
          if (max > 246 && min > 236) continue; // skip near-white
          if (max < 16) continue; // skip near-black
          r += rr; g += gg; b += bb; count++;
        }

        if (count === 0) return resolve(null);
        r = r / count;
        g = g / count;
        b = b / count;

        const [h, s, l] = rgbToHsl(r, g, b);
        // push toward a punchy, legible accent regardless of the source photo
        const boostedS = Math.min(1, s * 1.3 + 0.15);
        const clampedL = Math.min(0.7, Math.max(0.42, l));
        const [nr, ng, nb] = hslToRgb(h, boostedS, clampedL);

        resolve(`rgb(${nr}, ${ng}, ${nb})`);
      } catch {
        // canvas got tainted by a non-CORS image, or something else failed
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = url.startsWith("/") || url.startsWith("data:") 
      ? url 
      : `/api/image-proxy?url=${encodeURIComponent(url)}`;
  });

  inflight.set(url, promise);
  const result = await promise;
  inflight.delete(url);
  remember(url, result);
  return result;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
