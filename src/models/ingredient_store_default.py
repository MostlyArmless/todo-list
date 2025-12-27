"""IngredientStoreDefault model for global store preferences."""

from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint

from src.database import Base
from src.models.mixins import TimestampMixin


class IngredientStoreDefault(Base, TimestampMixin):
    """Global default store preference for an ingredient name (per user)."""

    __tablename__ = "ingredient_store_defaults"
    __table_args__ = (
        UniqueConstraint("user_id", "normalized_name", name="uq_user_ingredient_default"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    store_preference = Column(String(20), nullable=False)  # "Grocery" or "Costco"
