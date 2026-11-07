-- Base v2 schema, installed only by the explicit reviewed migration CLI.
-- No application route invokes this file; the caller owns schema transactions.
-- No destructive commands, legacy table changes, or live data backfill are included.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sakura_v2;

CREATE TABLE IF NOT EXISTS sakura_v2."Recording" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  state text NOT NULL DEFAULT 'review' CHECK (state IN ('verified', 'review', 'archived')),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sakura_v2."ExternalReference" (
  provider text NOT NULL CHECK (provider IN ('deezer', 'spotify', 'musicbrainz', 'isrc', 'telegram', 'legacy')),
  scope text NOT NULL DEFAULT '',
  external_id text NOT NULL CHECK (length(trim(external_id)) > 0),
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (provider, scope, external_id),
  CHECK (provider <> 'telegram' OR length(trim(scope)) > 0),
  CHECK (provider <> 'isrc' OR external_id ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$')
);
CREATE INDEX IF NOT EXISTS v2_external_reference_recording ON sakura_v2."ExternalReference"(recording_id);

CREATE TABLE IF NOT EXISTS sakura_v2."AudioAsset" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_references) = 'array'),
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  audio_kind text NOT NULL CHECK (audio_kind IN ('full', 'preview')),
  state text NOT NULL DEFAULT 'review' CHECK (state IN ('ready', 'review', 'unavailable')),
  mime_type text,
  size_bytes bigint CHECK (size_bytes > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz,
  owner_account_id uuid REFERENCES public."User"(id) ON DELETE RESTRICT,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'ready' OR (audio_kind = 'full' AND verified_at IS NOT NULL AND size_bytes IS NOT NULL AND mime_type IS NOT NULL AND mime_type LIKE 'audio/%'))
);
CREATE INDEX IF NOT EXISTS v2_audio_asset_recording ON sakura_v2."AudioAsset"(recording_id, state);
CREATE INDEX IF NOT EXISTS v2_audio_asset_owner ON sakura_v2."AudioAsset"(owner_account_id);

CREATE TABLE IF NOT EXISTS sakura_v2."UserDownload" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  device_id text NOT NULL CHECK (length(trim(device_id)) > 0),
  recording_id uuid NOT NULL REFERENCES sakura_v2."Recording"(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES sakura_v2."AudioAsset"(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'downloading', 'paused', 'complete', 'failed')),
  operation_id uuid,
  downloaded_bytes bigint NOT NULL DEFAULT 0 CHECK (downloaded_bytes >= 0),
  total_bytes bigint CHECK (total_bytes > 0),
  offline_artifact_id text,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, device_id, recording_id),
  CHECK (total_bytes IS NULL OR downloaded_bytes <= total_bytes),
  CHECK (status <> 'complete' OR (total_bytes IS NOT NULL AND downloaded_bytes = total_bytes AND offline_artifact_id IS NOT NULL AND sha256 IS NOT NULL))
);

-- User-owned lifetime totals have NO catalogue/recording foreign key.
-- Catalogue cleanup cannot erase accumulated listening hours.
CREATE TABLE IF NOT EXISTS sakura_v2."LifetimeListeningSummary" (
  account_id uuid PRIMARY KEY REFERENCES public."User"(id) ON DELETE RESTRICT,
  audible_ms bigint NOT NULL DEFAULT 0 CHECK (audible_ms >= 0),
  play_count bigint NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  completed_count bigint NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  skipped_count bigint NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  imported_until timestamptz,
  source_snapshot_id uuid,
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[a-f0-9]{64}$'),
  reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve metadata for unmapped historical songs without keeping playable rows.
CREATE TABLE IF NOT EXISTS sakura_v2."ArchivedListeningRecording" (
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  legacy_recording_id text NOT NULL,
  metadata_snapshot jsonb NOT NULL CHECK (jsonb_typeof(metadata_snapshot) = 'object'),
  audible_ms bigint NOT NULL CHECK (audible_ms >= 0),
  play_count bigint NOT NULL CHECK (play_count >= 0),
  last_played_at timestamptz,
  source_snapshot_id uuid NOT NULL,
  PRIMARY KEY (account_id, legacy_recording_id, source_snapshot_id)
);

-- Snapshot IDs make replayed imports idempotent and totals reconcilable.
CREATE TABLE IF NOT EXISTS sakura_v2."ListeningImportSnapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  raw_audible_ms bigint NOT NULL CHECK (raw_audible_ms >= 0),
  aggregate_audible_ms bigint NOT NULL CHECK (aggregate_audible_ms >= 0),
  raw_play_count bigint NOT NULL CHECK (raw_play_count >= 0),
  aggregate_play_count bigint NOT NULL CHECK (aggregate_play_count >= 0),
  exported_at timestamptz NOT NULL,
  imported_at timestamptz,
  UNIQUE (account_id, source_sha256)
);
COMMIT;
