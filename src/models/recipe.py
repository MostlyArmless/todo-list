"""Recipe and RecipeIngredient models."""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import SoftDeleteMixin, TimestampMixin


class Recipe(Base, TimestampMixin, SoftDeleteMixin):
    """Recipe model for storing recipe definitions."""

    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    servings = Column(Integer, nullable=True)
    label_color = Column(String(7), nullable=True)  # Hex color like "#e94560"
    instructions = Column(Text, nullable=True)

    # Nutrition data (computed from ingredients via Edamam API)
    calories_per_serving = Column(Integer, nullable=True)
    protein_grams = Column(Float, nullable=True)
    carbs_grams = Column(Float, nullable=True)
    fat_grams = Column(Float, nullable=True)
    nutrition_computed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", backref="recipes")
    ingredients = relationship(
        "RecipeIngredient", back_populates="recipe", cascade="all, delete-orphan"
    )


class RecipeIngredient(Base, TimestampMixin):
    """Ingredient within a recipe."""

    __tablename__ = "recipe_ingredients"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    quantity = Column(String(100), nullable=True)
    description = Column(String(200), nullable=True)
    store_preference = Column(String(20), nullable=True)  # "Grocery", "Costco", or NULL

    # Relationships
    recipe = relationship("Recipe", back_populates="ingredients")
