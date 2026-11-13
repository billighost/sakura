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
-- Per-field revisions preserve newer choices even if a device changes a value
-- and then changes it back while another device holds an older offline draft.
ALTER TABLE sakura_v2."AccountPreferences" ADD COLUMN IF NOT EXISTS field_revisions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(field_revisions)='object');
UPDATE sakura_v2."AccountPreferences" p SET field_revisions=(
  SELECT jsonb_object_agg(key,p.revision) FROM (
    SELECT key FROM jsonb_object_keys(p.preferences) key
    UNION SELECT unnest(ARRAY['seedArtists','seedGenres','onboarded'])
  ) fields
) WHERE field_revisions='{}'::jsonb;
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
-- Receipts survive unlikes so retrying an acknowledged offline like cannot
-- restore a song removed by another device after that operation committed.
CREATE TABLE IF NOT EXISTS sakura_v2."FavoriteOperationReceipt" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  liked boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,operation_id)
);
-- Old setters mutate Favorite before writing their receipt. Keep that lock order
-- throughout the additive upgrade so a live old writer can finish safely.
LOCK TABLE sakura_v2."Favorite" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE sakura_v2."FavoriteOperationReceipt" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE sakura_v2."FavoriteOperationReceipt" ADD COLUMN IF NOT EXISTS base_revision bigint CHECK(base_revision>=0);
ALTER TABLE sakura_v2."FavoriteOperationReceipt" ADD COLUMN IF NOT EXISTS conflict boolean NOT NULL DEFAULT false;
-- Unlike choices retain a revision even when the Favorite row is absent.
-- A first delivery of an old offline choice can then compare its own baseline.
CREATE TABLE IF NOT EXISTS sakura_v2."FavoriteChoice" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK(revision>=1), liked boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,recording_id)
);
INSERT INTO sakura_v2."FavoriteChoice"(account_id,recording_id,revision,liked)
 SELECT known.account_id,known.recording_id,1,
   EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=known.account_id AND f.recording_id=known.recording_id)
 FROM (SELECT account_id,recording_id FROM sakura_v2."Favorite"
       UNION SELECT account_id,recording_id FROM sakura_v2."FavoriteOperationReceipt") known
 ON CONFLICT(account_id,recording_id) DO NOTHING;
-- Repair a partial earlier rollout before installing compatibility triggers.
UPDATE sakura_v2."FavoriteChoice" choice SET revision=choice.revision+1,
 liked=EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=choice.account_id AND f.recording_id=choice.recording_id),updated_at=now()
 WHERE choice.liked IS DISTINCT FROM EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=choice.account_id AND f.recording_id=choice.recording_id);
CREATE OR REPLACE FUNCTION sakura_v2.favorite_membership_choice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_account uuid; target_recording uuid; target_liked boolean;
BEGIN
 IF TG_OP='INSERT' THEN target_account:=NEW.account_id;target_recording:=NEW.recording_id;target_liked:=true;
 ELSE target_account:=OLD.account_id;target_recording:=OLD.recording_id;target_liked:=false; END IF;
 -- Account deletion must not recreate a row that is being cascade-deleted.
 IF NOT EXISTS(SELECT 1 FROM public."User" WHERE id=target_account)
    OR NOT EXISTS(SELECT 1 FROM sakura_v2."Recording" WHERE id=target_recording) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('sakura-v2-history:'||target_account::text));
 INSERT INTO sakura_v2."FavoriteChoice" AS choice(account_id,recording_id,revision,liked,updated_at)
 VALUES(target_account,target_recording,1,target_liked,now())
 ON CONFLICT(account_id,recording_id) DO UPDATE SET revision=choice.revision+1,liked=EXCLUDED.liked,updated_at=now();
 RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER favorite_membership_choice AFTER INSERT OR DELETE ON sakura_v2."Favorite"
 FOR EACH ROW EXECUTE FUNCTION sakura_v2.favorite_membership_choice();
CREATE OR REPLACE FUNCTION sakura_v2.favorite_legacy_receipt_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.base_revision IS NOT NULL OR NEW.conflict THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."User" WHERE id=NEW.account_id)
    OR NOT EXISTS(SELECT 1 FROM sakura_v2."Recording" WHERE id=NEW.recording_id) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('sakura-v2-history:'||NEW.account_id::text));
 -- A membership trigger or the new setter already advances choices in this
 -- transaction. Only a legacy no-op needs its receipt to advance the revision.
 INSERT INTO sakura_v2."FavoriteChoice" AS choice(account_id,recording_id,revision,liked,updated_at)
 VALUES(NEW.account_id,NEW.recording_id,1,
   EXISTS(SELECT 1 FROM sakura_v2."Favorite" f WHERE f.account_id=NEW.account_id AND f.recording_id=NEW.recording_id),now())
 ON CONFLICT(account_id,recording_id) DO UPDATE SET revision=choice.revision+1,liked=EXCLUDED.liked,updated_at=now()
 WHERE choice.updated_at IS DISTINCT FROM now();
 RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER favorite_legacy_receipt_choice AFTER INSERT ON sakura_v2."FavoriteOperationReceipt"
 FOR EACH ROW EXECUTE FUNCTION sakura_v2.favorite_legacy_receipt_choice();
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
-- Source-bound import receipts survive playlist deletion: a lost response must
-- never recreate a playlist the listener subsequently removed. No provider URL
-- or credentials are stored; source_key is a validated provider:id pair.
CREATE TABLE IF NOT EXISTS sakura_v2."ImportReceipt" (
  request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 180),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
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
-- Playback positions are evidence of where an event ended, never listening time.
ALTER TABLE sakura_v2."ListeningEventLedger" ADD COLUMN IF NOT EXISTS last_position_ms integer NOT NULL DEFAULT 0 CHECK(last_position_ms BETWEEN 0 AND 21600000);
ALTER TABLE sakura_v2."ListeningEventLedger" ADD COLUMN IF NOT EXISTS max_position_ms integer NOT NULL DEFAULT 0 CHECK(max_position_ms BETWEEN 0 AND 21600000);
ALTER TABLE sakura_v2."ListeningEventLedger" ADD COLUMN IF NOT EXISTS last_sequence integer NOT NULL DEFAULT -1;
-- Playback origin belongs to retained listening evidence, not only the history
-- display row. NULL marks old plays whose original source is no longer known.
ALTER TABLE sakura_v2."ListeningEventLedger" ADD COLUMN IF NOT EXISTS context text CHECK(context IS NULL OR length(trim(context)) BETWEEN 1 AND 40);
ALTER TABLE sakura_v2."ListeningEventLedger" ADD COLUMN IF NOT EXISTS context_id text CHECK(context_id IS NULL OR length(trim(context_id)) BETWEEN 1 AND 120);
UPDATE sakura_v2."ListeningEventLedger" l SET context=e.context,context_id=e.context_id
  FROM sakura_v2."ListeningEvent" e WHERE e.account_id=l.account_id AND e.event_id=l.event_id AND l.context IS NULL;
ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS position_ms integer;
ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS completed boolean;
ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS skipped boolean;
ALTER TABLE sakura_v2."ListeningChunk" ADD COLUMN IF NOT EXISTS finished boolean;
CREATE INDEX IF NOT EXISTS v2_listening_period ON sakura_v2."ListeningChunk"(account_id,(COALESCE(occurred_at,created_at)));
-- These minimal deletion receipts prevent another device replaying erased data.
-- They retain dates and event IDs, but no recording or listening measurements.
CREATE TABLE IF NOT EXISTS sakura_v2."HistoryDeletion" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 period_start timestamptz, cleared_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_history_deletion_owner ON sakura_v2."HistoryDeletion"(account_id,cleared_at DESC);
-- Consent dates reject late device uploads from private or paused listening.
-- Existing retained history is untouched; no music or measurements are stored.
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningPrivacyWindow" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL, ended_at timestamptz,
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_listening_privacy_open ON sakura_v2."ListeningPrivacyWindow"(account_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS v2_listening_privacy_owner ON sakura_v2."ListeningPrivacyWindow"(account_id,started_at);
INSERT INTO sakura_v2."ListeningPrivacyWindow"(account_id,started_at)
  SELECT account_id,updated_at FROM sakura_v2."AccountPreferences"
  WHERE preferences->>'privateSession'='true' OR preferences->>'learnFromListening'='false'
  ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sakura_v2."ClearedListeningEvent" (
 account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 event_id uuid NOT NULL, cleared_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,event_id)
);
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
-- A retained imported aggregate may have no recoverable last-play date after
-- selected sessions are erased. Keep that date unknown rather than inventing it.
ALTER TABLE sakura_v2."ListeningRecordingSummary" ALTER COLUMN last_played_at DROP NOT NULL;
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
CREATE TABLE IF NOT EXISTS sakura_v2."FeedSession" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 surface text NOT NULL CHECK(surface IN ('home','discover')),
 mode text NOT NULL CHECK(mode IN ('balanced','familiar','explore')),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array'),
 cursor_secret text NOT NULL CHECK(cursor_secret ~ '^[a-f0-9]{64}$'),
 settings_signature text NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_feed_session_owner ON sakura_v2."FeedSession"(account_id,expires_at);
ALTER TABLE sakura_v2."FeedSession" ADD COLUMN IF NOT EXISTS personalized boolean NOT NULL DEFAULT false;
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
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningSession" (
 account_id uuid PRIMARY KEY REFERENCES public."User"(id) ON DELETE CASCADE,
 state jsonb NOT NULL,
 device_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
