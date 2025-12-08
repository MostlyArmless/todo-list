"""Tests for categorization service."""

from unittest.mock import MagicMock

import pytest

from src.database import SessionLocal
from src.models.category import Category
from src.models.item_history import ItemHistory
from src.models.list import List
from src.services.categorization import CategorizationService


@pytest.fixture
def db_session():
    """Create a database session for testing."""
    db = SessionLocal()
    yield db
    db.close()


@pytest.fixture
def test_list_with_categories(db_session):
    """Create a test list with categories."""
    # Create list
    test_list = List(
        owner_id=1,
        name="Test Store",
        icon="🏪",
    )
    db_session.add(test_list)
    db_session.flush()

    # Create categories
    dairy_cat = Category(list_id=test_list.id, name="Dairy", sort_order=0)
    produce_cat = Category(list_id=test_list.id, name="Produce", sort_order=1)
    meat_cat = Category(list_id=test_list.id, name="Meat", sort_order=2)

    db_session.add_all([dairy_cat, produce_cat, meat_cat])
    db_session.commit()

    return {
        "list": test_list,
        "dairy": dairy_cat,
        "produce": produce_cat,
        "meat": meat_cat,
    }


def test_exact_history_match(db_session, test_list_with_categories):
    """Test categorization with exact history match."""
    setup = test_list_with_categories
    service = CategorizationService(db_session)

    # Add history for "milk" -> dairy
    history = ItemHistory(
        list_id=setup["list"].id,
        category_id=setup["dairy"].id,
        normalized_name="milk",
        occurrence_count=1,
    )
    db_session.add(history)
    db_session.commit()

    # Categorize "milk" - should use exact history
    result = service.categorize_item("milk", setup["list"].id, 1)

    assert result["category_id"] == setup["dairy"].id
    assert result["confidence"] == 1.0
    assert result["source"] == "history"


def test_fuzzy_history_match(db_session, test_list_with_categories):
    """Test categorization with fuzzy history match."""
    setup = test_list_with_categories
    service = CategorizationService(db_session)

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
    db_session.add_all([history1, history2])
    db_session.commit()

    # Categorize "milk" - should fuzzy match
    result = service.categorize_item("milk", setup["list"].id, 1)

    assert result["category_id"] == setup["dairy"].id
    assert result["confidence"] >= 0.5
    assert result["source"] == "history"


def test_llm_categorization(db_session, test_list_with_categories):
    """Test categorization using LLM when no history exists."""
    setup = test_list_with_categories
    mock_llm = MagicMock()
    mock_llm.generate_json.return_value = {
        "category_id": setup["produce"].id,
        "confidence": 0.85,
        "reasoning": "Apples are produce",
    }

    service = CategorizationService(db_session, llm_service=mock_llm)

    # Categorize "apples" with no history - should use LLM
    result = service.categorize_item("apples", setup["list"].id, 1)

    assert result["category_id"] == setup["produce"].id
    assert result["confidence"] == 0.85
    assert result["source"] == "llm"
    mock_llm.generate_json.assert_called_once()


def test_record_categorization(db_session, test_list_with_categories):
    """Test recording categorization to history."""
    setup = test_list_with_categories
    service = CategorizationService(db_session)

    # Record a categorization
    service.record_categorization(
        item_name="cheese",
        category_id=setup["dairy"].id,
        list_id=setup["list"].id,
        user_id=1,
    )

    # Verify it was recorded
    history = (
        db_session.query(ItemHistory)
        .filter(
            ItemHistory.normalized_name == "cheese",
            ItemHistory.category_id == setup["dairy"].id,
        )
        .first()
    )

    assert history is not None
    assert history.list_id == setup["list"].id
    assert history.occurrence_count == 1


def test_no_categories_available(db_session):
    """Test categorization when no categories exist."""
    # Create list without categories
    test_list = List(owner_id=1, name="Empty List", icon="📝")
    db_session.add(test_list)
    db_session.commit()

    service = CategorizationService(db_session)
    result = service.categorize_item("test item", test_list.id, 1)

    assert result["category_id"] is None
    assert result["confidence"] == 0.0
    assert result["source"] == "none"


def test_llm_error_handling(db_session, test_list_with_categories):
    """Test handling of LLM errors."""
    setup = test_list_with_categories
    mock_llm = MagicMock()
    mock_llm.generate_json.side_effect = Exception("LLM API error")

    service = CategorizationService(db_session, llm_service=mock_llm)

    # Should handle error gracefully
    result = service.categorize_item("bananas", setup["list"].id, 1)

    assert result["category_id"] is None
    assert result["confidence"] == 0.0
    assert result["source"] == "none"
    assert "LLM error" in result["reasoning"]
