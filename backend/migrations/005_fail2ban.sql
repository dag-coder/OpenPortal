-- Migration 005: Auto-ban / fail2ban integration settings
-- ban_settings stores key-value config for the auto-ban engine

CREATE TABLE IF NOT EXISTS ban_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO ban_settings (key, value) VALUES
    ('enabled',              'true'),
    ('max_retries',          '5'),
    ('find_time_seconds',    '600'),
    ('ban_duration_seconds', '1800')
ON CONFLICT (key) DO NOTHING;
