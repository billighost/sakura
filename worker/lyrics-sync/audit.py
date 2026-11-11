"""Local CPU evidence with real user files; never uploads audio.

Use a private .local virtual environment, decode the bounded local mp3 into
16 kHz float32 PCM, then compare the result using rebuild-auto-sync-live.ts.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

import numpy as np
import torch
import whisper

parser = argparse.ArgumentParser()
parser.add_argument("file", choices=["bad-guy", "blinding-lights", "drivers-license", "rolling-in-the-deep", "someone-like-you", "perfect-acoustic"])
parser.add_argument("--model", default="small.en", choices=["tiny.en", "base.en", "small.en"])
args = parser.parse_args()
original = Path("C:/Users/bb201/Downloads") / (args.file + ".mp3")
if original.stat().st_size > 30 * 1024 * 1024:
    raise ValueError("Audio exceeds the bounded local audit size.")
digest = hashlib.sha256(original.read_bytes()).hexdigest()
prefix = Path(".local") / ("autosync-" + args.file)
audio = np.fromfile(str(prefix) + ".f32", dtype="<f4")
if len(audio) > 600 * 16000:
    raise ValueError("Audio exceeds ten minutes.")
torch.set_num_threads(min(8, os.cpu_count() or 1))
started = time.monotonic()
model = whisper.load_model(args.model, device="cpu", download_root=".local/autosync-native-models")
load_ms = round((time.monotonic() - started) * 1000)
print(json.dumps(dict(phase="model-ready", model=args.model, elapsedMs=load_ms)), flush=True)
started = time.monotonic()
result = model.transcribe(audio, language="en", task="transcribe", word_timestamps=True,
                          condition_on_previous_text=False, fp16=False,
                          hallucination_silence_threshold=2.0, verbose=False)
elapsed = round((time.monotonic() - started) * 1000)
words = [dict(text=word["word"].strip(), start=word["start"], end=word["end"], probability=word.get("probability", 0))
         for segment in result["segments"] for word in segment.get("words", [])]
report = dict(model=args.model, words=words, elapsedMs=elapsed, modelLoadMs=load_ms,
              durationSeconds=len(audio) / 16000, localFileSha256=digest)
Path(str(prefix) + "-native.json").write_text(json.dumps(report), encoding="utf8")
print(json.dumps(dict(file=args.file, model=args.model, elapsedMs=elapsed, words=len(words))), flush=True)
