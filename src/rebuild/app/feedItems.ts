/** Keep the first card's position and explanation when provider pages overlap. */
export function appendUniqueFeedItems<T extends { track: { id: string } }>(previous: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...previous, ...incoming].filter(item => {
    if (seen.has(item.track.id)) return false;
    seen.add(item.track.id);
    return true;
  });
}
