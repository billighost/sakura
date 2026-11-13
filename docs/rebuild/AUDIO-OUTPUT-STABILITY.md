# Native playback and output changes

The main player previously created a Web Audio graph on iPhone/iPad even when Audio technology was None, solely to provide software volume. After any enhanced mode had been used, selecting None also left that element permanently captured by its MediaElementAudioSourceNode. None therefore still used the Web Audio output clock.

WebKit issue [258864](https://bugs.webkit.org/show_bug.cgi?id=258864) describes distorted, wrong-speed audio after Bluetooth output changes with this distinction: native HTML audio was unaffected while Web Audio could retain the preceding output sample rate. Its 2024 report also describes distortion when AirPods connect. This primary report matches the symptoms and establishes why playbackRate guards alone do not remove the vulnerable route; it does not establish that every reported Sakura glitch has that cause.

MediaAudioEngine now keeps None native by default on every platform. The main provider replaces a previously captured element when returning to None, closes its old graph, retires old callbacks and play promises, and preserves the exact source and passage position. Native fixed-volume Safari uses the device's listening level; zero still uses HTMLMediaElement.muted. An explicitly requested volume graph remains available for companion crossfades. Once gain owns the volume, mute stays after dynamics and the source remains unmuted.

Playback audio-session claims are idempotent: lifecycle callbacks avoid rewriting an already claimed session. Enhanced playback retains a bounded output-device recovery that coalesces event bursts and suspends/resumes a running graph without changing source, position or rate. It respects deliberate pause/end/disposal and allows a foreground resume to proceed while an earlier background resume is pending. Delayed statechange callbacks share the pending output recovery instead of issuing another resume; an added regression reproduced the duplicate before that guard was applied. This is recovery behavior, not a qualification of physical Bluetooth resampling.

Verification commands:

```text
node --import tsx --test --test-concurrency=1 scripts/rebuild-audio-technology.test.ts scripts/rebuild-audio-technology-preferences.test.ts scripts/rebuild-bloom-audio.test.ts
$env:SAKURA_TEST_URL='http://localhost:3000'
node scripts/rebuild-audio-technology-playback-smoke.mjs
```

The sequential audio technology, preference and Bloom run passed 38 tests, with zero failures and one skipped Windows WebKit case because that runtime exposes no Web Audio. This includes all eight lifecycle/native cases, real-Chromium 44.1/48 kHz pitch and waveform checks, native mute to gain routing, live gain/DSP measurement and background recovery. All eight lifecycle/native tests passed again after the delayed-state callback guard. The actual MusicProvider browser fixture passed all eight cases with zero failures or page errors; its report is `.local/audio-technology/playback-report.json`. This includes native replacement, listener retirement, source and passage continuity, re-enabling enhancement, gain mute, the next native song, stored Night initialization and account isolation.

The audio technology suite includes real-Chromium decoding of generated 44.1/48 kHz media, waveform/pitch measurements before/after synthetic device events, and native-zero-volume to gain routing. The provider browser fixture uses generated stereo PCM and intercepted synthetic profile/settings/catalog/audio responses; it measures native replacement, passage continuity, retired listener removal and graph recreation. These fixtures exercise the software and browser media paths without provider/database writes. Physical iPhone/AirPods route switching cannot be emulated by synthetic devicechange events and remains a device verification boundary.
