---
title: Sakura lyrics sync
emoji: 🎵
colorFrom: pink
colorTo: blue
sdk: gradio
sdk_version: 6.0.2
python_version: 3.12.12
app_file: app.py
pinned: false
---

This separate audio-analysis worker uses Hugging Face **free ZeroGPU** with
Gradio and PyTorch. It does not acquire songs or own any Telegram authorization.
It transcribes an existing verified CDN file; Sakura then aligns those timed
words to the original lyrics and refuses uncertain line boundaries.

Current hosting rules checked 2026-11-11:

- [ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu) allows up to two
  ZeroGPU Gradio Spaces for a personal account with a verified email older than
  30 days. It needs no payment card or paid plan for those eligible accounts.
- Anonymous callers receive two GPU minutes/day; signed-in free callers receive
  five GPU minutes/day. Queues and cold starts apply. These are not unlimited
  free production resources. The app never requests paid credit extensions.
- [Ordinary Docker/Gradio compute Spaces](https://huggingface.co/docs/hub/spaces-overview)
  now require a paid plan to create. Do not choose ordinary Docker compute.
- Render's free 0.1 CPU/512 MB tier is unsuitable for a reliable fast Whisper
  service; the implementation does not recommend or silently activate it.

Copy this folder to a Gradio Space and select **ZeroGPU** hardware. Configure
`SAKURA_SYNC_SECRET` as a Space secret and the same value in Sakura's server
environment. Configure `SAKURA_LYRICS_SYNC_URL` in Sakura. Never put either
secret in source control or browser code. No worker is deployed by this folder.

The stable API function is `transcribe`. Submit `data: [jobJson, signature]` to
`POST /gradio_api/call/transcribe`; its `event_id` identifies the result stream at
`GET /gradio_api/call/transcribe/{event_id}`. The JSON job is HMAC-SHA256 signed
over its exact UTF-8 bytes. It contains:

```json
{
  "v": 1,
  "expiresAt": 1800000000000,
  "nonce": "a unique random job id",
  "recordingId": "canonical UUID",
  "audioUrl": "https://res.cloudinary.com/.../sakura/v2/audio/.../sha256.mp3",
  "audioSha256": "64 lowercase hex characters",
  "sizeBytes": 9000000,
  "durationSeconds": 210
}
```

Results contain only `recordingId`, `audioSha256`, `durationSeconds`, `engine`,
`words` (`text`, `start`, `end`, `probability`) and elapsed time. They do not
change the source recording, lyrics database, library or offline file.

The worker accepts only the configured verified Cloudinary media architecture,
rejects redirects, limits media to 30 MB/10 minutes, checks full SHA-256 and
duration, and removes its temporary media on success or failure. One job runs at
a time. The signed payload expires in five minutes and a nonce cannot be reused.
It never fetches an arbitrary browser URL or follows preview/source fallbacks.

`small.en` is an English transcription model. Singing, dense accompaniment,
poetic pronunciations and adlibs can still defeat it; Sakura must retain plain
lyrics when its sequence and boundary checks fail. Other languages need a
separately validated multilingual model; no automatic translation is used.

Run isolated validation with `python -m unittest discover -s tests`.
For local CPU experiments set `SAKURA_SYNC_LOCAL_CPU=1`; hosted service uses
ZeroGPU and never falls back to a paid GPU.

Validation performed on 2026-11-11 used existing MP3s in the user's Downloads
folder. Lyrics were fetched through Sakura's actual lyric GET handler with
fixture account authentication and live LRCLIB. No audio was uploaded and no
additional songs were acquired. Private audio, model weights and lyric text
remain in ignored `.local/` and Downloads.

- Native `small.en` on Adele's **Someone Like You** took 238.2 seconds on CPU,
  with another 97 ms for sequence alignment. The result was refused because
  actual sung line boundaries were missing. CPU speed does not measure ZeroGPU
  speed; hosted inference and queue latency have not been measured.
  Recognized word coverage was 87.5%, with 11 uncertain lyric lines.
- Native `small.en` on Ed Sheeran's **Perfect (Acoustic)** took 699.2 seconds
  on CPU under local contention, plus 116 ms for sequence alignment. The full
  260.87-second local file also failed the line-boundary checks. This clearer
  acoustic example does not establish successful synchronization either.
  Recognized word coverage was 81.6%, with 15 uncertain lyric lines.
- [stable-ts 2.19.1 direct alignment](https://github.com/jianfch/stable-ts#alignment)
  was also tested with the same native model and verified lyric source. It took
  116.6 seconds and covered 96.7% of lyric words, but included 11 words with zero
  duration and 16 low-probability words. Ordinary sung words such as “I”, “But”
  and “You” lost their boundaries. Musical interlude symbols were already
  excluded correctly; dropping annotations would not fix those failures.
  Direct alignment was therefore not substituted for the validated contract.
- Browser CTC and Whisper tiny experiments on five local recordings also
  failed the accuracy gates. Their uncertain timings were not accepted and
  the gates were not lowered. Browser model dependencies were removed.
- Automated UI checks use synthetic media and intercepted hosted responses.
  They verify cancellation, late-result suppression, valid synced output,
  song changes, worker quota failures, and zero browser model/audio uploads.
  They establish interaction behavior, not accuracy on a real song.

No live hosted worker has been deployed or benchmarked, and these experiments
do not establish universally accurate or instant synchronization of singing.
The source text remains plain whenever any vocal line lacks trustworthy timing.

`scripts/rebuild-auto-sync-live.ts` verifies the inference file checksum and
full duration against the existing Downloads audio, calls the real lyric GET
handler, and records acceptance or refusal plus unchanged source text. It does
not weaken the gates for benchmarking. `worker/lyrics-sync/audit.py` writes
native inference evidence after local 16 kHz mono PCM has been decoded into
the corresponding ignored `.local/autosync-<file>.f32` file.
