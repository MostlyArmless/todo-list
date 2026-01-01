#!/usr/bin/env python3
"""Seed demo data for screenshots.

Creates a dedicated demo user with representative data in the main database.
This data persists across runs since tests use a separate todo_list_test database.

Usage:
    # From project root (with Docker running):
    docker compose exec api python scripts/seed_demo_data.py

    # Or directly:
    DATABASE_URL=postgresql://todo_user:todo_password@localhost:5433/todo_list \
        python scripts/seed_demo_data.py
"""

import os
import sys
from datetime import UTC, datetime, timedelta

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.database import Base
from src.models import (
    Category,
    Item,
    List,
    PantryItem,
    Recipe,
    RecipeIngredient,
    User,
)
from src.models.enums import ListType, RecurrencePattern
from src.services.auth import get_password_hash

# Use main database - demo data is isolated by user, tests use todo_list_test
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://todo_user:todo_password@localhost:5433/todo_list"
)

# Demo user credentials (must match screenshot spec)
DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demopass123"


def seed_demo_data():
    """Seed the demo database with representative data."""
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Check if demo user already exists
        existing_user = session.query(User).filter_by(email=DEMO_EMAIL).first()
        if existing_user:
            print("Demo data already exists. Clearing and re-seeding...")
            # Clear all data for demo user
            session.query(Item).filter(
                Item.list_id.in_(session.query(List.id).filter_by(owner_id=existing_user.id))
            ).delete(synchronize_session=False)
            session.query(Category).filter(
                Category.list_id.in_(session.query(List.id).filter_by(owner_id=existing_user.id))
            ).delete(synchronize_session=False)
            session.query(List).filter_by(owner_id=existing_user.id).delete()
            session.query(RecipeIngredient).filter(
                RecipeIngredient.recipe_id.in_(
                    session.query(Recipe.id).filter_by(user_id=existing_user.id)
                )
            ).delete(synchronize_session=False)
            session.query(Recipe).filter_by(user_id=existing_user.id).delete()
            session.query(PantryItem).filter_by(user_id=existing_user.id).delete()
            session.delete(existing_user)
            session.commit()

        # Create demo user
        print("Creating demo user...")
        user = User(
            email=DEMO_EMAIL,
            password_hash=get_password_hash(DEMO_PASSWORD),
            name="Demo User",
        )
        session.add(user)
        session.flush()

        # =================================================================
        # GROCERY LIST with categories and items
        # =================================================================
        print("Creating grocery list...")
        grocery_list = List(
            name="Weekly Groceries",
            owner_id=user.id,
            icon="🛒",
            list_type=ListType.GROCERY,
        )
        session.add(grocery_list)
        session.flush()

        # Categories
        produce = Category(list_id=grocery_list.id, name="Produce", sort_order=0)
        dairy = Category(list_id=grocery_list.id, name="Dairy", sort_order=1)
        meat = Category(list_id=grocery_list.id, name="Meat & Seafood", sort_order=2)
        bakery = Category(list_id=grocery_list.id, name="Bakery", sort_order=3)
        pantry_cat = Category(list_id=grocery_list.id, name="Pantry", sort_order=4)
        session.add_all([produce, dairy, meat, bakery, pantry_cat])
        session.flush()

        # Grocery items with recipe sources
        grocery_items = [
            # Produce
            Item(
                list_id=grocery_list.id,
                category_id=produce.id,
                name="Avocados",
                quantity="3",
                recipe_sources=[
                    {"recipe_id": 1, "recipe_name": "Guacamole", "label_color": "#22c55e"}
                ],
            ),
            Item(
                list_id=grocery_list.id,
                category_id=produce.id,
                name="Baby Spinach",
                quantity="1 bag",
            ),
            Item(
                list_id=grocery_list.id,
                category_id=produce.id,
                name="Cherry Tomatoes",
                quantity="1 pint",
            ),
            Item(
                list_id=grocery_list.id,
                category_id=produce.id,
                name="Garlic",
                quantity="1 head",
                recipe_sources=[
                    {"recipe_id": 2, "recipe_name": "Pasta", "label_color": "#f59e0b"},
                    {"recipe_id": 3, "recipe_name": "Stir Fry", "label_color": "#ef4444"},
                ],
            ),
            Item(list_id=grocery_list.id, category_id=produce.id, name="Lemons", quantity="4"),
            # Dairy
            Item(list_id=grocery_list.id, category_id=dairy.id, name="Milk", quantity="1 gallon"),
            Item(
                list_id=grocery_list.id, category_id=dairy.id, name="Greek Yogurt", quantity="32oz"
            ),
            Item(
                list_id=grocery_list.id,
                category_id=dairy.id,
                name="Parmesan Cheese",
                quantity="8oz",
                recipe_sources=[{"recipe_id": 2, "recipe_name": "Pasta", "label_color": "#f59e0b"}],
            ),
            Item(list_id=grocery_list.id, category_id=dairy.id, name="Butter", quantity="1 lb"),
            # Meat
            Item(
                list_id=grocery_list.id,
                category_id=meat.id,
                name="Chicken Breast",
                quantity="2 lbs",
                recipe_sources=[
                    {"recipe_id": 3, "recipe_name": "Stir Fry", "label_color": "#ef4444"}
                ],
            ),
            Item(
                list_id=grocery_list.id, category_id=meat.id, name="Salmon Fillets", quantity="1 lb"
            ),
            # Bakery
            Item(
                list_id=grocery_list.id,
                category_id=bakery.id,
                name="Sourdough Bread",
                quantity="1 loaf",
            ),
            Item(list_id=grocery_list.id, category_id=bakery.id, name="Croissants", quantity="4"),
            # Pantry
            Item(
                list_id=grocery_list.id,
                category_id=pantry_cat.id,
                name="Olive Oil",
                quantity="1 bottle",
            ),
            Item(list_id=grocery_list.id, category_id=pantry_cat.id, name="Pasta", quantity="1 lb"),
        ]
        session.add_all(grocery_items)

        # =================================================================
        # TASK LIST with due dates and reminders
        # =================================================================
        print("Creating task list...")
        task_list = List(
            name="Home Tasks",
            owner_id=user.id,
            icon="🏠",
            list_type=ListType.TASK,
        )
        session.add(task_list)
        session.flush()

        now = datetime.now(UTC)
        task_items = [
            # Overdue task
            Item(
                list_id=task_list.id,
                name="Pay electric bill",
                due_date=now - timedelta(days=1),
                reminder_offset="1d",
            ),
            # Due today
            Item(
                list_id=task_list.id,
                name="Call dentist to schedule appointment",
                due_date=now + timedelta(hours=3),
                reminder_offset="1h",
            ),
            # Due tomorrow
            Item(
                list_id=task_list.id,
                name="Submit expense report",
                due_date=now + timedelta(days=1, hours=9),
                reminder_offset="2h",
            ),
            # Due in a few days with recurrence
            Item(
                list_id=task_list.id,
                name="Water plants",
                due_date=now + timedelta(days=2),
                reminder_offset="30m",
                recurrence_pattern=RecurrencePattern.WEEKLY,
            ),
            # Future task
            Item(
                list_id=task_list.id,
                name="Renew car registration",
                due_date=now + timedelta(days=14),
                reminder_offset="1d",
            ),
            # Completed task
            Item(
                list_id=task_list.id,
                name="Buy birthday gift for Mom",
                due_date=now - timedelta(days=2),
                checked=True,
                completed_at=now - timedelta(days=2, hours=5),
            ),
        ]
        session.add_all(task_items)

        # =================================================================
        # RECIPES with ingredients
        # =================================================================
        print("Creating recipes...")
        recipes_data = [
            {
                "name": "Classic Guacamole",
                "description": "Fresh and zesty homemade guacamole",
                "servings": 4,
                "label_color": "#22c55e",
                "instructions": "1. Mash avocados in a bowl\n2. Add lime juice, salt, cilantro\n3. Mix in diced onion and tomato\n4. Serve immediately",
                "calories_per_serving": 160,
                "protein_grams": 2,
                "carbs_grams": 9,
                "fat_grams": 15,
                "ingredients": [
                    ("Avocados", "3", "ripe"),
                    ("Lime", "1", "juiced"),
                    ("Cilantro", "1/4 cup", "chopped"),
                    ("Red Onion", "1/4", "diced"),
                    ("Jalapeño", "1", "seeded, minced"),
                ],
            },
            {
                "name": "Garlic Butter Pasta",
                "description": "Quick weeknight pasta with garlic and parmesan",
                "servings": 4,
                "label_color": "#f59e0b",
                "instructions": "1. Cook pasta al dente\n2. Sauté garlic in butter\n3. Toss pasta with garlic butter\n4. Top with parmesan and parsley",
                "calories_per_serving": 420,
                "protein_grams": 14,
                "carbs_grams": 52,
                "fat_grams": 18,
                "last_cooked_at": now - timedelta(days=5),
                "ingredients": [
                    ("Spaghetti", "1 lb", None),
                    ("Butter", "4 tbsp", None),
                    ("Garlic", "6 cloves", "minced"),
                    ("Parmesan Cheese", "1 cup", "grated"),
                    ("Parsley", "1/4 cup", "chopped"),
                ],
            },
            {
                "name": "Chicken Stir Fry",
                "description": "Healthy Asian-inspired stir fry",
                "servings": 4,
                "label_color": "#ef4444",
                "instructions": "1. Slice chicken into strips\n2. Stir fry vegetables\n3. Add chicken and sauce\n4. Serve over rice",
                "calories_per_serving": 380,
                "protein_grams": 32,
                "carbs_grams": 28,
                "fat_grams": 14,
                "ingredients": [
                    ("Chicken Breast", "1.5 lbs", "sliced"),
                    ("Broccoli", "2 cups", "florets"),
                    ("Bell Pepper", "1", "sliced"),
                    ("Soy Sauce", "3 tbsp", None),
                    ("Garlic", "3 cloves", "minced"),
                    ("Ginger", "1 inch", "grated"),
                ],
            },
            {
                "name": "Greek Salad",
                "description": "Fresh Mediterranean salad with feta",
                "servings": 2,
                "label_color": "#3b82f6",
                "calories_per_serving": 220,
                "protein_grams": 8,
                "carbs_grams": 12,
                "fat_grams": 16,
                "ingredients": [
                    ("Cucumber", "1", "diced"),
                    ("Tomatoes", "2", "diced"),
                    ("Red Onion", "1/4", "sliced"),
                    ("Feta Cheese", "4 oz", "crumbled"),
                    ("Kalamata Olives", "1/2 cup", None),
                    ("Olive Oil", "2 tbsp", None),
                ],
            },
        ]

        for recipe_data in recipes_data:
            ingredients = recipe_data.pop("ingredients")
            recipe = Recipe(user_id=user.id, **recipe_data)
            session.add(recipe)
            session.flush()

            for name, qty, desc in ingredients:
                ing = RecipeIngredient(
                    recipe_id=recipe.id, name=name, quantity=qty, description=desc
                )
                session.add(ing)

        # =================================================================
        # PANTRY ITEMS
        # =================================================================
        print("Creating pantry items...")
        pantry_items = [
            # Have
            PantryItem(
                user_id=user.id,
                name="Olive Oil",
                normalized_name="olive oil",
                status="have",
                category="Oils",
            ),
            PantryItem(
                user_id=user.id,
                name="Salt",
                normalized_name="salt",
                status="have",
                category="Spices",
            ),
            PantryItem(
                user_id=user.id,
                name="Black Pepper",
                normalized_name="black pepper",
                status="have",
                category="Spices",
            ),
            PantryItem(
                user_id=user.id,
                name="Garlic Powder",
                normalized_name="garlic powder",
                status="have",
                category="Spices",
            ),
            PantryItem(
                user_id=user.id,
                name="Rice",
                normalized_name="rice",
                status="have",
                category="Grains",
                preferred_store="Costco",
            ),
            PantryItem(
                user_id=user.id,
                name="Pasta",
                normalized_name="pasta",
                status="have",
                category="Grains",
            ),
            PantryItem(
                user_id=user.id,
                name="Soy Sauce",
                normalized_name="soy sauce",
                status="have",
                category="Condiments",
            ),
            # Low
            PantryItem(
                user_id=user.id,
                name="Flour",
                normalized_name="flour",
                status="low",
                category="Baking",
            ),
            PantryItem(
                user_id=user.id,
                name="Sugar",
                normalized_name="sugar",
                status="low",
                category="Baking",
            ),
            PantryItem(
                user_id=user.id,
                name="Chicken Broth",
                normalized_name="chicken broth",
                status="low",
                category="Canned Goods",
            ),
            # Out
            PantryItem(
                user_id=user.id,
                name="Cumin",
                normalized_name="cumin",
                status="out",
                category="Spices",
            ),
            PantryItem(
                user_id=user.id,
                name="Paprika",
                normalized_name="paprika",
                status="out",
                category="Spices",
            ),
        ]
        session.add_all(pantry_items)

        session.commit()
        print("Demo data seeded successfully!")

    except Exception as e:
        session.rollback()
        print(f"Error seeding demo data: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    seed_demo_data()
