# VA Platform — AI Voice Assistant

An AI-powered voice assistant platform that answers inbound phone calls, handles customer queries via RAG, transfers to humans, and provides a web dashboard for business management.

## Stack

- **Agent**: LiveKit Agents SDK (Python), OpenAI (STT/LLM/TTS), Silero VAD
- **API**: FastAPI, asyncpg, Redis
- **Database**: PostgreSQL 16 (pgvector, pgcrypto, pg_trgm), Redis 7
- **Dashboard**: React, Vite, TailwindCSS, Radix UI, TanStack Query
- **Widget**: Embeddable JS widget (esbuild) for voice/chat on external sites
- **Telephony**: Telnyx SIP trunking via LiveKit Cloud
- **Observability**: OpenTelemetry, Prometheus, Grafana, Tempo
- **Infrastructure**: Docker Compose, Caddy (reverse proxy/TLS)

## Architecture

```
Caller (SIP/Widget)
    │
    ▼
LiveKit Cloud ──► agent/ (LiveKit Agent Worker)
                    │
                    ├─► OpenAI STT → RAG retrieval → LLM → TTS
                    ├─► transfer.py (SIP outbound to human)
                    └─► PostgreSQL (call logs, retrieval audit)

Browser
    │
    ▼
Caddy (TLS) ──► dashboard/ (React SPA, served via node serve)
           ──► api/ (FastAPI on port 8000)
           ──► Grafana (metrics/traces)

External Site
    │
    ▼
widget/dist/widget.js ──► api/routes/widget.py (chat + voice token)
```

## Project Structure

```
va-platform/
├── agent/                    # LiveKit agent worker
│   ├── main.py               # Entrypoint — room handler, call lifecycle, transfer tool
│   ├── handler.py            # CallHandler — business hours, rate limiting, concurrent gates
│   ├── conversation.py       # ConversationEngine — RAG + LLM pipeline
│   ├── rag.py                # pgvector retrieval, embedding, semantic search
│   ├── transfer.py           # SIP outbound transfer + participant monitoring
│   ├── calendar_tool.py      # Google Calendar booking tool
│   └── prompts.py            # System prompt builder, greeting templates
│
├── api/                      # FastAPI admin/business API
│   ├── main.py               # App factory, CORS, router registration (prefix: /api)
│   ├── dependencies.py       # JWT auth, rate limiter, idempotency, business lookup
│   ├── ingestion.py          # Document chunking (semantic + fixed), embedding, pgvector upsert
│   ├── campaign_runner.py    # Outbound campaign executor
│   ├── retention.py          # Data retention policy enforcement
│   ├── gdpr.py               # GDPR data erasure
│   ├── reconciliation.py     # Telnyx CDR reconciliation
│   ├── sms_templates.py      # SMS template rendering
│   ├── telnyx_client.py      # Telnyx API client (numbers, SMS, SIP)
│   └── routes/
│       ├── auth.py           # Signup, login, getMe, logout (JWT cookie)
│       ├── admin.py          # Admin: health, business list, user management
│       ├── businesses.py     # Business CRUD, feature flags, number provisioning
│       ├── calls.py          # Call log listing, retrieval audit
│       ├── documents.py      # Document upload + RAG ingestion
│       ├── outbound.py       # Campaigns, DLQ, single calls, DNC, SMS
│       ├── calendar.py       # Google Calendar OAuth, reservations, sync failures
│       ├── events.py         # SSE event stream (real-time dashboard updates)
│       ├── webhooks.py       # Telnyx webhook handler (HMAC verified, async dispatch)
│       └── widget.py         # Public widget endpoints (chat sessions, voice tokens)
│
├── dashboard/                # React SPA (Vite)
│   ├── src/
│   │   ├── api-client/       # Generated API client (Orval from OpenAPI spec)
│   │   ├── components/       # UI components (layout, admin, filters, dialogs)
│   │   ├── hooks/            # Custom hooks (useSSE, useToast)
│   │   ├── lib/              # Auth context, utilities
│   │   └── pages/            # Route pages:
│   │       ├── login.tsx / signup.tsx    # Auth
│   │       ├── setup.tsx                # Business onboarding
│   │       ├── calls.tsx                # Call log list
│   │       ├── call-detail.tsx          # Single call detail + retrieval audit
│   │       ├── voicemails.tsx           # Voicemail inbox
│   │       ├── documents.tsx            # Document management
│   │       ├── calendar.tsx             # Calendar integration
│   │       ├── campaigns.tsx            # Campaign list
│   │       ├── campaign-new.tsx         # Create campaign
│   │       ├── campaign-detail.tsx      # Campaign detail + contacts + DLQ
│   │       ├── analytics.tsx            # Analytics dashboard
│   │       ├── settings.tsx             # Business settings
│   │       └── admin-businesses.tsx     # Admin panel (all businesses + owners)
│   ├── dist/public/          # Production build output
│   ├── vite.config.ts        # Dev proxy /api → localhost:8000
│   └── package.json
│
├── widget/                   # Embeddable website widget
│   ├── src/api.ts            # Widget API client (chat sessions, voice tokens)
│   ├── dist/widget.js        # Built bundle (esbuild)
│   └── esbuild.config.mjs
│
├── db/
│   ├── schema.sql            # Full PostgreSQL schema (users, businesses, call_logs,
│   │                         #   document_chunks, campaigns, voicemails, chat_sessions, etc.)
│   └── connection.py         # asyncpg pool + Redis sentinel connection
│
├── infra/                    # Observability configs
│   ├── grafana/              # Datasource provisioning
│   ├── otel/                 # OpenTelemetry Collector config
│   ├── prometheus/           # Prometheus scrape config
│   ├── tempo/                # Tempo trace storage config
│   └── k8s/                  # Kubernetes manifests (not used in current Docker deploy)
│
├── tests/                    # Test suites
│   ├── unit/
│   ├── integration/
│   ├── load/
│   └── security/
│
├── docker-compose.yml        # All services: postgres, redis, otel, tempo, prometheus,
│                             #   grafana, api, agent, dashboard
├── Dockerfile.api            # Python 3.12 + tesseract + poppler
├── Dockerfile.agent          # Python 3.12
├── Dockerfile.dashboard      # node:20-alpine + serve
├── requirements.api.txt
├── requirements.agent.txt
└── Makefile
```

## Deployment (VPS)

**Domain**: va.noblesolutionsenterprises.com
**Docker Compose dir**: `/root/livekitva/`

Caddy routes:
- `/api/*` → `livekitva-api-1:8000` (FastAPI)
- `/grafana*` → `livekitva-grafana-1:3000` (Grafana)
- Everything else → `livekitva-dashboard-1:3000` (React SPA)

### Deploy commands

```bash
# Dashboard: build locally, upload, rebuild container
cd dashboard && npm run build
scp -r dist/public root@VPS:/root/livekitva/dashboard/dist/
ssh root@VPS "cd /root/livekitva && docker compose build --no-cache dashboard && docker compose up -d dashboard"

# API: upload changed files, rebuild
scp api/routes/somefile.py root@VPS:/root/livekitva/api/routes/
ssh root@VPS "cd /root/livekitva && docker compose up -d --build api"

# Agent: same pattern
scp agent/main.py root@VPS:/root/livekitva/agent/
ssh root@VPS "cd /root/livekitva && docker compose up -d --build agent"

# Widget: rebuild and copy to the site that embeds it
cd widget && npm run build
scp dist/widget.js root@VPS:/root/nodejs/scripts/dist/widget.js
```

### Environment variables

See `.env.example`. Key vars:
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit Cloud
- `OPENAI_API_KEY` — OpenAI (STT, LLM, TTS, embeddings)
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` — Telnyx (SIP, SMS, numbers)
- `JWT_SECRET` — API auth
- `DATABASE_URL`, `REDIS_URL` — set in docker-compose env overrides
- `SIP_OUTBOUND_TRUNK_ID` — LiveKit SIP trunk for transfers
- `GOOGLE_CALENDAR_*` — Calendar integration OAuth

## Local Development

```bash
cp .env.example .env
# Edit .env to add your API keys
docker-compose up --build
```

Services:
- API: http://localhost:8001
- Dashboard: http://localhost:5173 (vite dev) or build + serve
- Postgres: localhost:5434
- Redis: localhost:6380
- Grafana: http://localhost:3000

## Widget Setup

The widget is an embeddable script that adds a chat + voice call button to any website. It connects to the VA Platform API to let visitors chat or call a business's AI assistant.

### Prerequisites

1. The business must exist in the platform (created via the dashboard or API)
2. You need the business's UUID (visible in the admin panel or database)
3. Widget must be enabled for the business: set `widget_enabled = TRUE` and configure `widget_allowed_domains` in the business settings

### Embedding the widget

Add this script tag before the closing `</body>` tag on any page:

```html
<script
  src="https://va.noblesolutionsenterprises.com/api/widget.js"
  data-business-id="YOUR_BUSINESS_UUID"
  data-api-url="https://va.noblesolutionsenterprises.com"
  data-business-name="Your Business Name"
  data-accent-color="#2563eb"
></script>
```

### Attributes

| Attribute | Required | Description |
|---|---|---|
| `data-business-id` | Yes | The business UUID from the platform |
| `data-api-url` | No | API base URL. Defaults to same origin if omitted |
| `data-business-name` | No | Displayed in the widget header. Defaults to "Chat with us" |
| `data-accent-color` | No | Hex color for the widget button and header. Defaults to `#2563eb` |

### How it works

1. The script injects a floating button (bottom-right corner) into the page using Shadow DOM (no CSS conflicts with the host site)
2. Clicking the button opens a panel with two tabs: **Chat** and **Call**
3. **Chat tab**: Creates a chat session via `POST /api/widget/chat/sessions`, then sends/receives messages via the chat endpoints
4. **Call tab**: Requests a LiveKit voice token via `POST /api/widget/token`, then connects the visitor's microphone to a LiveKit room where the AI agent joins automatically
5. The widget is self-contained — no dependencies, no iframes, no external CSS

### Hosting the widget script

The built widget JS (`widget/dist/widget.js`) needs to be served from a URL accessible to the sites embedding it. Currently it's served from the `noblesolutionsenterprises.com` site at `/widget.js`. For other deployments:

```bash
# Rebuild the widget
cd widget && npm run build

# Copy to wherever your sites can load it from
scp dist/widget.js your-server:/path/to/public/widget.js
```

### Programmatic removal

To remove the widget from the page at runtime:

```js
window.__vaWidgetCleanup();
```

## Missing Functionality

The following features have frontend pages but **no backend implementation**:

### Voicemails — no API routes
- `GET /api/businesses/{id}/voicemails` — list voicemails
- `PATCH /api/businesses/{id}/voicemails/{vmId}` — mark as read
- The `voicemails` table exists in the schema and `capture_voicemail()` exists in `agent/transfer.py` but only inserts a stub row with no actual recording.
- Needs: LiveKit Egress/Recording API integration to capture audio when transfer fails, store recording URL, link to voicemail row.

### Analytics — no API route
- `GET /api/businesses/{id}/analytics` — aggregate call stats (total calls, avg duration, outcomes breakdown, daily trends).
- Dashboard page `analytics.tsx` exists but has no data source.

### Campaign detail — no API route
- `GET /api/businesses/{id}/outbound/campaigns/{campaignId}` — fetch single campaign with full details.
- Campaign list and creation endpoints exist, but individual campaign lookup is missing.

### Voicemail recording
- `agent/transfer.py:capture_voicemail()` inserts a DB row but does not record audio via LiveKit's Egress API.

### SMS post-call summaries
- `sms_templates.py` and template fields exist on businesses, but the agent does not trigger SMS after calls end.
- Needs: hook in `agent/main.py` finally block to render template + send via Telnyx.

### Data retention enforcement
- `api/retention.py` exists but is not scheduled anywhere.
- Needs: cron job or background task to purge expired data per `data_retention_days`.

### Generated API client types
- The Orval-generated TypeScript client doesn't include `is_admin` on `MeResponseUser` or `owner_name`/`owner_email` on business list responses.
- Runtime data has these fields but TypeScript types are incomplete. Regenerate from OpenAPI spec to fix.

## Secrets

Do not commit `.env` files or hardcode API keys. All keys are loaded from the environment.
