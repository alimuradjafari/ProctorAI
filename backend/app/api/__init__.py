from fastapi import APIRouter
from app.api.health import router as health_router
from app.api.auth import router as auth_router
from app.api.monitoring import router as monitoring_router
from app.api.participant import router as participant_router
from app.api.public_config import router as public_config_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(monitoring_router, tags=["monitoring"])
api_router.include_router(participant_router, tags=["participant"])
api_router.include_router(public_config_router, tags=["public-config"])
