# Sakura Bloom: recap research and implementation rationale

Research checked against official pages on 9 November 2026. The latest published Spotify annual experience found was **2025 Wrapped**; 2026 Wrapped was not assumed to exist.

## Verified references

| Official source | Verified feature or statement | Useful Sakura application |
| --- | --- | --- |
| [Spotify 2025 Wrapped experience, 3 December 2025](https://newsroom.spotify.com/2025-12-03/2025-wrapped-user-experience/) | Top Song Quiz, month-by-month Top Artist Sprint, Listening Archive memorable days, playback speed/revisit controls, share cards, and a Wrapped feed at the top of Home. Spotify says stories are based on the user's listening throughout the year. | Build an anticipation/reveal/payoff arc; show distinctive listening days and annual month patterns; keep chapter navigation and reading mode; promote Bloom prominently on Home. |
| [Spotify: how Wrapped is made, 3 December 2025](https://newsroom.spotify.com/2025-12-03/how-your-wrapped-is-made/) | "Wrapped's total minutes reflect your actual listening time, not the length of the content." Track genres come from catalog tagging. Different stories have different eligibility rules. Listening Archive selects significant days; Artist Sprint follows monthly rankings. | Rank Sakura songs by its documented audible-time metric; explain replay counts separately; use dated retained history for time patterns, keep unknown genres explicit, and omit stories without sufficient evidence. |
| [Spotify methodology explanation, 5 December 2025](https://newsroom.spotify.com/2025-12-05/wrapped-methodology-explained/) | "Each data story uses the metric that makes the most sense for that specific narrative." Spotify Top Songs use listens over 30 seconds while Top Artists use weighted streams; its annual cutoff is mid-November. | Clearly distinguish Sakura recorded plays, measured time, and first recorded discovery. Sakura's complete calendar periods should retain their existing boundaries rather than copy Spotify's cutoff or silently redefine a play. |
| [Spotify 2025 campaign design, 3 December 2025](https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/) | A "visual mixtape" combines texture, analog/digital aesthetics, a reduced color palette, and bold images to express a personal collection. | Keep Sakura's illustrated world identity while varying deterministic palette, composition, lighting, motion, and voice for each saved Bloom. A repeated world should have a fresh arrangement. |
| [Apple Music Replay support, published 28 May 2026](https://support.apple.com/en-us/109356) | Monthly top songs/artists/albums and milestones, annual audio/visual highlight reel, shares, prior-year playlists, and a notification when enough listening makes Replay ready. Calculations use listening history, plays, and listening time. | Give monthly Blooms more depth and annual Blooms a fuller retrospective. Make readiness visible, preserve replayable saved stories, and celebrate real milestones without pressuring users to listen more. |
| [YouTube Music Recap support](https://support.google.com/youtubemusic/answer/11418178?hl=en) | Yearly/seasonal personalized playlists and stats; a calendar showing days spent listening to a top artist; a musical passport showing artists' countries. Previous stats/playlists can be saved. History retention and listening thresholds affect eligibility. | Add supported calendar patterns and saved playback. Skip geographic claims until verified artist-country data exists. Explain retained-history coverage when it affects discovery or chronology. |
| [Spotify 2024 Wrapped experience, 4 December 2024](https://newsroom.spotify.com/2024-12-04/wrapped-user-experience-2024/) | Music Evolution groups up to three musical phases, and Top Artist includes Longest Listening Streak. | Use truthful streaks and monthly/half-year patterns as compact narrative chapters. Do not infer mood from titles or genre alone. |

## Data Sakura can use now

- Measured audible milliseconds, separate recorded listening sessions, distinct songs, and active local-calendar days.
- Ranked songs and artists with known catalog metadata, including the number of distinct songs from the leading artist.
- Share of listening devoted to the leading song/artist, revisited songs, and newly recorded songs where retained history supports discovery.
- Known catalog genres, genre coverage, local hour bands, the strongest listening hour, and measured daily chronology.
- A previous calendar period when retained dated listening exists: actual time change and songs/artists shared across periods.
- From daily chronology: peak day, consecutive-day streak, weekend share, active months, peak month, and half-year listening balance. Missing or partial daily coverage should omit claims that require complete coverage.

Sakura should not fabricate global fan percentiles, listener-age comparisons, artist nationalities, emotional states, artist messages, or album-completion rankings. Those require population comparisons, birth/release data, verified geography, licensed content, or reliable album track membership that this recap pipeline does not currently provide.

## Dynamic story approaches

1. Save a versioned experience seed with the snapshot. Derive its palette, layout, motion timing, accent motifs, chapter voice, and duration analogy from that seed. Never reseed when the story is reopened or use the current date during rendering.
2. Preserve old snapshot versions. Fresh presentation applies to newly generated Blooms; archived stories retain the experience they were given.
3. Give different periods different depth. Weekly is a satisfying short story; monthly adds listening habits and significant days; yearly adds a calendar retrospective when the data exists. Avoid padding a sparse period with repeated versions of the same fact.
4. Vary duration comparisons with explicitly defined lengths: illustrative record sides, listening sets, episodes, or intervals. Store the selected comparison and its arithmetic. Do not claim the user watched films or undertook other activities.
5. Pair energetic titles with factual labels and calculation details. "Your encore champion" can introduce measured repeat plays without inventing an achievement or a global ranking.
6. Keep the listener in control: sequential reveals, accessible reduced-motion/reading mode, pause, replay, chapter navigation, and private-by-default sharing.

## Promotion cadence recommendations

These are Sakura design recommendations, **not** claims about another service's reminder schedule.

| Period | Anticipation | Release and follow-up | Additional reminders |
| --- | --- | --- | --- |
| Weekly | The local calendar day before opening | Opening day and the next local day | A closing-window reminder when appropriate |
| Monthly | Several days before, then the day before | Opening day, next day, and later in the first week | A reminder near the end of its opening window |
| Yearly | A longer countdown with more stages | Opening day plus multiple spaced follow-ups | Periodic later reminders while uncompleted and still available |

Calculate stages in the Bloom's saved time zone, not by dividing elapsed milliseconds into fixed 24-hour days. Prefer the more significant annual/monthly event when promotion windows overlap. Distinguish unopened/resumable/completed Blooms; completion should stop repeated "open your new Bloom" urgency. Locked Blooms need a truthful countdown/link to the gallery; an available, nonempty Bloom can link directly to its story. Empty and expired stories should not receive a misleading ready CTA. In-app cards are sufficient for this change; no unsolicited push, email, or third-party messages are needed.

## Audit observations passed to implementation owners

- The original duration comparison always chose 108-minute films for longer listening totals, explaining the repeated film illustration/copy complaint.
- The leading-artist song list was truncated to three before its distinct-song count was displayed; counting must happen before display truncation.
- Music chapters with artwork suppressed their numeric stat in the original renderer, which could hide the discovery/replay data that makes them interesting.
- Snapshot creation, partial-history handling, sequential disclosure, calendar availability, and legacy versions already have contracts that new presentation must preserve.
