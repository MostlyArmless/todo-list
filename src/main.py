"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api import auth, categories, items, lists, pantry, recipes, voice
from src.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Todo List API",
    description="Self-hosted todo list with voice input and LLM categorization",
    version="0.1.0",
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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "environment": settings.environment}


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    pass


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown."""
    pass
