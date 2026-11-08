# Multilingual download acceptance

The fixed thirty-song audit selected **30/30 recordings through Sakura's actual search API** and passed **30/30 tiny audio starts** on 2026-11-08. It received **122,880 audio bytes (120 KiB)**. The continuation reused 29 completed results and transferred only the remaining Mandarin recording's 4,096-byte range. The separate four-track Tomonari Sora regression passed **4/4 starts**, receiving **16,384 bytes (16 KiB)**.

These checks verify exact catalogue selection, source metadata acceptance and a correctly bounded opening audio response. **They do not certify complete files, audible song identity or a finished offline download.**

## Fixed sample and results

The manifest seed is `sakura-nonenglish-2026-11-08`. Its thirty unchanged targets cover thirteen language labels, twenty-five genre labels and sixteen recordings marked lesser-known. These are coverage labels supplied by the fixture, rather than results of detecting the audio language or judging an artist's popularity. Multilingual songs may contain additional languages.

Every `Started` row received exactly 4,096 bytes. Provider references identify the actual catalogue row selected from search. An asterisk marks a fixture's lesser-known target.

| Language | Recording / artist | Genre | Selected provider reference | Result |
| --- | --- | --- | --- | --- |
| Japanese | Yume Utsutsu / Lamp * | dream pop | Deezer `499360512` | Started |
| Japanese | 雨降る夜の向こう / Lamp * | indie jazz pop | Spotify `24kobKjeJdJPXnqaf5hB93` | Started |
| Japanese | odoriko / Vaundy | alternative pop | Deezer `2450388445` | Started |
| Japanese | 夜に駆ける / YOASOBI | electronic pop | Deezer `824731152` | Started |
| Korean | Through the Night / IU | ballad | Spotify `3P3UA61WRQqwCXaoFOTENd` | Started |
| Korean | Wi Ing Wi Ing / HYUKOH * | indie rock | Deezer `625401062` | Started |
| Korean | Love poem / IU | ballad | Deezer `1301761132` | Started |
| Mandarin | 晴天 / Jay Chou | Mandopop | Spotify `5pIcwtJYNJx93l420oR2Vm` | Started |
| Mandarin | 紅豆 / Faye Wong | ballad | Spotify `5l94Up12BJSjhH7Mhr2ji4` | Started |
| Mandarin | 旅行的意義 / Cheer Chen * | indie folk | Spotify `0kcYzEvagMWsp9wL6RxW90` | Started |
| Cantonese | 囍帖街 / 謝安琪 * | Cantopop | Deezer `3055034` | Started |
| Spanish | Hasta la Raíz / Natalia Lafourcade | folk pop | Deezer `112662876` | Started |
| Spanish | Movimiento / Jorge Drexler * | singer songwriter | Deezer `404397802` | Started |
| Spanish | To My Love / Bomba Estéreo * | electro cumbia | Deezer `100115964` | Started |
| French | On brûlera / Pomme * | indie folk | Deezer `412534502` | Started |
| French | Je veux / Zaz | gypsy jazz pop | Deezer `17199784` | Started |
| French | Sur la planche / La Femme * | psychedelic rock | Deezer `2564215762` | Started |
| Portuguese | Ainda Bem / Marisa Monte | MPB | Deezer `950812822` | Started |
| Portuguese | Chega De Saudade / João Gilberto | bossa nova | Deezer `716533552` | Started |
| Portuguese | Desfado / Ana Moura * | fado | Deezer `62263917` | Started |
| Hindi | Agar Tum Saath Ho / Alka Yagnik | film ballad | Deezer `3180290701` | Started |
| Hindi | Kasoor / Prateek Kuhad * | indie pop | Deezer `997494282` | Started |
| Hindi | Choo Lo / The Local Train * | indie rock | Deezer `2484339821` | Started |
| Arabic | Ah W Noss / Nancy Ajram | Arabic pop | Deezer `3171731` | Started |
| Arabic | Kifak Inta / Fairuz | Arabic classic | Deezer `97733306` | Started |
| Arabic | Fasateen / Mashrou' Leila * | indie rock | Deezer `635517642` | Started |
| Turkish | Goca Dünya / Altın Gün * | psychedelic folk | Deezer `469248492` | Started |
| Swahili | Suzanna / Sauti Sol * | Afropop | Deezer `866229942` | Started |
| Yoruba | Lonely At The Top / Asake | Afrobeats | Deezer `2324457305` | Started |
| Persian | Toranj / Mohsen Namjoo * | avant folk | Deezer `1109340242` | Started |

Japanese has four targets. Korean, Mandarin, Spanish, French, Portuguese, Hindi and Arabic each have three. Cantonese, Turkish, Swahili, Yoruba and Persian each have one.

Native search queries included `雨降る夜の向こう Lamp`, `밤편지 IU`, `위잉위잉 HYUKOH`, `晴天 Jay Chou`, `紅豆 王菲`, `旅行的意義 陳綺貞` and `囍帖街 謝安琪`. These queries can legitimately return the providers' English artist names or translated display titles. The first search-only run missed Goca Dünya because the provider spells its artist `Altin Gün`. The fixture now permits that published spelling and prefers its exact Deezer row; the final search and startup succeeded for the same target.

The initially rejected Jay Chou result selected `晴天 / Jay Chou`, 269,746 ms, while the worker returned `Sunny Day / 周杰倫`, 269,000 ms. Exact Spotify and Deezer rows independently share ISRC `TWK970300503`; reciprocal MusicBrainz catalogue artist URLs establish the published native and English artist names. The general server proof layer combines those recording and artist identities, retaining every original version, duration and credit gate. The unchanged target now starts successfully. No guessed translation or song-specific alias was accepted.

## Four Japanese regressions

The original Japanese failures used different official title or artist spellings across providers. Trusted aliases backed by exact catalogue identities and shared ISRCs now let the server recover those spelling differences while retaining duration, edition, variant and credit checks. [Localized recording matching](LOCALIZED-RECORDING-MATCHING.md) explains the proof contract and old-worker compatibility path.

| Requested recording | Selected catalogue display / artist | Provider reference | Result |
| --- | --- | --- | --- |
| 文明開化 (East West) | East West / 友成空 | Deezer `3609044902` | Started; 4,096 bytes |
| 咆哮 (HOKO) | 咆哮 - HOKO / TOMONARI SORA | Spotify `1fPkUiufkRpzdYcBKXUP3s` | Started; 4,096 bytes |
| 睨めっ娘 | 睨めっ娘 / TOMONARI SORA | Spotify `3dPrNa7YVisbRaBBr3xdBj` | Started; 4,096 bytes |
| 鬼ノ宴 | 鬼ノ宴 / TOMONARI SORA | Spotify `096KHkONhQm4MQNH35mU22` | Started; 4,096 bytes |

The four-track ledger's 16 KiB cap is exhausted. Re-running it cannot transfer another range without exceeding its existing ledger. Preserve that evidence.

## Transfer method and data limits

The audit authenticates to the local Sakura server, verifies the account identity and requests `/api/v2/search?kind=tracks&q=...`. Its normal metadata-only `POST /api/v2/recordings/index` hydrates exact credits and canonical references. Indexing may persist verified catalogue entries; there were no personal account, library, preferences or listening-history writes.

Source discovery uses the configured existing remote worker and the local matching/compatibility adapter. It may call the worker's metadata resolve endpoint. It does not enqueue the app's recording-resolution jobs, run audio promotion or test the entire production app download route. Browser transfer, persistence and progressive playback are covered separately by [download browser verification](DOWNLOAD-BROWSER-VERIFICATION.md) and [partial playback verification](PARTIAL-PLAYBACK-VERIFICATION.md).

For each accepted source, the transport requests `Range: bytes=0-4095`. It requires HTTP `206`, the exact `Content-Range`, matching audio MIME type and `Content-Length: 4096`. The reader rejects a full-file response, an oversized body and a truncated body, then cancels immediately when it has received 4 KiB. A persisted ledger reserves the range before starting it and caps this thirty-song audit at 122,880 bytes (120 KiB). Metadata and transport overhead are outside the reported audio-byte count.

Completed startup evidence is reused. All thirty 4 KiB reservations are now consumed, so the preserved ledger cannot authorize another audio transfer. No images or full audio files were fetched for this audit, no second Telegram session was started, and no worker was deployed. `--full` remains disabled under the user's low-data constraint.

To resume with the preserved evidence and ledger:

```powershell
node --import tsx scripts/rebuild-download-acceptance.ts --live --start-only --resume --manifest scripts/fixtures/nonenglish-downloads.json --output .local/nonenglish-review --base http://127.0.0.1:3015 --session-file .local/download-api-session.json
```

The current multilingual review contains startup evidence and no complete songs to listen to. The twenty-six complete files preserved from the earlier famous/version/multilingual audit remain available through [the original listening review](DOWNLOAD-ACCEPTANCE.md), normally at `http://127.0.0.1:3097`. Listen to those existing files at the beginning, middle and end; check the singer, language, guests, mix and arrangement, mark **Correct recording** or **Wrong / uncertain**, and export the notes. Playing the saved review files reads local audio.

Evidence is preserved in [the fixed manifest](../../scripts/fixtures/nonenglish-downloads.json), [the multilingual search report](MULTILINGUAL-SEARCH-ACCEPTANCE.json), [the final multilingual startup report](MULTILINGUAL-STARTUP-ACCEPTANCE.json), [the Tomonari metadata report](TOMONARI-METADATA-ACCEPTANCE.json) and [the Tomonari startup report](TOMONARI-STARTUP-ACCEPTANCE.json). Private authentication, byte ledgers and review pages stay in ignored `.local/` directories.
