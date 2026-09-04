"""Test configuration - uses SQLite in-memory for isolated testing."""
import sys
from pathlib import Path

# Ensure app is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import patch, MagicMock

from app.core.database import Base, get_db
from app.main import create_app
from app.models import *  # noqa: F401, F403  — register all models
from app.services import websocket_manager
from app.services import screen_review_manager as srm_module


# SQLite in-memory with shared connection for testing
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


# Enable foreign key support in SQLite
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_database():
    """Create tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    """Provide a clean database session for each test."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    """Provide a FastAPI TestClient with test database override."""
    from fastapi.testclient import TestClient

    app = create_app()

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_websocket_manager():
    """Reset the in-memory WebSocket connection manager between tests."""
    websocket_manager.manager._connections.clear()
    # Reset screen review manager state
    srm_module.screen_review_manager._requests.clear()
    srm_module.screen_review_manager._active_by_session.clear()
    srm_module.screen_review_manager._participant_ws.clear()
    yield
    websocket_manager.manager._connections.clear()
    srm_module.screen_review_manager._requests.clear()
    srm_module.screen_review_manager._active_by_session.clear()
    srm_module.screen_review_manager._participant_ws.clear()


@pytest.fixture
def ws_session_local(db_session):
    """Patch WebSocket handler's SessionLocal to use the test database.

    Returns a callable that mimics SessionLocal() but returns the shared
    test session with a no-op close().
    """

    class NoCloseSession:
        def __init__(self):
            self._session = db_session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass  # Don't close the shared test session

    def test_session_local():
        return NoCloseSession()

    with patch("app.api.websocket.SessionLocal", test_session_local):
        yield test_session_local


@pytest.fixture
def ws_session_local_with_screen_review(db_session):
    """Patch SessionLocal in both websocket modules for screen review tests."""

    class NoCloseSession:
        def __init__(self):
            self._session = db_session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass

    def test_session_local():
        return NoCloseSession()

    with (
        patch("app.api.websocket.SessionLocal", test_session_local),
        patch("app.api.screen_review_ws.SessionLocal", test_session_local),
    ):
        yield test_session_local
