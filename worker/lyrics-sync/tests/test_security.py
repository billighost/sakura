import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from security import verify_job


class JobSecurityTest(unittest.TestCase):
    secret = "fixture-only-" + "x" * 40
    now = 1_800_000_000_000

    def job(self, **changes):
        digest = "a" * 64
        value = dict(v=1, expiresAt=self.now + 120000, nonce="fixture_nonce_123456",
                     recordingId="00000000-0000-4000-8000-000000000001",
                     audioUrl=f"https://res.cloudinary.com/fixture/video/upload/v1/sakura/v2/audio/00000000-0000-4000-8000-000000000001/{digest}.mp3",
                     audioSha256=digest, sizeBytes=5000000, durationSeconds=200)
        value.update(changes)
        raw = json.dumps(value, separators=(",", ":"))
        signature = hmac.new(self.secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
        return raw, signature

    def test_valid_exact_signed_job(self):
        raw, sig = self.job()
        self.assertEqual(verify_job(raw, sig, self.secret, self.now)["sizeBytes"], 5000000)

    def test_reject_changed_job_and_bad_signature(self):
        raw, sig = self.job()
        with self.assertRaises(ValueError):
            verify_job(raw.replace("5000000", "6000000"), sig, self.secret, self.now)
        with self.assertRaises(ValueError):
            verify_job(raw, "a" * 64, self.secret, self.now)

    def test_reject_ssrf_previews_limits_and_expiry(self):
        for change in [dict(audioUrl="http://127.0.0.1/audio.mp3"),
                       dict(audioUrl="https://res.cloudinary.com/fixture/preview.mp3"),
                       dict(audioUrl="https://res.cloudinary.com@localhost/audio.mp3"),
                       dict(sizeBytes=40 * 1024 * 1024), dict(durationSeconds=601),
                       dict(expiresAt=self.now - 1), dict(expiresAt=self.now + 3600000)]:
            raw, sig = self.job(**change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                verify_job(raw, sig, self.secret, self.now)

    def test_reject_trailing_paths_and_changed_checksum(self):
        original = json.loads(self.job()[0])["audioUrl"]
        for url in [original + "/other.mp3", original + ".wav", original.replace("a" * 64, "b" * 64), original.replace("/video/upload/v1", "/preview")]:
            raw, sig = self.job(audioUrl=url)
            with self.subTest(url=url), self.assertRaises(ValueError):
                verify_job(raw, sig, self.secret, self.now)


if __name__ == "__main__":
    unittest.main()
