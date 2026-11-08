# Sakura's living music feed

Research date: **8 November 2026**. This document combines verified public product research with a Sakura product blueprint. The comparison records what the cited products publicly document; the proposed behavior describes Sakura's choices. Implementation and verification evidence belongs in the accompanying implementation report.

The aim is to make finding the next song feel effortless while keeping the listener in control. Home helps someone start listening immediately. Discover helps them find something they would not have searched for. Both grow from the same account's taste evidence, with different emphasis and a continuous feed of playable songs.

## What leading music products do

| Product and verified official source | Publicly documented behavior | Decision for Sakura |
| --- | --- | --- |
| [Spotify Home previews](https://newsroom.spotify.com/2023-03-08/spotify-previews-clips-music-podcasts-audiobooks-home-feed/) | Browsable previews introduce music, with paths to save, share, and explore the full item. | Make each recommendation a clear song with immediate play, save, queue, artist, and feedback actions. Browsing never takes over ongoing playback. |
| [Spotify Discover Weekly](https://newsroom.spotify.com/2025-06-30/discover-weekly-turns-10-celebrating-100-billion-tracks-streamed-and-a-decade-of-personalized-discovery/) | A personalized playlist refreshes every Monday for first listens; the anniversary article describes genre controls. | Give discovery a recognizable purpose and let someone focus it without rebuilding a playlist. Mix unheard recordings with familiar artists and adjacent genres. |
| [Spotify daylist](https://newsroom.spotify.com/2023-09-12/ever-changing-playlist-daylist-music-for-all-day/) | Frequently changing playlists use the niche music and genres a person usually hears at particular times and days. | Use actual local-hour listening patterns as an optional, modest ranking signal. Show the observed pattern in the profile. Avoid inventing a listener's current emotional state. |
| [Spotify Taste Profile, September 2026](https://newsroom.spotify.com/2026-09-23/taste-profile-shape-home-feed/) and [support article](https://support.spotify.com/us/article/your-taste-profile/) | The beta explains Spotify's understanding of a listener and lets them edit it to shape Home. It affects Home rather than Wrapped, and does not promise strict always/never rules. | Expose the evidence Sakura uses, with direct settings and strict song exclusions where Sakura explicitly promises them. The same controls should be reachable from the feed and profile. |
| [Spotify track/playlist taste exclusion](https://support.spotify.com/us/article/exclude-playlists-or-tracks-from-your-taste-profile/) | Excluding an item makes past and future listens have less influence on recommendations and taste summaries. Hiding a song in a playlist is a separate playback action. Exclusions can be reversed. | Keep vocabulary precise: suggesting less, temporarily setting a song aside, blocking recommendations, excluding taste evidence, and deleting data are different operations. Never make a listener guess whether their saved audio was deleted. |
| [Spotify Smart Shuffle](https://support.spotify.com/us/article/shuffle-play/) | Adds identifiable recommendations to playlists and Liked Songs; listeners can switch shuffle behavior. | Use a recognizable blossom/spark action to generate a taste-aware queue. State its source: all music, liked songs, the open collection, or verified downloads. The button is separate from ordinary shuffle. |
| [Apple Music recommendations](https://support.apple.com/guide/iphone/get-personalized-recommendations-iph2b1748696/ios) | Initial genre and artist selections seed recommendations. Listening history can be disabled so habits do not shape recommendations and Replay. | Preserve Sakura's onboarding seeds; provide a useful first session before habits exist. Offer a control for learning from listening and a private session for unrecorded listening. |
| [Apple Music radio](https://support.apple.com/guide/iphone/listen-to-radio-iph0fc7cdac1/ios) | Curated genre stations and custom stations based on an artist, song, or genre create a low-effort listening path. | A song or collection can begin a queue; a listener should need one meaningful choice to get music playing. Keep editorial sections and automated taste ranking legible. |
| [Apple Music Replay](https://support.apple.com/en-us/109356) | Top music uses listening history, play counts, and time spent; monthly and yearly insights and weekly refreshed playlists are provided. | Build profile charts from actual audible milliseconds, play events, dates, and metadata. Keep SakuraBloom's artistic recaps and add a useful everyday journal. |
| [YouTube Music personalization and Samples](https://support.google.com/youtubemusic/answer/6313542?hl=en) | Samples is an endless personalized stream of music video segments, covering new releases and old favorites. Like/dislike, artists, and history affect recommendations; history can be removed, paused, or deleted. | A continuous song feed is a supported discovery pattern. Sakura uses full-song playback on deliberate tap, clear positive/negative feedback, and a direct route to manage recorded data. |
| [Deezer Flow evolution](https://newsroom-deezer.com/2023/07/deezer-takes-flow-to-the-next-level-and-makes-it-the-perfect-musical-companion-for-every-occasion/) | Flow is an endless mix with a choice between more favorites and more discoveries, plus genre/mood entry points. | Preserve the existing familiar-to-unfamiliar slider and give it real ranking influence across Home, Discover, and queues. |
| [Deezer Flow Tuner launch, February 2026](https://newsroom-deezer.com/2026/02/deezer-launches-flow-tuner-personalized-recommendations/) and [controls](https://newsroom-deezer.com/2026/02/introducing-flow-tuner-your-music-your-rules/) | Listeners can see which genres power Flow, activate/deactivate genres, and add genres to broaden discovery. Likes, listening, follows, and genres refine Flow. | Make personalization visible and editable: learned genres in the profile, selected genres in settings, and controls for how broadly the feed wanders. This is more useful than a mysterious recommendation score. |
| [SoundCloud's revamped Home](https://soundcloud.com/playbook-articles/soundcloud-just-got-more-social-new-features-revamped-homepage-for-shared-discovery/) | Home surfaces shared discovery, interactions, rising tracks, and suggested follows. | Give different kinds of discovery a recognizable visual identity. Sakura can grow into community/editorial discovery when it has real evidence; personal listening data is the foundation today. |
| [SoundCloud liked-song filters](https://soundcloud.com/playbook-articles/introducing-mood-genre-filters/) | Genre/mood filters help people rediscover a large liked-song collection. | Smart queues should work inside saved songs and downloads, so discovery includes music someone already owns and has forgotten. Use published genre tags where available. |
| [SoundCloud new-release notifications](https://soundcloud.com/playbook-articles/soundclouds-new-release-notifications-mean-youll-never-miss-the-latest-music-from-the-artists-you-follow/) | Releases from followed artists are surfaced, prioritizing artists the listener engages with most. | A favorite-artist release section should rank familiar artists and use verified release dates. An old song recently indexed is never labeled a new release. |
| [Bandcamp Discover improvements, July 2026](https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/) | Discover can filter artists a person follows, and refine by tag, location, and format. | Treat familiar artists as a discovery source: unheard songs from voices someone knows. Offer genre and recording-version avenues instead of reducing discovery to unfamiliar artists. |
| [Bandcamp Clubs](https://blog.bandcamp.com/2025/09/01/discover-bandcamp-clubs-curated-music-experiences/) | Expert curation and community introduce handpicked music through themed clubs. | Leave room for human curation and scene-specific collections. Automated feed sections should describe their actual selection rule and avoid pretending an editor chose them. |
| [Amazon Music Maestro](https://www.aboutamazon.com/news/entertainment/amazon-music-maestro-ai-playlist-generator) | A beta playlist generator accepts simple prompts and provides a route to listen, save, and share. | Prioritize a fast, understandable queue action. A future prompt composer can build on the same recommendation engine, but the default button should work without a prompt or any configuration. |

This research covers seven verified product families and investigates two additional services. TIDAL's My Mix support and magazine returned access-denied responses. Pandora's guessed Modes URL returned a generic support shell without the article. SoundCloud's legacy help URL and Bandcamp's Discover/Daily pages were blocked or challenged, so their behavior was verified through accessible official newsroom posts instead. Guessed YouTube radio-builder URLs returned 404 and are not evidence. The research script rejects soft error pages and generic Apple guide redirects as well as non-200 responses. No inaccessible page is treated as proof of a current feature.

Run `node scripts/rebuild-personalized-feed-research.mjs` to refresh the report. `PERSONALIZED-FEED-SOURCES.json` retains fetch time, source URL, redirect, title, status, verification result, and short relevant excerpts. Product announcements document the behavior described at publication; availability can still vary by platform, account, and region.

## The Sakura experience

### Home: a place to begin

Lead with the existing **Find my soundtrack** promise, upgraded to generate an ordered personal queue and start its first song. A small explanation reflects the listener's chosen balance and whether Sakura is still learning. Returning visitors can resume their world immediately; new visitors get selected artists/genres plus varied verified catalog choices.

Use a few purposeful sections before the continuous feed:

- **New from your familiar voices:** genuinely recent releases from selected, liked, or regularly heard artists when release-date evidence exists.
- **A little further from home:** unheard recordings with an identifiable genre or artist relationship.
- **Worth coming back to:** liked or strongly enjoyed recordings given breathing room since their last listen.
- **For this part of your day:** songs/genres backed by a listener's observed local-hour history, only when enabled and sufficiently supported.

The feed mixes songs someone knows, unheard songs by familiar artists, and promising unfamiliar artists. A saved song is allowed to be a discovery: people often want to rediscover their own library.

### Discover: room to wander

Make the continuous feed the main experience, with greater exploration than Home while respecting the listener's settings. Simple modes such as **For you**, **Familiar**, and **Unheard** let someone change the immediate session without rewriting permanent preferences. The unfamiliar mode should still be related to stated or observed taste whenever evidence exists.

A song card gives album artwork, readable title/artist credits, exact recording/version, a concise evidence-based reason, and clear play/like/more actions. Reasons can say “An unheard song from an artist you chose,” “More from a genre you selected,” or “A song you've returned to.” Avoid “you need this tonight,” invented mood, personality, acoustic similarity, BPM, or emotional diagnoses.

Continuous loading needs stable cursor order, unique canonical recording IDs, request coalescing, stale-response protection, visible retry states, and a keyboard-operable **Load more** alternative. Loading the next page should preserve focus and scroll position. Background account refresh must not reshuffle what someone is currently reading. A finite eligible catalog ends gracefully instead of repeating songs to fake infinity. New catalog or taste updates can offer a deliberate refresh.

### Artistic direction

Keep Sakura's ink, paper, blossom palette, Fraunces typography, botanical motifs, shaped controls, and calm spacing. Home can feel like a listening garden with branching composition; Discover can feel like an unfolding record journal. Artwork supplies richness while the interface remains clear. Use restrained botanical motion for arrival/loading and immediate still states for reduced motion. Important text and song actions stay legible in both themes and at narrow mobile widths.

Art belongs around the interaction. A person should never need to decode a drawing to understand play, queue, tune, or set aside. Visible labels, accessible names, comfortable touch targets, focus feedback, and predictable song menus are part of the brand quality.

## Taste controls and sensible defaults

The implemented preference contract extends Sakura's current slider rather than resetting users' existing choices. New fields are optional for compatibility and normalize to these defaults:

| Setting | Default | Listener-facing meaning |
| --- | --- | --- |
| `discovery` | `0.35` | Start closer to familiar music, while leaving room for discoveries. |
| `artistVariety` | `0.65` | Spread the listening across artists instead of stacking one voice. |
| `repeatTolerance` | `0.45` | Bring good songs back with enough breathing room. |
| `newReleaseBias` | `0.50` | Give recent, date-verified releases a moderate opportunity. |
| `deepCutBias` | `0.35` | Explore unheard, unliked songs from familiar artists. Lower provider popularity contributes only a small secondary signal. |
| `timeAware` | `true` | Gently use observed local-hour listening patterns. |
| `learnFromListening` | `true` | Use retained listening evidence in taste ranking. |

Genre and artist seeds remain editable. Explicit-song filtering remains a strict eligibility rule. Existing settings, account sync, downloads, and saved collections must survive the upgrade. Each setting needs a plain description and a restore-defaults action. A slider expresses a ranking preference rather than a guarantee that exactly 35% of a small queue is unfamiliar.

Direct song feedback should offer **more like this**, **less like this**, and **set aside** for one day, one week, one month, or indefinitely. An active exclusion can be undone from the profile/settings. Time-limited feedback must expire consistently for ranking, feed eligibility, and generated queues. Direct song playback and ownership of saved audio remain separate from an automatic recommendation exclusion.

## What to learn from listening

The foundational unit is the account's actual audible playback event, with idempotent increments. Capture the recording ID, event/sequence, audible milliseconds, current media position, occurrence time, source context, and terminal outcome. Retain actual stop/skip positions and explicit completion flags rather than guessing from a fetch, stream URL, or UI play click. Seeking forward does not count the skipped audio as heard. Buffering, resolver failures, mute, pause, and restored sessions do not automatically become negative taste evidence.

Derived features can remain a transparent rule-based model initially:

- Per-recording audible time, plays, completed events, skips, recency, and replay strength.
- Artist and genre affinity from the primary credited artist and published tags.
- Local-hour genre patterns from occurrence timestamps in the account's configured timezone.
- Familiar recordings, familiar artists, and unheard recordings as distinct concepts.
- Positive feedback and liked songs as stronger deliberate signals than casual exposure.
- Skip rate with sample size awareness, plus decay so an old preference does not permanently dominate.
- Diversity and repeat penalties applied to the ordered queue, with current/manual queue choices respected.

Statistics and ranking should say what is actually known. A terminal “completed” event means playback reached the end; replaying or seeking means audible time can differ from recording duration. A single partial listen does not prove dislike. Untagged music stays untagged. Metadata-based genre adjacency does not prove acoustic similarity. Per-genre listening time should disclose how multi-tag songs are attributed so the chart does not silently multiply minutes.

The ranking pipeline first enforces account visibility, canonical recording identity, explicit filters, active feedback, and source restrictions. It then scores eligible candidates using deliberate preferences and enabled listening evidence, diversifies artists, and orders a useful queue. Explanations derive from the same evidence as the score. New listener experience falls back to artist/genre seeds and varied catalog coverage with an honest “still learning” state.

## Profile as a living listening journal

Show a useful everyday picture beside SakuraBloom: total audible time, listening moments, distinct songs, recorded active days, top artists, top genres, completion/skip observations, and listening rhythm. A weekly/daily time plot and an hour-by-genre chart make habits understandable. Accessible summaries and real empty states accompany charts.

State the time window and timezone. Label sparse evidence instead of drawing confident patterns from one song. Keep chosen genres separate from observed genres and make the routes to edit both clear. People should be able to inspect the active songs they set aside and restore them.

The journal describes data retained in this Sakura installation. It does not claim lifelong knowledge, outside-app listening, global artist rankings, physical activity, sleep, work, age, personality, or location. Artistic captions can be warm without asserting unmeasured facts.

## Smart queues everywhere

One shared queue engine powers Find my soundtrack, the queue dialog's blossom action, liked songs, an open collection, and device downloads. It returns canonical unique recordings in a deliberate order. Use ranking and genre continuity to connect songs, with artist variety and repetition controls. BPM/key matching or acoustic energy sequencing requires actual verified analysis and is a future extension, not a label to invent today.

On Home, generate and play the first song. In the queue dialog, the clear label says whether it fills the next songs or starts a new soundtrack; manual choices should have predictable priority. In liked songs and collections, use only the selected source. In downloads, resolve only verified ready local blobs. Offline generation can rank those local songs from cached taste/settings; it must never fetch remote audio or expand into the online catalog. Empty or fully excluded sources explain why no queue can be made.

Use busy feedback, prevent double clicks from making overlapping generations, preserve account isolation, and surface recoverable failures. Generation should never silently discard manual queue entries or stop current playback before a successful result exists.

## Data belongs to the listener

Private listening records no new history. Learning from listening can be paused while preserving the journal and deliberate preferences. Song suppression controls automatic recommendations; taste exclusion controls the contribution of listening evidence; clearing data removes the selected stored information. Their confirmation copy must describe the actual implementation's effect.

Offer scoped history/feedback clearing and an all-personalization reset, with a confirmation dialog that states the chosen scope and time window. Explain what will be rebuilt from future listening and what deliberate preferences remain. Clear server records, derived summaries, cached feed/profile snapshots, pending local delivery, and any stored recap snapshots in the selected scope. Keep deletion atomic and account-scoped. Prevent old offline retries or another device's pending events from resurrecting erased history through deletion cutoffs/epochs or equivalent receipt guards.

Data export is a useful extension because a listener should be able to inspect their own records in a portable format. Additional controls that need a future model or schema should be described as follow-up work, never presented as already collected facts.

## How to judge success

Quality is successful listening and useful discovery. Evaluate a generated queue for unique exact recordings, artist spread, source restriction, honoring explicit exclusions, explainable ranking, and graceful sparse-catalog behavior. Evaluate listening records for pause/seek correctness, audible-only accounting, idempotent delivery, private sessions, and deletion that survives retries.

For product assessment, use retained evidence such as completed unfamiliar listens, repeat listening after a discovery, deliberate saves, exclusion undo behavior, and whether listeners start a satisfying queue quickly. Session length or feed scrolling alone cannot establish enjoyment. Avoid building an engagement target that pressures someone to keep scrolling when they came to hear a song.

Future extensions with an evidence requirement include human-curated seasonal shelves, artist-follow release notifications, optional session intent, a queue prompt composer, explainable verified audio analysis, and controlled comparison of ranking variants. These should grow from Sakura's account ownership and exact-recording guarantees.
