CREATE TABLE IF NOT EXISTS ame_conversations (
  conversation_id VARCHAR(128) PRIMARY KEY,
  principal_id VARCHAR(256) NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ame_conversations_messages_array CHECK (jsonb_typeof(messages) = 'array')
);

CREATE INDEX IF NOT EXISTS ame_conversations_principal_updated_idx
  ON ame_conversations (principal_id, updated_at DESC);
