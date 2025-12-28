"""Configuration management for the application."""

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = Field(
        default="postgresql://todo_user:todo_password@localhost:5433/todo_list"
    )

    # Redis
    redis_url: str = Field(default="redis://localhost:6381/0")

    # JWT
    jwt_secret: str = Field(default="change-me-in-production")
    jwt_algorithm: str = Field(default="HS256")
    jwt_expiration_minutes: int = Field(default=10080)  # 7 days

    # LLM
    ollama_base_url: str = Field(default="http://localhost:11434")
    llm_model: str = Field(default="gemma3:12b")

    # USDA FoodData Central API (for nutrition data - free)
    usda_api_key: str | None = Field(default=None)

    # Anthropic API (for receipt scanning with Claude Vision)
    anthropic_api_key: str | None = Field(default=None)

    # API
    environment: str = Field(default="development")

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        """Validate that production has secure settings."""
        if self.environment == "production":
            if self.jwt_secret == "change-me-in-production":  # noqa: S105
                raise ValueError("JWT_SECRET must be changed in production")
            if "localhost" in self.database_url:
                raise ValueError("DATABASE_URL should not use localhost in production")
        return self

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment == "development"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
