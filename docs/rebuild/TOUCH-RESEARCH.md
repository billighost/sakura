# Listening and touch interaction review

Official sources fetched successfully over HTTPS on 2026-11-07. These are documented patterns, not claims of hands-on competitor testing.

| Source | Finding | Sakura implementation |
| --- | --- | --- |
| [Spotify queue](https://support.spotify.com/us/article/play-queue/) | The queue is accessible from Now Playing, shows upcoming music, and supports intentional additions and order changes. | Current playback appears separately; “Added by you” is a FIFO section ahead of contextual listening. |
| [Apple Music on iPhone](https://support.apple.com/guide/iphone/play-music-iph0138fb328/ios) | Now Playing and its queue/lyrics actions keep listening controls connected. | Fullscreen player and lyrics share the existing transport; opening or dismissing them preserves playback and the underlying page. |
| [W3C menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) | Menu triggers expose expanded state and menu semantics; keyboard activation moves focus into the menu. | Anchored popover with `aria-haspopup`, `aria-expanded`, menu items, arrow navigation, Home/End, Escape and restored trigger focus. |
| [WCAG pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html) | Actions must allow users to avoid accidental activation. | Holds open reversible options; a 9px movement cancels the 460ms hold, scrolling remains available, and a completed hold suppresses the follow-up click. |
| [WCAG dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | Drag operations need a simple pointer alternative. | Queue grip supports pointer capture and cancelled drags; visible arrow buttons and keyboard ArrowUp/ArrowDown perform the same occurrence-level reorder. |

## Interaction decisions

- A song menu opens at its trigger or hold point and stays within the visual viewport. No separate dialog interrupts the page.
- Explicit additions always play before the automatic continuation, including when shuffle is enabled. New additions append to the manual section. Reordering stays within each section, keeping this promise visible.
- The current song is separate from upcoming songs. Clearing the queue removes future manual and automatic songs, preserves the current occurrence and does not replace its audio source.
- Lyrics follow the active line within their own scrolling surface. User scroll pauses following; a visible action resumes it. Choosing lines for sharing is separate from pausing the scroll guide. Tapping a synced line outside selection mode seeks to its timestamp.
- Fullscreen listening uses both viewport dimensions on desktop and mobile, safe-area padding, readable line widths and reduced-motion support.

Swipe-to-delete and automatic navigation on a horizontal swipe were omitted because they would conflict with scrolling and make accidental actions likely. All listening actions have visible controls; touch gestures add shortcuts.

## Verification

`scripts/rebuild-queue.test.ts` tests manual FIFO, shuffle priority, duplicate-occurrence moves, section boundaries, and preservation of the current item during clear. `scripts/rebuild-touch-smoke.mjs` exercises production UI with explicit catalog/audio fixtures and a synthetic account at 320px, 390px and desktop width in both themes. The report and screenshots are stored under ignored `.local/`. These checks verify browser interaction, not real-provider audio availability or physical-device performance.
