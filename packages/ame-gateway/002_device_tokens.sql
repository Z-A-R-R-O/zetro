CREATE TABLE IF NOT EXISTS ame_device_tokens (
  token_id UUID PRIMARY KEY,
  device_id VARCHAR(160) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  label VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  CONSTRAINT ame_device_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS ame_device_tokens_device_active_idx
  ON ame_device_tokens (device_id, expires_at DESC)
  WHERE revoked_at IS NULL;
