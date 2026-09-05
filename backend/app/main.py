"""FastAPI application factory.

Production readiness notes:
- Logging level comes from LOG_LEVEL env var (default INFO).
- CORS origins come from CORS_ORIGINS env var (comma-separated).
- Reverse proxy: rely on uvicorn --proxy-headers + --forwarded-allow-ips
  rather than trusting arbitrary forwarded headers in application code.
- Single worker required (WebSocket / screen-review state is in-memory).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.api import api_router
from app.api.websocket import router as ws_router
from app.api.screen_review_ws import router as screen_review_ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    settings = get_settings()

    # Configure root logging from env.
    # - development: DEBUG level by default (override via LOG_LEVEL)
    # - production: INFO with structured format
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-5.5s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    # Silence noisy third-party loggers that may log request details.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.DEBUG if settings.DEBUG else logging.WARNING
    )

    logging.getLogger(__name__).info(
        "ProctorAI starting (env=%s, version=%s)", settings.APP_ENV, settings.APP_VERSION
    )
    yield
    # Future: cleanup resources


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="Intelligent Real-Time Exam Monitoring System",
        lifespan=lifespan,
    )

    # CORS — origins are configurable via the CORS_ORIGINS env var.
    # Never use ["*"] with allow_credentials=True (browser rejects it).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global exception handler — never leak stack traces to clients.
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        # Log with exception details server-side; return generic message.
        logging.getLogger(__name__).exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    # Register routes
    app.include_router(api_router)
    app.include_router(ws_router)  # WebSocket routes (not under /api prefix)
    app.include_router(screen_review_ws_router)  # Screen review signaling WS

    return app


app = create_app()
