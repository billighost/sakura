"""Worker request validation is independent of model/GPU dependencies."""
import hashlib
import hmac
import json
import math
import re
import time
from urllib.parse import urlsplit

MAX_AUDIO_BYTES = 30 * 1024 * 1024


def verify_job(raw: str, signature: str, secret: str, now_ms=None):
    if not secret or len(secret) < 32:
        raise ValueError("The lyric worker is not configured.")
    if not isinstance(raw, str) or len(raw) > 6000 or not isinstance(signature, str):
        raise ValueError("Invalid sync request.")
    expected = hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid sync signature.")
    job = json.loads(raw)
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if not isinstance(job, dict) or job.get("v") != 1:
        raise ValueError("Invalid sync job.")
    expiry = job.get("expiresAt")
    if not isinstance(expiry, (int, float)) or not now < expiry <= now + 300_000:
        raise ValueError("The sync request expired.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", str(job.get("nonce", ""))):
        raise ValueError("Invalid sync job identity.")
    if not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", str(job.get("recordingId", ""))):
        raise ValueError("Invalid recording identity.")
    digest = job.get("audioSha256", "")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Invalid audio checksum.")
    size = job.get("sizeBytes")
    if type(size) is not int or not 0 < size <= MAX_AUDIO_BYTES:
        raise ValueError("The audio size is outside the worker limit.")
    duration = job.get("durationSeconds")
    if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration <= 600:
        raise ValueError("The duration is outside the worker limit.")
    url = urlsplit(str(job.get("audioUrl", "")))
    if url.scheme != "https" or url.hostname != "res.cloudinary.com" or url.port not in (None, 443) or url.username or url.password or url.fragment or url.query:
        raise ValueError("Only the verified media CDN can be analyzed.")
    media_path = rf"/[A-Za-z0-9_-]+/video/upload/v[1-9][0-9]*/sakura/v2/audio/{re.escape(job['recordingId'])}/{digest}\.(?:mp3|mp4|m4a|aac|wav|webm|flac|ogg|opus)"
    if not re.fullmatch(media_path, url.path):
        raise ValueError("The audio URL does not identify the verified file.")
    return job
