"""Pantry match history model for caching LLM ingredient-to-pantry matches."""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String

from src.database import Base


class PantryMatchHistory(Base):
    """Store successful ingredient-to-pantry matches to avoid repeated LLM calls.

    When an LLM successfully matches a recipe ingredient to a pantry item,
    we store that match here. Future lookups can use this history first,
    only falling back to LLM for never-seen ingredient combinations.
    """

    __tablename__ = "pantry_match_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # The normalized recipe ingredient name (e.g., "garlic cloves")
    normalized_ingredient = Column(String(255), nullable=False, index=True)

    # The normalized pantry item name it matched to (e.g., "garlic")
    normalized_pantry_name = Column(String(255), nullable=False)

    # Confidence of the match (0.0 to 1.0)
    confidence = Column(Float, default=0.0)

    # How many times this match was used
    occurrence_count = Column(Integer, default=1)

    # When this match was last used
    last_used_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
