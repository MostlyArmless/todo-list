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
    """Test listing pending confirmations returns correct structure."""
    response = client.get("/api/v1/voice/pending/list", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    # Check the new VoiceQueueResponse structure
    assert "in_progress" in data
    assert "pending_confirmations" in data
    assert isinstance(data["in_progress"], list)
    assert isinstance(data["pending_confirmations"], list)


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


def test_list_pending_confirmations_returns_queue_response(client, auth_headers, db):
    """Test that pending list endpoint returns the new queue response format."""
    user_id = auth_headers.user_id

    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create a pending voice input (in-progress)
    voice_pending = VoiceInput(
        user_id=user_id,
        raw_text="add something to list",
        status="pending",
    )
    db.add(voice_pending)

    # Create a processing voice input
    voice_processing = VoiceInput(
        user_id=user_id,
        raw_text="add another thing",
        status="processing",
    )
    db.add(voice_processing)

    # Create a failed voice input
    voice_failed = VoiceInput(
        user_id=user_id,
        raw_text="this failed",
        status="failed",
        error_message="Test error",
    )
    db.add(voice_failed)
    db.flush()

    # Create a completed voice input with pending confirmation
    voice_completed = VoiceInput(
        user_id=user_id,
        raw_text="completed voice",
        status="completed",
    )
    db.add(voice_completed)
    db.flush()

    pending_conf = PendingConfirmation(
        user_id=user_id,
        voice_input_id=voice_completed.id,
        proposed_changes={
            "action": "add",
            "list_id": 1,
            "list_name": "Test",
            "items": [{"name": "test", "category_id": None, "confidence": 0.8}],
        },
        status="pending",
    )
    db.add(pending_conf)
    db.commit()

    response = client.get("/api/v1/voice/pending/list", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()

    # Check new response structure
    assert "in_progress" in data
    assert "pending_confirmations" in data

    # Should have 3 in-progress jobs (pending, processing, failed)
    assert len(data["in_progress"]) == 3

    # Verify statuses are present
    statuses = [job["status"] for job in data["in_progress"]]
    assert "pending" in statuses
    assert "processing" in statuses
    assert "failed" in statuses

    # The failed job should have error_message
    failed_jobs = [j for j in data["in_progress"] if j["status"] == "failed"]
    assert len(failed_jobs) == 1
    assert failed_jobs[0]["error_message"] == "Test error"

    # Should have 1 pending confirmation
    assert len(data["pending_confirmations"]) == 1


def test_delete_voice_input(client, auth_headers, db):
    """Test deleting a voice input."""
    user_id = auth_headers.user_id

    from src.models.voice_input import VoiceInput

    # Create a failed voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="failed input to delete",
        status="failed",
        error_message="Some error",
    )
    db.add(voice_input)
    db.commit()
    voice_id = voice_input.id

    # Delete the voice input
    response = client.delete(f"/api/v1/voice/{voice_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's gone
    get_response = client.get(f"/api/v1/voice/{voice_id}", headers=auth_headers)
    assert get_response.status_code == 404


def test_delete_voice_input_not_found(client, auth_headers):
    """Test deleting a non-existent voice input."""
    response = client.delete("/api/v1/voice/99999", headers=auth_headers)
    assert response.status_code == 404


def test_delete_voice_input_unauthorized(client, auth_headers, db):
    """Test that users cannot delete other users' voice inputs."""
    user_id = auth_headers.user_id

    from src.models.voice_input import VoiceInput

    # Create a voice input for user 1
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="user1's input",
        status="failed",
    )
    db.add(voice_input)
    db.commit()
    voice_id = voice_input.id

    # Create a second user
    user2_response = client.post(
        "/api/v1/auth/register",
        json={"email": "user2@example.com", "password": "testpass123", "name": "User 2"},
    )
    assert user2_response.status_code == 201
    user2_token = user2_response.json()["access_token"]
    user2_headers = {"Authorization": f"Bearer {user2_token}"}

    # Try to delete with user 2's auth
    response = client.delete(f"/api/v1/voice/{voice_id}", headers=user2_headers)
    assert response.status_code == 403


def test_retry_voice_input(client, auth_headers, db):
    """Test retrying a failed voice input."""
    user_id = auth_headers.user_id

    from src.models.voice_input import VoiceInput

    # Create a failed voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="orignal typo text",
        status="failed",
        error_message="Parse error",
    )
    db.add(voice_input)
    db.commit()
    voice_id = voice_input.id

    # Retry with corrected text
    with patch("src.tasks.voice_processing.process_voice_input.delay") as mock_task:
        response = client.post(
            f"/api/v1/voice/{voice_id}/retry",
            headers=auth_headers,
            json={"raw_text": "original corrected text"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pending"
        assert data["raw_text"] == "original corrected text"
        assert data["error_message"] is None
        # Verify task was triggered
        mock_task.assert_called_once()


def test_retry_voice_input_not_found(client, auth_headers):
    """Test retrying a non-existent voice input."""
    response = client.post(
        "/api/v1/voice/99999/retry",
        headers=auth_headers,
        json={"raw_text": "test"},
    )
    assert response.status_code == 404


def test_retry_voice_input_unauthorized(client, auth_headers, db):
    """Test that users cannot retry other users' voice inputs."""
    user_id = auth_headers.user_id

    from src.models.voice_input import VoiceInput

    # Create a voice input for user 1
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="user1's input",
        status="failed",
    )
    db.add(voice_input)
    db.commit()
    voice_id = voice_input.id

    # Create a second user
    user2_response = client.post(
        "/api/v1/auth/register",
        json={"email": "user2-retry@example.com", "password": "testpass123", "name": "User 2"},
    )
    assert user2_response.status_code == 201
    user2_token = user2_response.json()["access_token"]
    user2_headers = {"Authorization": f"Bearer {user2_token}"}

    # Try to retry with user 2's auth
    response = client.post(
        f"/api/v1/voice/{voice_id}/retry",
        headers=user2_headers,
        json={"raw_text": "hacked"},
    )
    assert response.status_code == 403


def test_retry_voice_input_already_completed(client, auth_headers, db):
    """Test that completed voice inputs cannot be retried."""
    user_id = auth_headers.user_id

    from src.models.voice_input import VoiceInput

    # Create a completed voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="completed input",
        status="completed",
    )
    db.add(voice_input)
    db.commit()
    voice_id = voice_input.id

    response = client.post(
        f"/api/v1/voice/{voice_id}/retry",
        headers=auth_headers,
        json={"raw_text": "try again"},
    )
    assert response.status_code == 400


def test_confirm_task_list_pending_confirmation(client, auth_headers, db):
    """Test confirming a pending confirmation for a task list."""
    user_id = auth_headers.user_id

    # Create a task list
    list_response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "My Tasks", "icon": "✅", "list_type": "task"},
    )
    list_id = list_response.json()["id"]

    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="add call dentist tomorrow to my tasks",
        status="completed",
    )
    db.add(voice_input)
    db.flush()

    # Create pending confirmation with task fields
    pending = PendingConfirmation(
        user_id=user_id,
        voice_input_id=voice_input.id,
        proposed_changes={
            "action": "add",
            "list_id": list_id,
            "list_name": "My Tasks",
            "list_type": "task",
            "items": [
                {
                    "name": "call dentist",
                    "due_date": "2025-01-02T09:00:00",
                    "reminder_offset": "1h",
                    "recurrence_pattern": None,
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

    # Verify task item was created with task fields
    items_response = client.get(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
    )
    items = items_response.json()
    assert len(items) == 1
    assert items[0]["name"] == "call dentist"
    assert items[0]["due_date"] is not None
    assert "2025-01-02" in items[0]["due_date"]
    assert items[0]["reminder_offset"] == "1h"
    assert items[0]["category_id"] is None  # Tasks don't have categories


def test_confirm_task_list_with_recurrence(client, auth_headers, db):
    """Test confirming a task list item with recurrence."""
    user_id = auth_headers.user_id

    # Create a task list
    list_response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Daily Tasks", "icon": "🔄", "list_type": "task"},
    )
    list_id = list_response.json()["id"]

    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="add take vitamins every day",
        status="completed",
    )
    db.add(voice_input)
    db.flush()

    # Create pending confirmation with recurrence
    pending = PendingConfirmation(
        user_id=user_id,
        voice_input_id=voice_input.id,
        proposed_changes={
            "action": "add",
            "list_id": list_id,
            "list_name": "Daily Tasks",
            "list_type": "task",
            "items": [
                {
                    "name": "take vitamins",
                    "due_date": "2025-01-01T08:00:00",
                    "reminder_offset": None,
                    "recurrence_pattern": "daily",
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

    # Verify task item was created with recurrence
    items_response = client.get(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
    )
    items = items_response.json()
    assert len(items) == 1
    assert items[0]["name"] == "take vitamins"
    assert items[0]["recurrence_pattern"] == "daily"


def test_confirm_task_list_with_edits(client, auth_headers, db):
    """Test confirming a task list with edited item data."""
    user_id = auth_headers.user_id

    # Create a task list
    list_response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Work Tasks", "icon": "💼", "list_type": "task"},
    )
    list_id = list_response.json()["id"]

    from src.models.pending_confirmation import PendingConfirmation
    from src.models.voice_input import VoiceInput

    # Create voice input
    voice_input = VoiceInput(
        user_id=user_id,
        raw_text="add meeting with boss",
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
            "list_name": "Work Tasks",
            "list_type": "task",
            "items": [
                {
                    "name": "meeting with boss",
                    "due_date": None,
                    "reminder_offset": None,
                    "recurrence_pattern": None,
                }
            ],
        },
        status="pending",
    )
    db.add(pending)
    db.commit()
    pending_id = pending.id

    # Confirm with edited data - user adds due date and weekly recurrence
    response = client.post(
        f"/api/v1/voice/pending/{pending_id}/action",
        headers=auth_headers,
        json={
            "action": "confirm",
            "edits": {
                "items": [
                    {
                        "name": "Weekly meeting with boss",
                        "due_date": "2025-01-06T10:00:00",
                        "reminder_offset": "30m",
                        "recurrence_pattern": "weekly",
                    }
                ]
            },
        },
    )

    assert response.status_code == 200

    # Verify task item was created with edited data
    items_response = client.get(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
    )
    items = items_response.json()
    assert len(items) == 1
    assert items[0]["name"] == "Weekly meeting with boss"
    assert "2025-01-06" in items[0]["due_date"]
    assert items[0]["reminder_offset"] == "30m"
    assert items[0]["recurrence_pattern"] == "weekly"
