import os
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from api.dependencies import get_business_or_404, get_db_dep, read_rate_limit, verify_jwt, write_rate_limit

router = APIRouter(tags=["calendar"])

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")
SCOPES = ["https://www.googleapis.com/auth/calendar"]


@router.get(
    "/businesses/{business_id}/calendar/auth",
    dependencies=[Depends(read_rate_limit)],
)
async def calendar_auth_start(
    business_id: UUID,
    business=Depends(get_business_or_404),
):
    """Return Google OAuth URL for this business to authorize calendar access."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [GOOGLE_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=str(business_id),
    )
    return {"auth_url": auth_url}


@router.get("/businesses/calendar/callback")
async def calendar_auth_callback(
    request: Request,
    db=Depends(get_db_dep),
    jwt=Depends(verify_jwt),
):
    """Handle OAuth callback. JWT validates the caller; state must match JWT business_id."""
    from google_auth_oauthlib.flow import Flow
    import json

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code or not state:
        return {"error": "Missing code or state"}

    # Verify state matches the JWT-authenticated business_id
    try:
        state_uuid = UUID(state)
    except ValueError:
        return {"error": "Invalid state parameter"}

    business_id = UUID(jwt.business_id)
    if state_uuid != business_id:
        return {"error": "State mismatch — possible CSRF"}

    # Verify business exists and is active
    business = await db.fetchrow(
        "SELECT id FROM businesses WHERE id = $1 AND active = TRUE", business_id
    )
    if not business:
        return {"error": "Business not found"}

    redirect_uri = GOOGLE_REDIRECT_URI
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = redirect_uri
    flow.fetch_token(code=code)
    credentials = flow.credentials

    token_json = json.dumps({
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes or []),
    })

    # Store encrypted with pgcrypto
    await db.execute(
        """
        UPDATE businesses
        SET calendar_oauth_token_enc = pgp_sym_encrypt($1, $2),
            calendar_enabled = TRUE,
            calendar_provider = 'google'
        WHERE id = $3
        """,
        token_json,
        ENCRYPTION_KEY,
        business_id,
    )

    return {"status": "calendar_connected"}


@router.get(
    "/businesses/{business_id}/calendar/sync-failures",
    dependencies=[Depends(read_rate_limit)],
)
async def list_sync_failures(
    business_id: UUID,
    db=Depends(get_db_dep),
    business=Depends(get_business_or_404),
):
    rows = await db.fetch(
        """
        SELECT id, caller_number, start_ts, end_ts, status, sync_status, created_at
        FROM calendar_reservations
        WHERE business_id=$1 AND sync_status IN ('sync_failed', 'pending_sync')
        ORDER BY created_at DESC
        LIMIT 100
        """,
        business_id,
    )
    items = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        for f in ("start_ts", "end_ts", "created_at"):
            if d.get(f):
                d[f] = d[f].isoformat()
        items.append(d)
    return {"items": items}
