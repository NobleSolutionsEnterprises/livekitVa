-- VA Platform v2.3 Database Schema
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- v2.2: required for exclusion constraint

-- ============================================================
-- Users (dashboard login)
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Business accounts
-- ============================================================
CREATE TABLE businesses (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  did                       TEXT UNIQUE,           -- nullable: set after number provisioning
  greeting                  TEXT NOT NULL,
  after_hours_greeting      TEXT,
  persona                   TEXT NOT NULL,
  voice                     TEXT DEFAULT 'alloy',
  timezone                  TEXT NOT NULL DEFAULT 'UTC',
  transfer_number           TEXT,
  after_hours_number        TEXT,
  transfer_trigger_phrases  TEXT[],
  business_hours            JSONB,

  -- Concurrency
  max_concurrent_calls      INT NOT NULL DEFAULT 5,
  max_calls_per_caller_hour INT NOT NULL DEFAULT 10,  -- v2.3: per-caller rate limit (0=disabled)

  -- RAG tuning
  rag_semantic_weight       FLOAT NOT NULL DEFAULT 0.7,
  chunk_size_tokens         INT NOT NULL DEFAULT 512,
  chunk_overlap_tokens      INT NOT NULL DEFAULT 64,

  -- Recording
  recording_enabled         BOOLEAN DEFAULT TRUE,
  recording_consent_message TEXT,

  -- SMS
  sms_enabled               BOOLEAN DEFAULT FALSE,
  sms_postcall_template     TEXT,
  sms_reminder_template     TEXT,

  -- Calendar
  calendar_enabled          BOOLEAN DEFAULT FALSE,
  calendar_provider         TEXT,
  calendar_oauth_token_enc  BYTEA,
  calendar_booking_duration INT DEFAULT 30,
  calendar_buffer_minutes   INT DEFAULT 15,

  -- Widget
  widget_enabled            BOOLEAN DEFAULT FALSE,
  widget_allowed_domains    TEXT[] DEFAULT '{}',
  widget_chat_greeting      TEXT,
  widget_accent_color       TEXT DEFAULT '#2563eb',
  max_chat_sessions_per_ip_hour INT NOT NULL DEFAULT 20,

  -- Data governance
  data_retention_days       INT NOT NULL DEFAULT 90,
  audit_log_retention_days  INT NOT NULL DEFAULT 365,

  active                    BOOLEAN DEFAULT TRUE,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Per-business feature flags
-- ============================================================
CREATE TABLE business_feature_flags (
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flag          TEXT NOT NULL,
  -- 'enable_reranker' | 'use_groq' | 'allow_outbound_campaigns' | 'enable_semantic_chunking'
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (business_id, flag)
);

-- ============================================================
-- Documents (uploaded source files)
-- ============================================================
CREATE TABLE documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  file_type           TEXT NOT NULL,           -- pdf | txt | docx | csv
  content_fingerprint TEXT,                    -- SHA-256 for dedup
  ocr_applied         BOOLEAN DEFAULT FALSE,
  ocr_confidence      FLOAT,                  -- v2.2: 0.0-1.0, < 0.6 = low quality
  status              TEXT DEFAULT 'processing', -- processing | ready | error
  error_message       TEXT,
  chunk_count         INT,
  uploaded_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Dedup index: only for successful ingestions
CREATE UNIQUE INDEX ON documents (business_id, content_fingerprint)
  WHERE status = 'ready';

-- ============================================================
-- document_chunks — 16 HASH partitions (v2.2: up from 4)
-- ============================================================
CREATE TABLE document_chunks (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536),
  metadata      JSONB DEFAULT '{}',  -- source, section, page, ocr, section_heading (v2.3)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (business_id, id)
) PARTITION BY HASH (business_id);

CREATE TABLE document_chunks_p0  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 0);
CREATE TABLE document_chunks_p1  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 1);
CREATE TABLE document_chunks_p2  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 2);
CREATE TABLE document_chunks_p3  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 3);
CREATE TABLE document_chunks_p4  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 4);
CREATE TABLE document_chunks_p5  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 5);
CREATE TABLE document_chunks_p6  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 6);
CREATE TABLE document_chunks_p7  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 7);
CREATE TABLE document_chunks_p8  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 8);
CREATE TABLE document_chunks_p9  PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 9);
CREATE TABLE document_chunks_p10 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 10);
CREATE TABLE document_chunks_p11 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 11);
CREATE TABLE document_chunks_p12 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 12);
CREATE TABLE document_chunks_p13 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 13);
CREATE TABLE document_chunks_p14 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 14);
CREATE TABLE document_chunks_p15 PARTITION OF document_chunks FOR VALUES WITH (modulus 16, remainder 15);

-- v2.2: GIN index (faster for long text) replaces GIST
CREATE INDEX ON document_chunks USING gin   (content gin_trgm_ops);
CREATE INDEX ON document_chunks USING hnsw  (embedding vector_cosine_ops);
CREATE INDEX ON document_chunks             (business_id);

-- v2.3: Autovacuum tuning for high-churn tables
ALTER TABLE document_chunks SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 10
);

-- ============================================================
-- Outbound campaigns (MUST precede call_logs for FK)
-- ============================================================
CREATE TABLE outbound_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  script          TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'pending',  -- pending | running | completed | cancelled
  calls_total     INT DEFAULT 0,
  calls_completed INT DEFAULT 0,
  calls_failed    INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON outbound_campaigns (business_id, status);

-- ============================================================
-- Call logs — RANGE partitioned by month
-- NOTE: FK references FROM other tables to call_logs are not possible
-- due to composite PK. Referential integrity enforced at app layer.
-- ============================================================
CREATE TABLE call_logs (
  id                     UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id            UUID REFERENCES businesses(id) ON DELETE SET NULL,
  business_name_snapshot TEXT,
  campaign_id            UUID REFERENCES outbound_campaigns(id) ON DELETE SET NULL,
  direction              TEXT NOT NULL DEFAULT 'inbound',
  call_sid               TEXT,
  livekit_room           TEXT,
  caller_number          TEXT,
  started_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ,
  duration_sec           INT,
  outcome                TEXT,
  -- completed | transferred | abandoned | no_answer | booked | voicemail
  -- rate_limited | after_hours | overflow
  transcript             JSONB,
  summary                TEXT,
  transfer_reason        TEXT,
  recording_url          TEXT,
  recording_sid          TEXT,
  appointment_id         TEXT,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

-- Monthly partitions (pg_partman automates this in production)
CREATE TABLE call_logs_2025_01 PARTITION OF call_logs FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE call_logs_2025_02 PARTITION OF call_logs FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE call_logs_2025_03 PARTITION OF call_logs FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE call_logs_2025_04 PARTITION OF call_logs FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE call_logs_2025_05 PARTITION OF call_logs FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE call_logs_2025_06 PARTITION OF call_logs FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE call_logs_2025_07 PARTITION OF call_logs FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE call_logs_2025_08 PARTITION OF call_logs FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE call_logs_2025_09 PARTITION OF call_logs FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE call_logs_2025_10 PARTITION OF call_logs FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE call_logs_2025_11 PARTITION OF call_logs FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE call_logs_2025_12 PARTITION OF call_logs FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE call_logs_2026_01 PARTITION OF call_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE call_logs_2026_02 PARTITION OF call_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE call_logs_2026_03 PARTITION OF call_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE call_logs_2026_04 PARTITION OF call_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE call_logs_2026_05 PARTITION OF call_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE call_logs_2026_06 PARTITION OF call_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE call_logs_2026_07 PARTITION OF call_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE call_logs_2026_08 PARTITION OF call_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE call_logs_2026_09 PARTITION OF call_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE call_logs_2026_10 PARTITION OF call_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE call_logs_2026_11 PARTITION OF call_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE call_logs_2026_12 PARTITION OF call_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX ON call_logs (business_id, started_at DESC);
CREATE INDEX ON call_logs (caller_number);
CREATE INDEX ON call_logs (campaign_id);

-- ============================================================
-- Calendar reservations — DB-first booking lock
-- v2.2: exclusion constraint replaces UNIQUE for true overlap prevention
-- ============================================================
CREATE TABLE calendar_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_log_id     UUID,  -- app-layer ref (no FK — partitioned PK)
  caller_number   TEXT,
  start_ts        TIMESTAMPTZ NOT NULL,
  end_ts          TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | confirmed | cancelled | expired
  sync_status     TEXT NOT NULL DEFAULT 'pending_sync',
  -- pending_sync | synced | sync_failed
  google_event_id TEXT,
  google_sync_at  TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Exclusion constraint: prevents ANY overlapping time range for same business
  CONSTRAINT no_overlap EXCLUDE USING gist (
    business_id WITH =,
    tstzrange(start_ts, end_ts) WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);

CREATE INDEX ON calendar_reservations (business_id, start_ts);
CREATE INDEX ON calendar_reservations (status, expires_at) WHERE status = 'pending';
CREATE INDEX ON calendar_reservations (sync_status) WHERE sync_status = 'sync_failed';

-- ============================================================
-- Chat sessions (widget)
-- ============================================================
CREATE TABLE chat_sessions (
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

CREATE INDEX ON chat_sessions (business_id, started_at DESC);
CREATE INDEX ON chat_sessions (visitor_id);

-- ============================================================
-- Chat messages (widget)
-- ============================================================
CREATE TABLE chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  prompt_tokens     INT,
  completion_tokens INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON chat_messages (session_id, created_at);

-- ============================================================
-- Retrieval audit — RAG context per LLM answer
-- NOTE: no FK to call_logs (partitioned PK limitation)
-- ============================================================
CREATE TABLE retrieval_audit (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_log_id       UUID,
  chat_session_id   UUID,
  turn_index        INT NOT NULL,
  utterance         TEXT NOT NULL,
  chunk_ids         UUID[] NOT NULL,
  retrieval_scores  JSONB NOT NULL,
  -- {"chunk_uuid": {"semantic": 0.87, "keyword": 0.42, "rrf": 0.76, "rerank": 0.91}}
  model_used        TEXT NOT NULL,
  prompt_tokens     INT,
  completion_tokens INT,
  retrieved_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON retrieval_audit (call_log_id);
CREATE INDEX ON retrieval_audit (chat_session_id);

ALTER TABLE retrieval_audit SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- ============================================================
-- Voicemails
-- ============================================================
CREATE TABLE voicemails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_log_id   UUID,
  caller_number TEXT,
  recording_url TEXT,
  transcript    TEXT,
  is_read       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON voicemails (business_id, is_read);
CREATE INDEX ON voicemails (call_log_id);

-- ============================================================
-- SMS log
-- ============================================================
CREATE TABLE sms_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_log_id   UUID,
  direction     TEXT NOT NULL,
  to_number     TEXT NOT NULL,
  from_number   TEXT NOT NULL,
  body          TEXT NOT NULL,
  telnyx_msg_id TEXT,
  status        TEXT,  -- queued | sent | delivered | failed
  attempts      INT DEFAULT 0,
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON sms_logs (business_id, sent_at DESC);

-- ============================================================
-- Campaign contacts — per-number status with DLQ support
-- ============================================================
CREATE TABLE campaign_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | called | failed | skipped_dnc | skipped_hours | dlq
  outcome         TEXT,
  call_log_id     UUID,
  attempts        INT DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  dlq_reason      TEXT,
  scheduled_at    TIMESTAMPTZ,
  called_at       TIMESTAMPTZ
);

CREATE INDEX ON campaign_contacts (campaign_id, status);
CREATE INDEX ON campaign_contacts (next_retry_at) WHERE status = 'failed';

-- ============================================================
-- DNC registry
-- ============================================================
CREATE TABLE dnc_numbers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  reason        TEXT,  -- opt-out | manual | sms-stop
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, phone_number)
);

CREATE INDEX ON dnc_numbers (business_id, phone_number);

-- ============================================================
-- Webhook dedupe store
-- ============================================================
CREATE TABLE telnyx_processed_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON telnyx_processed_events (received_at);

-- v2.3: Aggressive autovacuum after nightly bulk deletes
ALTER TABLE telnyx_processed_events SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);

-- ============================================================
-- Immutable audit log
-- ============================================================
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID,
  actor_id    UUID,
  action      TEXT NOT NULL,
  -- data_erasure | key_rotation | webhook_rejected | webhook_duplicate
  -- reservation_conflict | google_sync_failed | google_sync_orphan
  -- dlq_contact | retention_cleanup | audit_log_archived | sms_failed
  -- caller_rate_limited
  detail      JSONB,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON audit_log (business_id, occurred_at DESC);
CREATE INDEX ON audit_log (action);
