-- Widget configuration on businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS widget_allowed_domains TEXT[] DEFAULT '{}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS widget_chat_greeting TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS widget_accent_color TEXT DEFAULT '#2563eb';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS max_chat_sessions_per_ip_hour INT NOT NULL DEFAULT 20;

-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  visitor_id      TEXT NOT NULL,
  visitor_ip      INET,
  origin_domain   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  message_count   INT DEFAULT 0,
  outcome         TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_biz ON chat_sessions (business_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor ON chat_sessions (visitor_id);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  prompt_tokens     INT,
  completion_tokens INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at);

-- Extend retrieval_audit for chat
ALTER TABLE retrieval_audit ADD COLUMN IF NOT EXISTS chat_session_id UUID;
ALTER TABLE retrieval_audit ALTER COLUMN call_log_id DROP NOT NULL;
