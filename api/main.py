from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.connection import close_db, close_redis, init_db, init_redis
from api.routes import admin, auth, businesses, calendar, calls, documents, events, outbound, webhooks, widget


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_redis()
    yield
    await close_db()
    await close_redis()


app = FastAPI(
    title="VA Platform API",
    version="2.3.0",
    description="AI Voice Assistant Platform — SIP Hardening, Caller Abuse Prevention, Async Webhooks, RAG Chunking",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Webhook route: EXEMPT from JWT (HMAC + timestamp + dedupe protected)
app.include_router(webhooks.router, prefix="/api")

# Widget routes: EXEMPT from JWT (public, IP-rate-limited)
app.include_router(widget.router, prefix="/api")

# Auth routes: no JWT required (they issue JWTs)
app.include_router(auth.router, prefix="/api")

# All other routes: JWT-protected via dependencies
app.include_router(admin.router, prefix="/api")
app.include_router(businesses.router, prefix="/api")
app.include_router(calls.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(outbound.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(events.router, prefix="/api")
