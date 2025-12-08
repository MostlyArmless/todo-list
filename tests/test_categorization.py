"""Tests for categorization service."""

from unittest.mock import MagicMock

import pytest

from src.models.category import Category
from src.models.item_history import ItemHistory
from src.models.list import List
from src.services.categorization import CategorizationService


@pytest.fixture
def test_list_with_categories(db):
    """Create a test list with categories."""
    # Create a test user first
    from src.models.user import User

    test_user = User(email="cattest@example.com", name="Cat Test", password_hash="fake")
    db.add(test_user)
    db.flush()

    # Create list
    test_list = List(
        owner_id=test_user.id,
        name="Test Store",
        icon="🏪",
    )
    db.add(test_list)
    db.flush()

    # Create categories
    dairy_cat = Category(list_id=test_list.id, name="Dairy", sort_order=0)
    produce_cat = Category(list_id=test_list.id, name="Produce", sort_order=1)
    meat_cat = Category(list_id=test_list.id, name="Meat", sort_order=2)

    db.add_all([dairy_cat, produce_cat, meat_cat])
    db.commit()

    return {
        "list": test_list,
        "user": test_user,
        "dairy": dairy_cat,
        "produce": produce_cat,
        "meat": meat_cat,
    }


def test_exact_history_match(db, test_list_with_categories):
    """Test categorization with exact history match."""
    setup = test_list_with_categories
    service = CategorizationService(db)

    # Add history for "milk" -> dairy
    history = ItemHistory(
        list_id=setup["list"].id,
        category_id=setup["dairy"].id,
        normalized_name="milk",
        occurrence_count=1,
    )
    db.add(history)
    db.commit()

    # Categorize "milk" - should use exact history
    result = service.categorize_item("milk", setup["list"].id, setup["user"].id)

    assert result["category_id"] == setup["dairy"].id
    assert result["confidence"] == 1.0
    assert result["source"] == "history"


def test_fuzzy_history_match(db, test_list_with_categories):
    """Test categorization with fuzzy history match."""
    setup = test_list_with_categories
    service = CategorizationService(db)

    # Add history for "whole milk" -> dairy
    history1 = ItemHistory(
        list_id=setup["list"].id,
        category_id=setup["dairy"].id,
        normalized_name="whole milk",
        occurrence_count=1,
    )
    history2 = ItemHistory(
        list_id=setup["list"].id,
        category_id=setup["dairy"].id,
        normalized_name="skim milk",
        occurrence_count=1,
    )
    db.add_all([history1, history2])
    db.commit()

    # Categorize "milk" - should fuzzy match
    result = service.categorize_item("milk", setup["list"].id, setup["user"].id)

    assert result["category_id"] == setup["dairy"].id
    assert result["confidence"] >= 0.5
    assert result["source"] == "history"


def test_llm_categorization(db, test_list_with_categories):
    """Test categorization using LLM when no history exists."""
    setup = test_list_with_categories
    mock_llm = MagicMock()
    mock_llm.generate_json.return_value = {
        "category_id": setup["produce"].id,
        "confidence": 0.85,
        "reasoning": "Apples are produce",
    }

    service = CategorizationService(db, llm_service=mock_llm)

    # Categorize "apples" with no history - should use LLM
    result = service.categorize_item("apples", setup["list"].id, setup["user"].id)

    assert result["category_id"] == setup["produce"].id
    assert result["confidence"] == 0.85
    assert result["source"] == "llm"
    mock_llm.generate_json.assert_called_once()


def test_record_categorization(db, test_list_with_categories):
    """Test recording categorization to history."""
    setup = test_list_with_categories
    service = CategorizationService(db)

    # Record a categorization
    service.record_categorization(
        item_name="cheese",
        category_id=setup["dairy"].id,
        list_id=setup["list"].id,
        user_id=setup["user"].id,
    )

    # Verify it was recorded
    history = (
        db.query(ItemHistory)
        .filter(
            ItemHistory.normalized_name == "cheese",
            ItemHistory.category_id == setup["dairy"].id,
        )
        .first()
    )

    assert history is not None
    assert history.list_id == setup["list"].id
    assert history.occurrence_count == 1


def test_no_categories_available(db):
    """Test categorization when no categories exist."""
    # Create a test user first
    from src.models.user import User

    test_user = User(email="empty@example.com", name="Empty Test", password_hash="fake")
    db.add(test_user)
    db.flush()

    # Create list without categories
    test_list = List(owner_id=test_user.id, name="Empty List", icon="📝")
    db.add(test_list)
    db.commit()

    service = CategorizationService(db)
    result = service.categorize_item("test item", test_list.id, test_user.id)

    assert result["category_id"] is None
    assert result["confidence"] == 0.0
    assert result["source"] == "none"


def test_llm_error_handling(db, test_list_with_categories):
    """Test handling of LLM errors."""
    setup = test_list_with_categories
    mock_llm = MagicMock()
    mock_llm.generate_json.side_effect = Exception("LLM API error")

    service = CategorizationService(db, llm_service=mock_llm)

    # Should handle error gracefully
    result = service.categorize_item("bananas", setup["list"].id, setup["user"].id)

    assert result["category_id"] is None
    assert result["confidence"] == 0.0
    assert result["source"] == "none"
    assert "LLM error" in result["reasoning"]
