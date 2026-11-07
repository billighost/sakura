-- Product tables for the fresh production rebuild. Executed by reviewed CLI only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sakura_v2;
CREATE TABLE IF NOT EXISTS sakura_v2."SchemaVersion" (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sakura_v2."AccountPreferences" (
  account_id uuid PRIMARY KEY REFERENCES public."User"(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  seed_artists jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(seed_artists) = 'array'),
  seed_genres text[] NOT NULL DEFAULT '{}',
  onboarded boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sakura_v2."Artist" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL, external_id text NOT NULL,
  name text NOT NULL, image_url text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,external_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."Album" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL, external_id text NOT NULL,
  title text NOT NULL, artist_id uuid REFERENCES sakura_v2."Artist"(id) ON DELETE SET NULL,
  cover_url text, release_date text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,external_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."RecordingArtist" (
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES sakura_v2."Artist"(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0, PRIMARY KEY(recording_id,artist_id)
);
CREATE INDEX IF NOT EXISTS v2_recording_artist_by_artist ON sakura_v2."RecordingArtist"(artist_id,position);
CREATE TABLE IF NOT EXISTS sakura_v2."RecordingAlbum" (
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE CASCADE,
  album_id uuid NOT NULL REFERENCES sakura_v2."Album"(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0, PRIMARY KEY(recording_id,album_id)
);
CREATE INDEX IF NOT EXISTS v2_recording_album_by_album ON sakura_v2."RecordingAlbum"(album_id,position);
CREATE TABLE IF NOT EXISTS sakura_v2."Favorite" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,recording_id)
);
CREATE INDEX IF NOT EXISTS v2_favorite_order ON sakura_v2."Favorite"(account_id,created_at DESC,recording_id DESC);
CREATE TABLE IF NOT EXISTS sakura_v2."Playlist" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  cover_url text, revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,account_id)
);
CREATE INDEX IF NOT EXISTS v2_playlist_owner_order ON sakura_v2."Playlist"(account_id,updated_at DESC,id);
CREATE TABLE IF NOT EXISTS sakura_v2."PlaylistRecording" (
  playlist_id uuid NOT NULL REFERENCES sakura_v2."Playlist"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK(position >= 0), added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(playlist_id,recording_id), UNIQUE(playlist_id,position) DEFERRABLE INITIALLY DEFERRED
);
-- Event UUIDs survive raw retention in the ledger. A retried old event cannot
-- increase lifetime totals after its display row has been compacted.
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningEventLedger" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  event_id uuid NOT NULL, recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  audible_ms bigint NOT NULL DEFAULT 0 CHECK(audible_ms >= 0 AND audible_ms <= 21600000),
  completed boolean NOT NULL DEFAULT false, skipped boolean NOT NULL DEFAULT false,
  finished boolean NOT NULL DEFAULT false, started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,event_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningEvent" (
  account_id uuid NOT NULL, event_id uuid NOT NULL,
  context text NOT NULL DEFAULT 'direct', context_id text,
  PRIMARY KEY(account_id,event_id),
  FOREIGN KEY(account_id,event_id) REFERENCES sakura_v2."ListeningEventLedger"(account_id,event_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningChunk" (
  account_id uuid NOT NULL, event_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence >= 0),
  audible_ms bigint NOT NULL CHECK(audible_ms >= 0 AND audible_ms <= 120000),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,event_id,sequence),
  FOREIGN KEY(account_id,event_id) REFERENCES sakura_v2."ListeningEventLedger"(account_id,event_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS v2_listening_recent ON sakura_v2."ListeningEventLedger"(account_id,started_at DESC,event_id DESC);
-- Additive timestamps retain the existing retry ledger and listening totals.
ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
CREATE INDEX IF NOT EXISTS v2_listening_period ON sakura_v2."ListeningChunk"(account_id,(COALESCE(occurred_at,created_at)));
CREATE TABLE IF NOT EXISTS sakura_v2."BloomRecap" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recap_id text NOT NULL CHECK(recap_id ~ '^(weekly|monthly|yearly)-[0-9-]+$'),
  time_zone text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  revealed_chapters text[] NOT NULL DEFAULT '{}', completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,recap_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningRecordingSummary" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  audible_ms bigint NOT NULL DEFAULT 0 CHECK(audible_ms >= 0),
  play_count bigint NOT NULL DEFAULT 0, completed_count bigint NOT NULL DEFAULT 0,
  skipped_count bigint NOT NULL DEFAULT 0, last_played_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,recording_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."TasteFeedback" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  target text NOT NULL CHECK(target IN ('recording','artist')),
  target_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('love','less','block','snooze')),
  expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,target,target_id)
);
CREATE TABLE IF NOT EXISTS sakura_v2."Mix" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  slot text NOT NULL, kind text NOT NULL CHECK(kind IN ('daily','discover','deep-cuts','repeat')),
  name text NOT NULL, description text NOT NULL,
  status text NOT NULL CHECK(status IN ('ready','insufficient-candidates')),
  reason text, eligible_count integer NOT NULL DEFAULT 0, unique_artists integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  UNIQUE(account_id,slot)
);
CREATE TABLE IF NOT EXISTS sakura_v2."MixRecording" (
  mix_id uuid NOT NULL REFERENCES sakura_v2."Mix"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK(position >= 0),
  PRIMARY KEY(mix_id,recording_id), UNIQUE(mix_id,position)
);
CREATE TABLE IF NOT EXISTS sakura_v2."Share" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE CHECK(slug ~ '^[A-Za-z0-9_-]{8,64}$'),
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind IN ('track','lyric')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS sakura_v2."AudioResolveJob" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','resolving','ready','review','failed')),
  result jsonb, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_active_audio_resolve ON sakura_v2."AudioResolveJob"(account_id,recording_id)
  WHERE state IN ('queued','resolving');
CREATE UNIQUE INDEX IF NOT EXISTS v2_telegram_audio_source ON sakura_v2."AudioAsset"(recording_id,
  (locator->>'kind'),(locator->>'chatScope'),(locator->>'messageId'))
  WHERE locator->>'kind' = 'telegram-worker';
INSERT INTO sakura_v2."SchemaVersion"(version) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
