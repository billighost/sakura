# Music player interaction research

Official documentation was fetched on 2026-11-07 with direct HTTPS requests. Successful content checks are described below. This research uses documented product behavior; it does not claim hands-on testing of paid accounts or pixel-level screenshots of the competitors. Proposed Sakura decisions are our recommendations, not claims made by those companies.

## Verified patterns worth adopting

| Product/source | Documented behavior observed in the fetched page | Sakura interpretation |
| --- | --- | --- |
| [Spotify Play Queue](https://support.spotify.com/us/article/play-queue/) | Open queue from Now Playing or the persistent play bar; add tracks from the track menu; drag to reorder; remove songs; clear intentionally added queue items. The article describes distinct mobile and desktop interactions. | Queue remains attached to playback, with occurrence-level actions and a visible source label. Touch and desktop layouts adapt while the operation means the same thing. |
| [Spotify Your Library](https://support.spotify.com/us/article/your-library/) | Save/follow songs, albums, playlists and artists; library in the side menu on desktop; Liked Songs is distinct from saving an artist/album. | Define “saved,” “liked,” “following” and “downloaded” separately. A song does not become downloaded merely because a server catalog row exists. |
| [Spotify offline listening](https://support.spotify.com/us/article/listen-offline/) | Explicit download status is shown next to songs/podcasts/playlists; offline behavior plays downloaded material; Wi-Fi is the default download preference, with a mobile-data option. Premium permits music downloads. | Every row gets a trustworthy device-download state; Library → Downloads shows space, active work, cancellation/retry and offline access. Account for connectivity without making streaming wait for a download. |
| [YouTube Music offline downloads](https://support.google.com/youtubemusic/answer/6313535?hl=en) | Choose specific songs, playlists/albums for offline listening; optional Smart Downloads; offline podcast/music behavior is explained separately. | Manual downloads remain explicit. Optional automatic downloads should be opt-in and report why a recording was saved and how much storage it uses. |
| [YouTube Music audio/video mode](https://support.google.com/youtubemusic/answer/6313574?hl=en) | The player labels Song/Video or Audio/Video; Song selects album-version audio; audio mode avoids loading video, useful under connectivity problems; settings allow a data-saving preference. | Make recording/source selection legible. An original, remix, cover and music-video audio are distinct choices; a high fuzzy title score must not silently swap them. Prefer the verified audio asset requested by the user. |
| [Apple Music current user guide](https://support.apple.com/guide/music/welcome/mac) | The current guide explicitly introduces personalized playlists, time-synced lyrics, pinned library items, curated playlists and consistent access to playlists/downloads/favorites across devices. | Give lyrics their own readable focused view. Keep collection organization and playback continuity predictable, and make frequently used saved content easy to reach. |

Some guessed older Google and Apple article IDs redirected to unrelated guides or returned 404; they were not treated as supporting evidence. Current public URLs and successful page content above are the research basis.

## A recognizable interaction model with original art direction

The product should spend its originality on artwork, composition, typography and motion. Navigation and control semantics should be easy to learn:

- **Home:** a clearly playable lead selection, several distinct listening paths, recent picks and a concise taste explanation. A card's Play starts the exact same queue as the collection detail's Play.
- **Search:** keep the query/results/scroll when inspecting a recording. Each result shows artist, duration, version and availability. Main row action plays; contextual controls inspect artist/album or versions.
- **Library:** saved collections, songs and artists. Downloads is a named destination inside Library and a device filter, not a synonym for “catalog.”
- **Now Playing:** one transport, anchored mini player across pages, easy lyrics/queue/share access. Lyrics and queue are reading/management spaces rather than competing controls over the cover.
- **Profile:** listening time, top music and settings. Theme/audio/connection/account controls have stable locations and clear status.

The user should never need to download a song to test playback, open a collection just to start it, or infer why one touch navigated while another played. Original visuals can wrap familiar action contracts.

## Design principles for the three previews

1. Make the directions structurally different: one can read like an illustrated listening journal, another like a disciplined gallery/record sleeve, and another like a expressive cut-paper music studio. Palette swaps alone do not offer three meaningful choices.
2. Both light and dark themes need their own complete surface, text, divider and artwork treatment. Preserve contrast and hierarchy; do not invert arbitrary cover art.
3. Handcrafted art comes from intentional curves, irregular composition, small annotations and considered material treatment. Keep song text and functional controls crisp, consistent and readable.
4. Carry the art into album/artist/mix details, lyric presentation, empty states and sharing cards, while keeping the transport and navigation recognizable.
5. Explore five opening motions without making them mandatory delays: petal assembly, brush-mark reveal, record/flower orbit, paper unfolding, and gentle bloom. Animation never prevents playback or interaction; reduced motion gets an immediate static mark. Prototype transform/opacity paths and profile them on a phone before declaring them smooth.

## Interaction and information architecture contract

```text
Home ── Play a mix ──→ anchored playback ──→ Now Playing
  └── Inspect mix ──→ Mix detail ── Play ──┘
Search ── Play song ──────────────────────┘
  ├── Inspect artist ──→ Artist ──→ Album ──→ Song/versions
  └── Save / Download ──→ Library / Downloads
Library ──→ Liked / Playlists / Albums / Artists / Downloads
Now Playing ──→ Queue / Lyrics / Share
Share ──→ choose format ──→ prepared preview ──→ Share / Save / Copy
Profile ──→ listening history / settings
```

Overlay dismissal returns to the exact underlying screen. Browser/hardware Back dismisses the top visible overlay, then navigates. The player survives route changes and changing light/dark themes. Available cached content is visible before background refresh, with a quiet stale/offline indicator when necessary.

## What a production-quality rebuild needs beyond a preview

The visual prototype proves the hierarchy and connected flows. It does not prove playback speed, source legality/availability, audio match correctness, recommendation quality, PWA offline behavior, share encoding or Japanese intended lyric readings. Release criteria must measure those independently on actual devices and provider responses.

Recommended measurable checks: warm/cold time to audible playback; resolver error rate; correct-version acceptance/rejection; one-device-one-recording download counts; per-mix overlap and artist concentration; cached return navigation latency; share ready/render/cancel outcomes; and exact raw+aggregate listening-time conservation.
