"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api import (
    auth,
    categories,
    debug,
    items,
    lists,
    notifications,
    pantry,
    recipes,
    voice,
    webhooks,
)
from src.config import get_settings

# Ensure uploads directory exists
UPLOADS_DIR = Path("/app/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown events."""
    # Startup: Initialize application resources here
    yield
    # Shutdown: Clean up resources here


app = FastAPI(
    title="Todo List API",
    description="Self-hosted todo list with voice input and LLM categorization",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for development
if settings.is_development:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
            "https://todolist.lan",
            "https://thiemnet.ca",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Register routers
app.include_router(auth.router)
app.include_router(lists.router)
app.include_router(categories.router)
app.include_router(items.router)
app.include_router(voice.router)
app.include_router(recipes.router)
app.include_router(pantry.router)
app.include_router(notifications.router)
app.include_router(webhooks.router)
app.include_router(debug.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "environment": settings.environment}


# Mount static files for uploads under /api/v1/uploads so Cloudflare tunnel routes them correctly
# (Cloudflare routes /api/* to FastAPI, everything else to Next.js)
app.mount("/api/v1/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
