"""RecipeStepCompletion model for tracking step progress."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint

from src.database import Base
from src.models.mixins import TimestampMixin


class RecipeStepCompletion(Base, TimestampMixin):
    """Model for tracking completed recipe steps per user."""

    __tablename__ = "recipe_step_completions"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("recipe_id", "user_id", "step_index", name="uq_recipe_step_user"),
    )
