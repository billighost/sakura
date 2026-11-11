/** Decide intent before taking a gesture away from ordinary scrolling or tapping. */
export function horizontalIntent(dx: number, dy: number): "horizontal" | "vertical" | "pending" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return "pending";
  if (Math.abs(dy) > Math.abs(dx) * 1.1) return "vertical";
  return Math.abs(dx) > Math.abs(dy) * 1.35 ? "horizontal" : "pending";
}

export function songSwipeDirection(dx: number, dy: number, width: number, velocityX = 0): "next" | "previous" | null {
  if (horizontalIntent(dx, dy) !== "horizontal") return null;
  const distance = Math.abs(dx);
  const threshold = Math.max(44, Math.min(100, Math.max(1, width) * .18));
  const deliberateFlick = distance >= 28 && Math.abs(velocityX) >= .6 && Math.sign(velocityX) === Math.sign(dx);
  if (distance < threshold && !deliberateFlick) return null;
  return dx < 0 ? "next" : "previous";
}

export function sheetDismissIntent(dx: number, dy: number, height: number, velocityY = 0): boolean {
  if (dy <= 0 || dy < Math.abs(dx) * 1.35) return false;
  return dy >= Math.max(72, Math.min(140, height * .16)) || (dy >= 40 && velocityY >= .65);
}

export function holdMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 9;
}
