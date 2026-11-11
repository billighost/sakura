import hashlib
import os
import tempfile
import threading
import time

import gradio as gr
import requests
import spaces
import whisper

from security import verify_job

ENGINE = "whisper-small-en-v1"
SECRET = os.environ.get("SAKURA_SYNC_SECRET", "")
LOCAL_CPU = os.environ.get("SAKURA_SYNC_LOCAL_CPU") == "1"
# Weight download happens before the Space becomes ready, not inside the
# limited GPU lease. ZeroGPU intercepts CUDA allocation outside the decorator.
_model = whisper.load_model("small.en", device="cpu")
if not LOCAL_CPU:
    _model.to("cuda")
_lock = threading.Lock()
_nonces = {}


@spaces.GPU(duration=60)
def recognize(audio):
    result = _model.transcribe(audio, language="en", task="transcribe", word_timestamps=True,
                               condition_on_previous_text=False, fp16=not LOCAL_CPU,
                               hallucination_silence_threshold=2.0, verbose=False)
    return [dict(text=word["word"].strip(), start=word["start"], end=word["end"],
                 probability=word.get("probability", 0))
            for segment in result["segments"] for word in segment.get("words", [])]


def transcribe(raw, signature):
    job = verify_job(raw, signature, SECRET)
    now = int(time.time() * 1000)
    with _lock:
        for nonce, expiry in list(_nonces.items()):
            if expiry <= now:
                del _nonces[nonce]
        if job["nonce"] in _nonces:
            raise gr.Error("This sync request was already used.")
        _nonces[job["nonce"]] = job["expiresAt"]
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="sakura-lyrics-") as folder:
        path = os.path.join(folder, "audio")
        digest, size = hashlib.sha256(), 0
        with requests.get(job["audioUrl"], stream=True, timeout=(5, 20), allow_redirects=False) as response:
            if response.status_code != 200 or not response.headers.get("Content-Type", "").startswith("audio/"):
                raise gr.Error("The verified full audio is temporarily unavailable.")
            with open(path, "wb") as file:
                for chunk in response.iter_content(64 * 1024):
                    if time.monotonic() - started > 45:
                        raise gr.Error("The verified audio transfer timed out.")
                    size += len(chunk)
                    if size > job["sizeBytes"]:
                        raise gr.Error("The verified audio size changed.")
                    file.write(chunk)
                    digest.update(chunk)
        if size != job["sizeBytes"] or digest.hexdigest() != job["audioSha256"]:
            raise gr.Error("The full audio did not match this recording checksum.")
        audio = whisper.load_audio(path)
        duration = len(audio) / whisper.audio.SAMPLE_RATE
        if duration > 600 or abs(duration - job["durationSeconds"]) > 1:
            raise gr.Error("The decoded audio did not match this recording duration.")
        words = recognize(audio)
    return dict(recordingId=job["recordingId"], audioSha256=job["audioSha256"], durationSeconds=duration,
                engine=ENGINE, words=words, elapsedMs=round((time.monotonic() - started) * 1000))


with gr.Blocks() as demo:
    gr.Markdown("Sakura lyric timing worker. Audio analysis is available through authenticated Sakura requests.")
    raw = gr.Textbox(visible=False)
    signature = gr.Textbox(visible=False)
    result = gr.JSON(visible=False)
    submit = gr.Button("Analyze verified recording", visible=False)
    submit.click(transcribe, [raw, signature], result, api_name="transcribe", concurrency_limit=1)

demo.queue(max_size=8).launch()
