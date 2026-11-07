# Sakura audio technology: research and implementation rationale

Research date: 7 November 2026. This document records primary-source research for
Sakura's selectable audio processing and original-versus-processed listening
preview. It separates published evidence, engineering decisions, and subjective
listening preferences. Implementation and test results are tracked separately;
fetching a paper is not evidence that its model was run on the user's song.

## Recommendation

Ship **None, Clarity, Warmth, Punch, Night, and Headphones** as explicit listening
choices using native Web Audio filters, dynamics, and frequency-dependent
crossfeed. Keep None as the default and a real bypass. Give each choice an A/B
preview of the same passage with measured loudness matching and a shared playback
position. The most useful blend of the research is modest tonal processing,
controlled dynamics, mono-compatible crossfeed, and a fair comparison mechanism.

These choices address different listening needs. Clarity can make a dense mix
easier to follow; Warmth can soften bright reproduction; Punch changes the
balance and envelope of beats; Night makes quiet listening easier; Headphones
can soften extreme stereo separation. A well-mastered song on a good playback
system may sound best with None. No published research establishes one of these
settings as the best for every song, headphone, listener, and listening level.

Do not label equalization, ordinary sample-rate conversion, or dynamics as
recovering original lost information. Neural bandwidth extension is a different
technology: it estimates or generates plausible missing high frequencies. The
strongest music-oriented candidates deserve a separate restoration evaluation,
rather than an unimplemented AI setting in the product.

## Primary sources examined

Sources below were fetched directly during this research. Successful HTTP
responses were inspected for relevant content. Repositories are evidence of
their authors' stated implementation and limitations, not independent product
benchmarks. Numbers reported by authors remain their claims.

| Source | What was verified | Implication for Sakura |
| --- | --- | --- |
| [W3C Web Audio API 1.1, 22 September 2026 working draft](https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/) | Native filter, gain, compressor, channel, scheduling and media-source definitions; a media source fetched as CORS-cross-origin must output silence; compressor processing includes a 0.006 s pre-delay. | Use established native nodes; validate media-source delivery before connecting a graph; account for compressor delay when comparing rendered buffers. A draft is not a guarantee that every new API it describes is deployed. |
| [ITU-R BS.1770-4, 2015, accessible official PDF](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-4-201510-S!!PDF-E.pdf) | K-weighted channel energy; 400 ms blocks with 75% overlap; absolute gate at -70 LKFS and relative gate 10 dB below the absolute-gated result; distinction between sample peak and reconstructed true peak. | Use a recognized loudness algorithm for A/B gain decisions. Do not call a sample-peak guard a true-peak limiter. The newer BS.1770-5 URL returned a denial page in this research, so this is explicitly the edition actually inspected. |
| [EBU R 128, November 2023](https://tech.ebu.ch/docs/r/r128.pdf) | Programme loudness normalization, broadcast target -23 LUFS, maximum production true peak -1 dBTP, and the inadequacy of peak normalization for consistent perceived loudness. | Match processed versions by loudness rather than equal peaks. A broadcast programme target does not dictate the user's listening volume or Sakura's preview target. |
| [EBU Tech 3341, November 2023](https://tech.ebu.ch/docs/tech/tech3341.pdf) | Momentary 0.4 s and short-term 3 s windows; integrated gating; 400 ms gates with 75% overlap; incomplete final blocks discarded; minimum verification signals and tolerances. | Support meaningful meter tests and avoid presenting incomplete or silent clips as valid integrated measurements. Passing selected tests is not full EBU meter certification. |
| [Spotify for Artists: loudness normalization](https://support.spotify.com/us/artists/article/loudness-normalization/) | Integrated LUFS-based listening targets, codec-related headroom guidance, distinct loud/normal/quiet settings, and some platform-specific exceptions. | A mature streaming service separates loudness consistency from mastering and playback format. Its -14 LUFS normal target is an example, not a requirement or proof that louder is better. |
| [AIST: international equal-loudness contour research](https://www.aist.go.jp/aist_e/list/latest_research/2003/20031114/20031114.html) | Human auditory frequency sensitivity and the research behind ISO 226 equal-loudness contours. | Listening level affects perceived tonal balance. Without calibrated acoustic level and headphone response, Sakura cannot derive a scientifically individualized correction from a browser volume slider. |
| [Boris Mikhaylov's bs2b implementation header, author-attributed mirror](https://github.com/alexmarsev/libbs2b/blob/master/src/bs2b.h) | Established crossfeed uses frequency-dependent filtering, bounded feed levels, a default cutoff around 700 Hz and global gain against overload; low-frequency delay depends on cutoff. | Low-passed crossfeed is a grounded approach for hard-panned stereo. Sakura's differential crossfeed is an original bounded implementation, not a claim of exact bs2b or measured HRTF reproduction. The SourceForge site itself failed certificate validation and was not used as successfully retrieved evidence. |
| [MDN: Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) | Media elements suit full tracks; decoded buffers suit shorter samples; audio context creation/resume belongs inside a user gesture; parameter automation avoids abrupt changes. | Stream normal listening, bound decoded previews, start from the Preview/Play interaction and ramp gain when switching. |
| [AudioSR paper, 2023 / ICASSP 2024](https://arxiv.org/abs/2309.07314) and [official code](https://github.com/haoheliu/versatile_audio_super_resolution) | Diffusion-based general audio bandwidth extension for music, speech and sound effects, input bandwidth 2–16 kHz to 24 kHz at 48 kHz sample rate. | It is a credible music restoration research baseline; it is generative bandwidth extension, not bit-perfect recovery of an MP3's original master. |
| [AudioSR maintainer's cutoff-pattern caveats](https://github.com/haoheliu/versatile_audio_super_resolution/blob/main/example/how_to_make_audiosr_work.md) | Training used low-pass filtering; unfamiliar MP3 cutoff patterns and spectral holes can cause poor restoration; severe noise/reverb can degrade results. | A low-pass benchmark does not establish improvement on arbitrary downloaded MP3 songs. Automatically forcing every source through the model can worsen music. |
| [AudioSR spectral-distance scaling example, June 2025](https://github.com/haoheliu/versatile_audio_super_resolution/blob/main/example/lsd_calculation_pitfall/README.md) | Log-spectral distance changes with energy scaling even if spectral shape is similar. | Match levels before judging plots and metrics; do not report an apparent metric improvement caused by gain alone as restored quality. |
| [FlashSR paper, January 2025](https://arxiv.org/abs/2501.10807) and [official diffusion-distillation implementation](https://github.com/jakeoneijk/FlashSR_Inference) | One-step versatile audio super-resolution; official inference contains a music example, PyTorch/CUDA setup, VAE/vocoder/student model weights and a current 245,760-sample / 5.12 s input constraint at 48 kHz. | A promising faster music-capable successor to investigate offline. Stereo preservation, chunk joining, device cost and codec-specific listening still require validation. |
| [FLowHigh, ICASSP 2025 official implementation](https://github.com/jjunak-yun/FLowHigh_code) and [author demo/evaluation](https://jjunak-yun.github.io/FLowHigh/) | Single-step flow matching to 48 kHz; authors explicitly trained and evaluated on VCTK speech, using synthesized resampling degradation. | Faster inference research is useful, but its reported speech results cannot establish song quality. Do not transplant its state-of-the-art claim to music. |
| [AERO paper](https://arxiv.org/abs/2211.12232) and [official implementation](https://github.com/slp-rl/aero) | Complex spectral-domain encoder/decoder trained with reconstruction and perceptual/adversarial losses; explicit speech and music settings; music example 11.025 kHz to 44.1 kHz. | A genuine music-capable baseline with a narrower trained degradation setting than arbitrary MP3 restoration. |
| [AEROMamba, LAMIR 2024 official implementation](https://github.com/aeromamba-super-resolution/aeromamba) | GAN/state-space audio super-resolution evaluated with MUSDB18-HQ mixture tracks and piano; authors provide overlap-add inference because naive segment joins cause clicks. | More directly music-related than speech-only models; useful evidence for maintaining transients and continuity when a future restoration worker chunks songs. |
| [NU-Wave 2 official implementation](https://github.com/mindslab-ai/nuwave2) | Various input sampling rates, diffusion inference and VCTK/LJSpeech datasets. | Useful research into variable-rate upsampling; published implementation data are speech, so treat music applicability as unproven here. |
| [RNNoise, Xiph official repository](https://github.com/xiph/rnnoise) | Hybrid DSP/recurrent-neural-network real-time full-band **speech** enhancement; CLI example uses mono 48 kHz PCM. | Appropriate microphone/noisy-speech research. Do not offer it as a general stereo music cleaner: instruments and cymbals can be interpreted as unwanted sound. |
| [DeepFilterNet official repository](https://github.com/Rikorose/DeepFilterNet) | Low-complexity 48 kHz full-band **speech** enhancement; Rust/Python deployment and real-time microphone use. | A strong speech enhancement framework, but its task is not restoring mixed music. Song denoising would need separate music data and listening evidence. |

Some unrelated projects use the name **FlashSR**. The
[HierSpeech++-derived 16-to-48 kHz project](https://github.com/ysharma3501/FlashSR)
claims very fast inference and provides ONNX streaming examples. It is not the
Im/Nam diffusion-distillation paper or its official implementation. Those models,
licenses, and performance claims must not be conflated.

## Synthesis: what actually makes a useful listening choice

### Tone and clarity

Broad, low-gain EQ changes the relative prominence of frequency regions with low
processing cost. Cutting a little low-mid energy can expose vocals in a dense
mix; boosting presence can make articulation more obvious. It cannot recover a
masked stem or infer the exact master. Excess presence can aggravate harshness,
sibilance or an already bright headphone. Broad filters and moderate gains keep
these choices reversible and easy to assess.

Warmth and Clarity deliberately point in different directions. They do not need
to be combined into one supposedly ideal chain. None remains a meaningful
reference and a good choice for already balanced recordings.

### Beat impact and night listening

Compression changes the relationship between louder and quieter portions. Attack
and release determine how much a transient passes and how quickly the gain
recovers. A slower attack can retain the beginning of a drum hit while sustained
energy is reduced; a lower threshold and higher ratio can make dynamic passages
easier to hear at quiet listening levels. Neither is restoration of dynamics
already flattened in a source file. Aggressive compression can pump, alter
groove, or remove expression.

Punch therefore uses gentle compression and moderate bass shaping. Night uses
more sustained dynamic reduction and explicitly describes the tradeoff. A
compressor's make-up gain must not make its A/B side automatically win through
volume. Loudness matching happens after rendering the complete chain.

### Headphone stereo

With headphones, a sound hard-panned to one channel is delivered largely to one
ear. Loudspeakers also reach the opposite ear with frequency, time and level
differences. Low-passed crossfeed borrows a small amount of the opposite channel
to soften this extreme separation. It may be useful for older hard-panned mixes;
modern binaural material may be better left alone.

Sakura's differential matrix uses `c = 0.18`, cutoff `700 Hz` and a short
`0.28 ms` delay. If `H` is the same delayed low-pass operation for both ears:

```text
left'  = left  + c × H(right − left)
right' = right + c × H(left − right)
left' + right' = left + right
```

This preserves the summed mono signal algebraically before the common preamp and
output guard. Identical centered channels do not gain a crossfeed coloration.
Stereo low-frequency separation narrows. It does not recreate a room, Dolby
Atmos, individualized HRTFs, or additional instruments. The preview should use
headphones to judge this mode.

A separate widening mode was considered and omitted from the initial set. Boosting
side energy changes stereo emphasis but can overstate noisy ambience and make
headphone presentation less natural. It adds a less clearly useful choice before
there is listening evidence for it. Differential crossfeed has a focused purpose
and a directly testable mono relationship.

### Generative restoration

Music-capable neural super-resolution is worth pursuing as an **offline rendered
alternative**. AudioSR, FlashSR and AEROMamba provide materially different
architectures and degradation assumptions to compare. Combining all their outputs
does not automatically yield a better result: phase, stereo relationships,
generated transients and frequency consistency can disagree. Select a model or
frequency-selective blend only after evaluating aligned, level-matched outputs.

An honest future research experiment would keep the original lower band, inspect
the input's actual bandwidth/codec artifacts, generate only a candidate upper
band, maintain linked stereo handling and use bounded overlap-add at chunk joins.
It would examine vocals, cymbals, room tails and stereo correlation by listening,
including cases where the result is rejected. More high-frequency energy on a
spectrogram is not by itself better fidelity.

No model weights were downloaded, no model inference was claimed, and no private
song was uploaded as part of this documentation research. Runtime modes below
are implemented DSP choices rather than placeholders bearing AI model names.

## Initial preset design

The values below match the initial definitions in `src/rebuild/audio/presets.ts`.
They are engineering starting points guided by the research and bounded gain,
not empirically certified optimal settings. Frequencies are in Hz, filter gains
and preamp in dB, and compressor times in milliseconds.

| Mode | Tone shaping | Dynamics / stereo | Preamp |
| --- | --- | --- | --- |
| None | No filters. | Bypass; no dynamics or crossfeed. | 0 |
| Clarity | Low shelf 120/-1; bell 320/-1.8/Q 0.7; bell 2600/+2.2/Q 0.6; high shelf 9000/+1.2. | None. | -4.8 |
| Warmth | Low shelf 160/+2.5; bell 400/-0.7/Q 0.65; high shelf 6500/-2. | None. | -4.5 |
| Punch | Low shelf 100/+3.3; bell 300/-1.6/Q 0.8; high shelf 6500/+0.7. | Threshold -14; knee 6; ratio 2:1; attack 25; release 160; make-up +0.8. | -5.5 |
| Night | Low shelf 90/-1; bell 1600/+1/Q 0.7; high shelf 8000/-0.7. | Threshold -27; knee 12; ratio 3.5:1; attack 4; release 220; make-up +3. | -3.5 |
| Headphones | No tonal EQ. | Differential low-passed crossfeed: amount 0.18; cutoff 700; delay 0.28. | -2 |

Enhanced paths reserve headroom before applying boosts. The production graph uses
an emergency monotonic soft saturation above approximately 0.8 amplitude rather
than an advertised true-peak limiter. This alters very large peaks and cannot
replace an oversampled true-peak meter. The output level and subjective loudness
should be assessed separately: changing mode can change perceived balance even
when integrated loudness is equal.

Changing a preset requires gain automation/crossfade. A graph should not be
destroyed and reconstructed abruptly at an arbitrary audio sample. Short ramps
reduce clicks and keep playback position independent of processing selection.

User listening volume belongs after the processing chain. In Chrome's native
media graph, `HTMLMediaElement.volume` changes the samples presented to the media
source, which would also change how strongly Night or Punch compresses them.
`MediaAudioEngine` therefore normalizes the media element to volume 1 once it
attaches, and applies the user's volume through a separate post-DSP master gain.
Before initialization, None retains ordinary media-element volume. Engine tests
measure the input remaining unchanged while output scales and mute produces
silence; this establishes the volume placement rather than full mastering or
true-peak compliance.

## Fair preview requirements

1. Decode one bounded passage once. All variants must use that exact source
   passage and preserve its channel layout and duration. Do not compare the verse
   on one side with the chorus on the other.
2. Render with the same graph used by normal enhanced playback. A separate demo
   algorithm would make the preview misleading.
3. Measure the original and completed variants with K-weighted integrated
   loudness, using 400 ms blocks, 100 ms hops, the -70 gate and the -10 relative
   gate. Mono and stereo energy weights must be handled explicitly.
4. Apply one scalar gain per version to reach a common safe level. If peak
   headroom prevents a version from reaching the requested level, lower the
   comparison level for every version rather than silently allowing the louder
   side to dominate. Silence and clips shorter than the minimum block need
   explicit handling; do not fabricate a finite certified loudness value.
5. Preserve compressor timing. The W3C compressor algorithm has a 6 ms pre-delay.
   The engine measures a compressor impulse at the active sample rate and trims
   that observed delay from rendered comparison variants. Trim the corresponding
   tail as well so their durations remain identical.
6. Use one logical playhead. Switching sides should crossfade at the same
   position without overlapping two full-volume versions. Play/Pause, seek and
   looping should apply coherently to the pair. Avoid a hard cut that itself
   sounds like an improvement.
7. Show original and selected-mode waveforms as two selectable lanes. Describe
   level matching plainly. A waveform is an amplitude view; it does not establish
   fidelity or model intelligence.
8. Start only from the user's interaction. Pause the main song when previewing
   so two players do not compete. Closing, navigating away, replacing the file,
   changing account or failing a decode must stop the preview and dispose of its
   sources and object URLs.
9. Keep a selected local file on the device. For the requested Downloads demo,
   use a local fixture or browser File input rather than putting a copyrighted
   song into committed public assets or uploading it for research.

The preview's None lane may receive only the common comparison gain. This is
level adjustment for the listening test, not tonal or dynamic processing. Normal
playback's None choice remains the bypass reference.

## Browser and delivery constraints

Connecting a media element to `MediaElementAudioSourceNode` re-routes its audio
through the graph. An element that audibly played a cross-origin file directly
can become silent when inspected through Web Audio. W3C explicitly requires this
for CORS-cross-origin fetches. Never infer graph safety merely from a successful
direct `audio.play()` or a public CDN URL.

Enhanced playback needs a CORS-authorized request made in the correct mode before
load, a same-origin byte-verified audio gateway, or a local blob already available
to the browser. Prefer the existing verified same-origin route for enhanced
sources while retaining recording/asset identity, range/cancellation behavior,
and fallback guarantees. A browser cannot reconstruct authorization after a
non-CORS resource was loaded. Failure should have a visible recoverable path,
not silently leave an ostensibly playing song inaudible.

Native nodes avoid model downloads and asynchronous neural inference in the
render loop. Use a small reusable graph and bounded preview buffers. At 48 kHz,
30 seconds of two-channel float PCM is about 11.52 MB per version; retaining six
versions is about 69 MB before the source, temporary render buffers and browser
overhead. Shorter passages and on-demand/cache-bounded rendering matter on
phones. Full-song decoding is not necessary to hear a preset difference.

Close temporary preview contexts and stop buffer sources when finished. Do not
resample to 192 kHz simply to create a high-fidelity label: upsampling changes
the sample grid and cannot restore information already removed by a codec.
Leave the real-time context at a suitable supported device rate. Avoid JavaScript
work, allocations or network operations on an audio worklet's rendering path.

## Verification that matters

The implementation should prove: None bypass identity; finite bounded outputs
under hot, silent and transient signals; distinguishable expected filter
responses; centered and mono behavior of crossfeed; meaningful dynamic reduction
with attack/release behavior; compressor time alignment; and loudness equivalence
of the preview variants within a stated tolerance. Include a level-change test
that would fail if RMS/peak matching were substituted for K weighting.

EBU Tech 3341 provides a concrete minimum meter reference: a stereo in-phase
1 kHz sine with per-channel peak -23 dBFS should measure approximately -23 LUFS,
with its published tolerance. A gated mixture of quiet and loud tones should
exercise both absolute and relative gates. Those checks help establish the
implemented subset; the complete official corpus is needed before asserting
formal standards compliance.

Browser verification needs actual audio data through the graph, not only a
button text assertion. Test desktop and narrow-phone layouts, loading failure,
unsupported file, rapid mode changes, stop/close/unmount behavior, side switching
without playhead resets, persisted choice after reload, account isolation, and
normal/offline playback. Inspect for NaNs, clipped output, duplicate playback,
lost original state and unhandled CORS silence.

A song-specific review should report what was processed, excerpt boundaries,
measured loudness and peak information, and reproducible listening controls.
Objective signal checks establish implementation correctness; the user's own
level-matched listening determines which style they prefer. There is no honest
single metric that certifies a tasteful EQ preset as the best audio technology.
