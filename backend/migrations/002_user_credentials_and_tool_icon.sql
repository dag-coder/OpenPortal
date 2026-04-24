-- 002_user_credentials_and_tool_icon.sql

-- Per-user credentials per tool (override tool-level creds for a specific user)
CREATE TABLE IF NOT EXISTS user_tool_credentials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id     UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    ciphertext  BYTEA NOT NULL,
    nonce       BYTEA NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tool_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_tool_creds_user_tool
    ON user_tool_credentials(user_id, tool_id);

-- Custom icon URL per tool (used when favicon fetch fails or is overridden)
ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS custom_icon TEXT DEFAULT NULL;
