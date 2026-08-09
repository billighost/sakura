/**
 * The Sakura blossom, drawn on a canvas.
 *
 * Share cards and exported video frames both need the brand mark baked into
 * the pixels. That ruled out the SVG component (canvas can't render a React
 * tree) and it ruled out the emoji the watermark previously used: 🌸 renders
 * as a different picture on every OS, so an exported card looked like a
 * different product depending on which phone made it — and on a machine
 * missing the emoji font it exported a literal empty box into an image people
 * post publicly.
 *
 * This is the same five-petal geometry as `SakuraIcon`, expressed as canvas
 * paths, so the mark is identical everywhere it appears.
 */

export interface BlossomOptions {
  /** Centre of the mark. */
  x: number;
  y: number;
  /** Radius of the whole blossom, in px. */
  size: number;
  /** Petal fill. */
  color?: string;
  /** Centre dot fill. Pass the card's background for a punched-out look. */
  centerColor?: string;
  /** 0–1. Applied to the whole mark, then restored. */
  opacity?: number;
  /** Rotation of the whole blossom, in degrees. */
  rotate?: number;
}

/**
 * One petal, as a bezier teardrop rising from the centre.
 *
 * Drawn in a unit space (centre at 0,0, petal tip at -1 on the y axis) so the
 * caller's `size` scales it without the control points drifting.
 */
function petalPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 0.02);
  // Left flank, out to the notched tip.
  ctx.bezierCurveTo(-0.62, -0.2, -0.5, -0.86, -0.16, -0.98);
  // The small notch at the petal tip — the detail that makes it read as a
  // cherry blossom rather than a generic flower.
  ctx.quadraticCurveTo(0, -0.86, 0.16, -0.98);
  // Right flank, back to the centre.
  ctx.bezierCurveTo(0.5, -0.86, 0.62, -0.2, 0, 0.02);
  ctx.closePath();
}

export function drawBlossom(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    size,
    color = "#ef6d97",
    centerColor,
    opacity = 1,
    rotate = 0,
  }: BlossomOptions
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.fillStyle = color;

  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * 72 * Math.PI) / 180);
    ctx.scale(size, size);
    petalPath(ctx);
    ctx.restore();
    // Fill outside the scale so the path is in device units and stays crisp.
    ctx.fill();
  }

  if (centerColor) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = centerColor;
    ctx.fill();
  }

  ctx.restore();
}

/**
 * The full lockup: blossom + wordmark, centred on `x`.
 *
 * Returns the total width drawn, so callers can centre or right-align a row
 * that contains it without measuring twice.
 */
export function drawWordmark(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    fontSize = 36,
    color = "rgba(255,255,255,0.55)",
    markColor,
    opacity = 1,
  }: {
    x: number;
    y: number;
    fontSize?: number;
    color?: string;
    markColor?: string;
    opacity?: number;
  }
): number {
  const label = "SAKURA";
  const gap = fontSize * 0.45;
  const markRadius = fontSize * 0.62;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const textWidth = ctx.measureText(label).width;
  const totalWidth = markRadius * 2 + gap + textWidth;
  const startX = x - totalWidth / 2;

  drawBlossom(ctx, {
    x: startX + markRadius,
    y,
    size: markRadius,
    color: markColor || color,
    opacity: 1,
  });

  ctx.fillStyle = color;
  ctx.letterSpacing = `${fontSize * 0.12}px`;
  ctx.fillText(label, startX + markRadius * 2 + gap, y);
  ctx.restore();

  return totalWidth;
}
