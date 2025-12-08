"""Pytest configuration and fixtures."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.database import Base, get_db
from src.main import app


class AuthHeaders(dict):
    """Dict subclass that also stores user_id."""

    def __init__(self, *args, user_id: int | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user_id = user_id


# Use test database - PostgreSQL in Docker, SQLite locally
if os.getenv("DATABASE_URL"):
    # Running in Docker - use PostgreSQL test database
    SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL").replace("/todo_list", "/todo_list_test")
else:
    # Running locally - use SQLite
    SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

connect_args = {"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {}
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Create test database schema once at the start of the test session."""
    if "postgresql" in SQLALCHEMY_DATABASE_URL:
        # For PostgreSQL, create the test database
        from sqlalchemy_utils import create_database, database_exists

        # Create test database if it doesn't exist
        if not database_exists(SQLALCHEMY_DATABASE_URL):
            create_database(SQLALCHEMY_DATABASE_URL)

    Base.metadata.create_all(bind=engine)
    yield
    # Don't drop database - just leave it for next run (each test cleans up after itself)


@pytest.fixture(scope="function", autouse=True)
def db():
    """Create a fresh database session for each test with cleanup."""
    session = TestingSessionLocal()

    yield session

    # Clean up all data after test
    session.rollback()
    for table in reversed(Base.metadata.sorted_tables):
        session.execute(table.delete())
    session.commit()
    session.close()


@pytest.fixture(scope="function")
def client(db):
    """Create a test client with database override."""

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client):
    """Create a user and return auth headers with user info."""
    # Register user
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "test@example.com", "password": "testpass123", "name": "Test User"},
    )
    assert response.status_code == 201
    data = response.json()
    token = data["access_token"]
    user_id = data["user"]["id"]

    return AuthHeaders({"Authorization": f"Bearer {token}"}, user_id=user_id)
