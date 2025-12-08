"""Tests for voice input endpoints."""

from unittest.mock import patch

import pytest


@pytest.fixture
def sample_voice_text():
    """Sample voice input text."""
    return "add milk and eggs to the costco list"


@pytest.fixture
def sample_llm_parse_response():
    """Sample LLM parsing response."""
    return {
        "action": "add",
        "list_name": "costco",
        "items": ["milk", "eggs"],
    }


@pytest.fixture
def sample_categorization_response():
    """Sample categorization response."""
    return {
        "category_id": 1,
        "confidence": 0.9,
        "reasoning": "Dairy products typically go in the dairy section",
    }


def test_create_voice_input(client, auth_headers):
    """Test creating a voice input."""
    with patch("src.tasks.voice_processing.process_voice_input.delay") as mock_task:
        response = client.post(
            "/api/v1/voice",
            headers=auth_headers,
            json={"raw_text": "add milk to costco list"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["raw_text"] == "add milk to costco list"
        assert data["status"] == "pending"
        assert "id" in data
        # Verify task was triggered
        mock_task.assert_called_once()


def test_get_voice_input(client, auth_headers):
    """Test getting a voice input by ID."""
    # Create voice input first
    with patch("src.tasks.voice_processing.process_voice_input.delay"):
        create_response = client.post(
            "/api/v1/voice",
            headers=auth_headers,
            json={"raw_text": "add apples to walmart"},
        )
        voice_id = create_response.json()["id"]

    # Get the voice input
    response = client.get(f"/api/v1/voice/{voice_id}", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == voice_id
    assert data["raw_text"] == "add apples to walmart"


def test_get_voice_input_not_found(client, auth_headers):
    """Test getting a non-existent voice input."""
    response = client.get("/api/v1/voice/99999", headers=auth_headers)
    assert response.status_code == 404


def test_list_pending_confirmations(client, auth_headers):
    """Test listing pending confirmations."""
    response = client.get("/api/v1/voice/pending/list", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_confirm_pending_confirmation(client, auth_headers, db):
    """Test confirming a pending confirmation."""
    user_id = auth_headers.user_id

    # Create a list and category first
    list_response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Test List", "icon": "📝"},
    )
    list_id = list_response.json()["id"]

    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Create a pending confirmation manually using the test db session
    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="add milk to test list",
        status="completed",
    )
    db.add(voice_input)
    db.flush()

    # Create pending confirmation
    pending = PendingConfirmation(
        user_id=user_id,
        voice_input_id=voice_input.id,
        proposed_changes={
            "action": "add",
            "list_id": list_id,
            "list_name": "Test List",
            "items": [
                {
                    "name": "milk",
                    "category_id": category_id,
                    "confidence": 0.9,
                    "reasoning": "Dairy product",
                }
            ],
        },
        status="pending",
    )
    db.add(pending)
    db.commit()
    pending_id = pending.id

    # Confirm the pending confirmation
    response = client.post(
        f"/api/v1/voice/pending/{pending_id}/action",
        headers=auth_headers,
        json={"action": "confirm"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "confirmed"

    # Verify item was created
    items_response = client.get(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
    )
    items = items_response.json()
    assert len(items) == 1
    assert items[0]["name"] == "milk"
    assert items[0]["category_id"] == category_id


def test_reject_pending_confirmation(client, auth_headers, db):
    """Test rejecting a pending confirmation."""
    user_id = auth_headers.user_id

    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="add test item",
        status="completed",
    )
    db.add(voice_input)
    db.flush()

    # Create pending confirmation
    pending = PendingConfirmation(
        user_id=user_id,
        voice_input_id=voice_input.id,
        proposed_changes={
            "action": "add",
            "list_id": 1,
            "list_name": "Test",
            "items": [{"name": "test", "category_id": None, "confidence": 0.3}],
        },
        status="pending",
    )
    db.add(pending)
    db.commit()
    pending_id = pending.id

    # Reject the pending confirmation
    response = client.post(
        f"/api/v1/voice/pending/{pending_id}/action",
        headers=auth_headers,
        json={"action": "reject"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "rejected"
