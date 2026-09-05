"""Application settings loaded from environment variables and .env file.

Centralizes every production-sensitive value so the same codebase runs
cleanly in local development (defaults + backend/.env) and in production
(environment variables only).

List-valued settings are stored as comma-separated strings and exposed
as list[str] via computed properties:
    CORS_ORIGINS=http://a.example.com,https://b.example.com
    WEBRTC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
"""

from __future__ import annotations

from typing import Any

from pydantic_settings import BaseSettings
from functools import lru_cache


def _split_csv(value: str) -> list[str]:
    """Split a comma-separated string into a list of stripped non-empty items."""
    return [s.strip() for s in value.split(",") if s.strip()]


class Settings(BaseSettings):
    # ------------------------------------------------------------------
    # Application
    # ------------------------------------------------------------------
    APP_NAME: str = "ProctorAI"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = "development"          # development | production
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"               # standard Python log levels

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "proctorai"
    DB_PASSWORD: str = ""
    DB_NAME: str = "proctorai"
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE: int = 1800           # recycle connections every 30 min

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ------------------------------------------------------------------
    # JWT
    # ------------------------------------------------------------------
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Participant Token
    PARTICIPANT_TOKEN_EXPIRE_HOURS: int = 12

    # ------------------------------------------------------------------
    # CORS — comma-separated list from env.
    # Default keeps local development working out of the box.
    # Production MUST override via the CORS_ORIGINS env var.
    # ------------------------------------------------------------------
    CORS_ORIGINS: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "chrome-extension://lcphkldfgglpnhidnglkgjfepeiplaof"
    )

    @property
    def cors_origins(self) -> list[str]:
        """Parsed list of allowed CORS origins."""
        return _split_csv(self.CORS_ORIGINS)

    # ------------------------------------------------------------------
    # Frontend / WebSocket (informational — used by backend links/emails)
    # ------------------------------------------------------------------
    FRONTEND_URL: str = "http://localhost:5173"
    WS_URL: str = "ws://localhost:8000"

    # ------------------------------------------------------------------
    # WebRTC ICE — typed primitives.
    # STUN URLs are public and safe in env.
    # TURN credentials are secrets — keep them out of version control.
    # The computed `webrtc_ice_servers` property returns the list[dict]
    # format consumed by RTCPeerConnection.
    # ------------------------------------------------------------------
    WEBRTC_STUN_URLS: str = ""
    WEBRTC_TURN_URL: str = ""
    WEBRTC_TURN_USERNAME: str = ""
    WEBRTC_TURN_CREDENTIAL: str = ""

    @property
    def webrtc_stun_urls(self) -> list[str]:
        """Parsed list of STUN server URLs."""
        return _split_csv(self.WEBRTC_STUN_URLS)

    @property
    def webrtc_ice_servers(self) -> list[dict[str, Any]]:
        """ICE server configuration for RTCPeerConnection."""
        servers: list[dict[str, Any]] = []
        stun = self.webrtc_stun_urls
        if stun:
            servers.append({"urls": stun})
        if self.WEBRTC_TURN_URL:
            turn: dict[str, Any] = {"urls": self.WEBRTC_TURN_URL}
            if self.WEBRTC_TURN_USERNAME:
                turn["username"] = self.WEBRTC_TURN_USERNAME
            if self.WEBRTC_TURN_CREDENTIAL:
                turn["credential"] = self.WEBRTC_TURN_CREDENTIAL
            servers.append(turn)
        return servers

    # ------------------------------------------------------------------
    # Pydantic settings
    # ------------------------------------------------------------------
    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
