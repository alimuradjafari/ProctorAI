from fastapi import APIRouter
from app.api.health import router as health_router
from app.api.auth import router as auth_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
