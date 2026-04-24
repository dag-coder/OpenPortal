-- 001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Roles (RBAC)
CREATE TABLE IF NOT EXISTS roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#6366f1',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role_id         UUID REFERENCES roles(id) ON DELETE SET NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret      TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tools
CREATE TABLE IF NOT EXISTS tools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'General',
    auth_type   TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none','basic','token','oauth','saml')),
    is_private  BOOLEAN NOT NULL DEFAULT FALSE,
    use_wg      BOOLEAN NOT NULL DEFAULT FALSE,
    status      TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online','degraded','offline')),
    icon_letter TEXT GENERATED ALWAYS AS (UPPER(LEFT(name, 1))) STORED,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Encrypted credentials per tool
CREATE TABLE IF NOT EXISTS tool_credentials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id     UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,   -- e.g. "username", "password", "token"
    ciphertext  BYTEA NOT NULL,  -- AES-256-GCM encrypted value
    nonce       BYTEA NOT NULL,  -- GCM nonce
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tool_id, key)
);

-- Role → Tool access grants
CREATE TABLE IF NOT EXISTS role_tool_grants (
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tool_id     UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, tool_id)
);

-- WireGuard peers
CREATE TABLE IF NOT EXISTS wg_peers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    internal_ip     TEXT NOT NULL UNIQUE,
    public_key      TEXT NOT NULL UNIQUE,
    last_handshake  TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','idle','disconnected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    resource    TEXT,
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_role_tool_grants_role ON role_tool_grants(role_id);
CREATE INDEX IF NOT EXISTS idx_role_tool_grants_tool ON role_tool_grants(tool_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
