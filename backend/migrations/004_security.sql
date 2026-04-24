-- 004_security.sql

-- Forensic audit log — immutable append-only record of all significant events
CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id      UUID,                         -- NULL for unauthenticated events
    actor_email   TEXT,
    action        TEXT NOT NULL,                -- e.g. LOGIN_SUCCESS, TOOL_DELETED
    resource_type TEXT,                         -- e.g. user, tool, peer, role
    resource_id   TEXT,
    details       TEXT,                         -- free-form, no secrets
    ip_address    TEXT,
    user_agent    TEXT,
    severity      TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info','warn','critical'))
);

-- Indexes for common filter patterns in the admin UI
CREATE INDEX IF NOT EXISTS audit_logs_ts_idx       ON audit_logs (ts DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx    ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx   ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON audit_logs (severity);

-- Application-level IP firewall rules
-- Rules are evaluated in priority order (lower = checked first).
-- First matching rule wins. Default: allow if no rule matches.
CREATE TABLE IF NOT EXISTS firewall_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    priority    INTEGER NOT NULL DEFAULT 100,
    action      TEXT NOT NULL CHECK (action IN ('allow','deny')),
    cidr        TEXT NOT NULL,                  -- e.g. 203.0.113.0/24 or 10.0.0.1/32
    description TEXT NOT NULL DEFAULT '',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS firewall_rules_priority_idx ON firewall_rules (priority, is_active);
