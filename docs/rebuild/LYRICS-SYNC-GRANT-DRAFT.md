# Free ZeroGPU community grant draft

Status: prepared, not submitted. Actual free ZeroGPU and CPU Gradio creation
both returned HTTP 402 for the authenticated, email-verified account. The user
has no payment card or paid hosting budget. No paid resources were enabled.

Suggested request text:

> I maintain Sakura, a personal hobby music player:
> https://github.com/billighost/sakura.
>
> Could I receive a community grant for one free ZeroGPU Gradio Space to
> investigate English lyric timing? I have no paid hosting budget or payment
> card. My verified account cannot currently create a free compute Space.
>
> Worker source and validation are at
> https://github.com/billighost/sakura/tree/master/worker/lyrics-sync.
> The worker analyzes only an existing full audio file authorized by a signed
> Sakura request. It checks the recording's SHA-256, byte size and duration,
> removes temporary audio, and does not acquire recordings. The phone sends
> metadata and receives timing results; it downloads no AI model.
>
> This is experimental, not a claim of reliable full-song singing recognition.
> Local Whisper and forced-alignment tests exposed uncertain boundaries, which
> are refused without changing the original lyrics. GPU access would let me
> measure performance and evaluate better alignment methods within free quotas.
> I will not enable paid compute or prepaid credit extensions.

The current provider response directs users to request a community grant.
Check [Hugging Face Spaces hardware information](https://huggingface.co/docs/hub/spaces-gpus)
for the current application channel. Do not submit account credentials or
private lyric/audio audit files in the request. Approval is external and cannot
be promised. Grant approval would address hosting access; actual alignment
accuracy still requires independent validation.
