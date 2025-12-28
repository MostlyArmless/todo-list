"""RecipeImport model for async recipe parsing."""

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text

from src.database import Base
from src.models.mixins import TimestampMixin


class RecipeImport(Base, TimestampMixin):
    """Model for storing recipe import requests and parsed results."""

    __tablename__ = "recipe_imports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    raw_text = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    parsed_recipe = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
