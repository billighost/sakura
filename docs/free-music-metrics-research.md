# Free artist and song audience metrics

Checked on 14 November 2026 using official documentation and read-only public responses.

## Finding

There is no documented free Spotify or Deezer API that supplies both artist monthly listeners and a recording's cumulative stream count. The requested figures cannot currently be added through Sakura's existing catalogue integrations. Fans, followers, popularity, community scrobbles, and monthly listeners measure different things and must keep their own labels.

| Source | Available audience data | Free access | Requested figures? |
| --- | --- | --- | --- |
| Spotify Web API | Artist follower total and artist/track popularity, currently marked deprecated in the reference | Developer credentials; current development mode requires the app owner to have Premium | No monthly listeners or track stream total |
| Deezer public API | Artist `nb_fan`; track `rank` | The checked public endpoints returned data without a key or login | Fans and popularity rank only |
| Last.fm Web API | Lifetime listeners and scrobbles for artists/tracks | API key; free noncommercial use, commercial/research use requires contacting Last.fm | Last.fm community totals, not Spotify/Deezer streams or monthly listeners |
| ListenBrainz API | Lifetime `total_listen_count` and `total_user_count` by exact MusicBrainz artist/recording identity | Public API; no paid data provider required | ListenBrainz community totals, not Spotify/Deezer streams or monthly listeners |

## Spotify

[Get Artist](https://developer.spotify.com/documentation/web-api/reference/get-an-artist) documents `followers.total` and `popularity`; both are marked **Deprecated**. It does not document monthly listeners. [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track) documents the deprecated 0–100 `popularity` score, described as an algorithmic value based partly on total plays and their recency. It does not return the underlying stream count.

Spotify's [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) currently require the app owner to have Premium for development-mode apps to function. Existing configured credentials do not add the missing audience fields.

The public [Alec Benjamin artist page](https://open.spotify.com/artist/5IH6FPUwQTxPSXurCrcIov) returned HTML containing monthly listeners and play totals for five popular songs. These figures are technically extractable, but a sampled individual track page did not expose a comparable play total. Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) explicitly prohibit: **“‘crawling’ or ‘scraping’, whether manually or by automated means, or otherwise using any automated means (including bots, scrapers, and spiders), to view, access or collect information”** (quotation marks normalized). This is not a suitable production data source; no scraper was added.

## Deezer

The following live endpoints returned successful JSON without authentication:

- [Artist 1: The Beatles](https://api.deezer.com/artist/1): contains `nb_fan`, `nb_album`, names and artwork; no monthly listener figure.
- [Artist 884659: Alec Benjamin](https://api.deezer.com/artist/884659): uses the same artist schema. Artist search also returned `nb_fan`.
- [Track 3135556: Harder, Better, Faster, Stronger](https://api.deezer.com/track/3135556): contains `rank`, duration, ISRC, release date and artist/album metadata; no cumulative play count.

Sakura already reads track `rank` into its normalized recommendation popularity score in `src/rebuild/server/catalog.ts`, `src/rebuild/server/providers.ts`, and `src/rebuild/data/catalog.ts`. That score cannot be displayed as a number of plays. Artist `nb_fan` is currently discarded by the catalogue detail DTO; a separately requested “Deezer fans” feature could expose it without a paid provider.

Deezer's developer documentation returned an application shell in this session; the field findings above come from actual JSON.

## Alternatives

[Last.fm artist.getInfo](https://www.last.fm/api/show/artist.getInfo) and [track.getInfo](https://www.last.fm/api/show/track.getInfo) require a developer key and return lifetime listeners/scrobbles. [API terms](https://www.last.fm/api/tos) permit noncommercial use; commercial use requires a separate agreement. Suitable labels are “Last.fm listeners” and “Last.fm scrobbles.” Artist/title matching must handle ambiguous names and alternate recordings.

[ListenBrainz popularity API](https://listenbrainz.readthedocs.io/en/latest/users/api/popularity.html) documents batch queries for `total_listen_count` and `total_user_count` by exact MusicBrainz ID. Suitable labels are “ListenBrainz listens” and “ListenBrainz listeners”; unknown data must remain unknown. The test request timed out, so current live availability was not established. Sakura's MusicBrainz artist alias lookup currently exposes names rather than artist IDs to product views, requiring additional identity work.

## Product decision

Keep the requested monthly-listener and Spotify/Deezer play-count spaces absent until a source supplies those precise metrics with suitable access. Do not fill the artist page, track rows, track page or full player with fans/popularity under those labels. Free, honestly labeled Deezer fan totals or community listen totals are possible alternatives if requested, but they are different features.
