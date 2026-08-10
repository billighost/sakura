"use client";

/**
 * Finds the element that actually scrolls the current page.
 *
 * The app shell owns a scroll container (`data-app-scroll`), but seven pages
 * historically declared their own — `height: 100%; overflow-y: auto` on the
 * page root — which nests a second scroller inside the first. On those pages
 * the shell's container never moves at all, so anything reading its
 * `scrollTop` silently gets 0 forever: scroll restoration restores nothing,
 * the collapsing header never collapses, and tapping the active tab scrolls
 * the wrong element. (That last one is the same class of bug as the tab bar's
 * old `window.scrollTo`, which targeted a third element that has never
 * scrolled either.)
 *
 * Rather than assume, resolve at the point of use. This stays correct both now
 * and after the page redesigns remove the nested scrollers — at which point
 * the lookup simply falls through to the shell container.
 */

/** Pages may mark their scroller explicitly; that always wins. */
const EXPLICIT = "[data-page-scroll]";
const SHELL = "[data-app-scroll]";

/**
 * Bounds on the fallback search. A page's scroll container is structural, so it
 * sits within the first few wrappers; these caps keep the walk from touching a
 * long list's worth of rows when a page has no scroller to find.
 */
const MAX_DEPTH = 4;
const MAX_BREADTH = 24;

function scrolls(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY;
  return overflow === "auto" || overflow === "scroll";
}

export function resolveScroller(shell?: HTMLElement | null): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const root = shell ?? document.querySelector<HTMLElement>(SHELL);
  if (!root) return null;

  const explicit = root.querySelector<HTMLElement>(EXPLICIT);
  if (explicit) return explicit;

  /*
   * Otherwise search the top of the page's subtree for a scroller. Depth-capped
   * breadth-first, because the two shapes in this codebase put it at different
   * depths: Settings scrolls its page root (depth 1), Library holds the header
   * still and scrolls a `.content` sibling below it (depth 2). Breadth-first so
   * the outermost scroller wins over a nested one.
   *
   * Vertical overflow is read from computed style rather than measured with
   * scrollHeight: at mount the page usually has no content yet, so a height
   * comparison would report "doesn't scroll" and bind to the wrong element for
   * the rest of the page's life. Reading overflow-y also skips horizontal
   * rails, which scroll on x with y hidden.
   */
  let level: HTMLElement[] = [root];
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
    const next: HTMLElement[] = [];
    for (const el of level) {
      for (const child of el.children) {
        const node = child as HTMLElement;
        if (scrolls(node)) return node;
        next.push(node);
      }
    }
    level = next.slice(0, MAX_BREADTH);
  }

  return root;
}
