"""Public configuration endpoints (no authentication required).

These endpoints return non-secret configuration values that the frontend
and extension need at runtime. TURN credentials, when configured, are
returned here because the browser requires them to authenticate with the
TURN server. Phase 12C can replace static credentials with temporary
credentials generated from a TURN REST API secret.
"""

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/config/webrtc")
async def get_webrtc_config():
    """Return the ICE servers list for RTCPeerConnection.

    Response shape: { "ice_servers": [{ "urls": [...] }, { "urls": ..., "username": ..., "credential": ... }] }
    """
    settings = get_settings()
    return {"ice_servers": settings.webrtc_ice_servers}
