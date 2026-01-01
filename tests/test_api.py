"""API endpoint tests."""


def test_health_check(client):
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_register_user(client):
    """Test user registration."""
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "newuser@example.com", "password": "password123", "name": "New User"},
    )
    assert response.status_code == 201
    assert "access_token" in response.json()


def test_register_duplicate_email(client, auth_headers):
    """Test registration with duplicate email fails."""
    # Try to register with the same email as the auth_headers user
    response = client.post(
        "/api/v1/auth/register",
        json={"email": auth_headers.email, "password": "password123", "name": "Duplicate"},
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_login(client, auth_headers):
    """Test user login."""
    response = client.post(
        "/api/v1/auth/login", json={"email": auth_headers.email, "password": "testpass123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_wrong_password(client, auth_headers):
    """Test login with wrong password."""
    response = client.post(
        "/api/v1/auth/login", json={"email": auth_headers.email, "password": "wrongpass"}
    )
    assert response.status_code == 401


def test_get_current_user(client, auth_headers):
    """Test getting current user info."""
    response = client.get("/api/v1/auth/me", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["email"] == auth_headers.email


def test_create_list(client, auth_headers):
    """Test creating a list."""
    response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Shopping List", "description": "Weekly shopping", "icon": "🛒"},
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Shopping List"


def test_get_lists(client, auth_headers):
    """Test getting all lists."""
    # Create a list first
    client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Test List", "description": "Test", "icon": "📝"},
    )

    response = client.get("/api/v1/lists", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) > 0


def test_create_category(client, auth_headers):
    """Test creating a category."""
    # Create a list first
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test List"})
    list_id = list_response.json()["id"]

    response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "color": "#FFE4B5", "sort_order": 1},
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Dairy"


def test_create_item(client, auth_headers):
    """Test creating an item."""
    # Create a list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shopping"})
    list_id = list_response.json()["id"]

    # Create a category
    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "sort_order": 1},
    )
    category_id = category_response.json()["id"]

    # Create an item
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={
            "name": "Milk",
            "quantity": "1 gallon",
            "category_id": category_id,
        },
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Milk"
    assert response.json()["checked"] is False


def test_check_item(client, auth_headers):
    """Test checking an item."""
    # Create list and item
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    item_response = client.post(
        f"/api/v1/lists/{list_id}/items", headers=auth_headers, json={"name": "Test Item"}
    )
    item_id = item_response.json()["id"]

    # Check the item
    response = client.post(f"/api/v1/items/{item_id}/check", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["checked"] is True
    assert response.json()["checked_at"] is not None


def test_uncheck_item(client, auth_headers):
    """Test unchecking an item."""
    # Create list and item
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    item_response = client.post(
        f"/api/v1/lists/{list_id}/items", headers=auth_headers, json={"name": "Test Item"}
    )
    item_id = item_response.json()["id"]

    # Check then uncheck
    client.post(f"/api/v1/items/{item_id}/check", headers=auth_headers)
    response = client.post(f"/api/v1/items/{item_id}/uncheck", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["checked"] is False
    assert response.json()["checked_at"] is None


def test_unauthorized_access(client):
    """Test that endpoints require authentication."""
    response = client.get("/api/v1/lists")
    assert response.status_code == 401


def test_auth_response_includes_user(client):
    """Test that auth responses include user info."""
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "usertest@example.com", "password": "password123", "name": "User Test"},
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "user" in data
    assert data["user"]["email"] == "usertest@example.com"
    assert data["user"]["name"] == "User Test"


def test_update_category(client, auth_headers):
    """Test updating a category name."""
    # Create list and category
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Old Name", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Update the category
    response = client.put(
        f"/api/v1/categories/{category_id}",
        headers=auth_headers,
        json={"name": "New Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_delete_category(client, auth_headers):
    """Test deleting a category."""
    # Create list and category
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "To Delete", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Delete the category
    response = client.delete(f"/api/v1/categories/{category_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's deleted
    categories = client.get(f"/api/v1/lists/{list_id}/categories", headers=auth_headers)
    assert len(categories.json()) == 0


def test_category_sort_order(client, auth_headers):
    """Test category ordering."""
    # Create list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    # Create categories in specific order
    cat1 = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "First", "sort_order": 0},
    ).json()
    client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Second", "sort_order": 1},
    )
    cat3 = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Third", "sort_order": 2},
    ).json()

    # Reorder: swap first and third
    client.put(f"/api/v1/categories/{cat1['id']}", headers=auth_headers, json={"sort_order": 2})
    client.put(f"/api/v1/categories/{cat3['id']}", headers=auth_headers, json={"sort_order": 0})

    # Verify new order
    categories = client.get(f"/api/v1/lists/{list_id}/categories", headers=auth_headers).json()
    assert categories[0]["name"] == "Third"
    assert categories[1]["name"] == "Second"
    assert categories[2]["name"] == "First"


def test_update_list(client, auth_headers):
    """Test updating a list."""
    # Create list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Old Name", "icon": "📝"}
    )
    list_id = list_response.json()["id"]

    # Update it
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=auth_headers,
        json={"name": "New Name", "description": "Updated description", "icon": "🛒"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Name"
    assert data["description"] == "Updated description"
    assert data["icon"] == "🛒"


def test_delete_list(client, auth_headers):
    """Test deleting a list."""
    # Create list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "To Delete"})
    list_id = list_response.json()["id"]

    # Delete it
    response = client.delete(f"/api/v1/lists/{list_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's not in the lists anymore
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    assert not any(lst["id"] == list_id for lst in lists)


def test_delete_item(client, auth_headers):
    """Test deleting an item."""
    # Create list and item
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    item_response = client.post(
        f"/api/v1/lists/{list_id}/items", headers=auth_headers, json={"name": "To Delete"}
    )
    item_id = item_response.json()["id"]

    # Delete item
    response = client.delete(f"/api/v1/items/{item_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's deleted
    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 0


def test_items_belong_to_correct_list(client, auth_headers):
    """Test that items only show up for their list."""
    # Create two lists
    list1 = client.post("/api/v1/lists", headers=auth_headers, json={"name": "List 1"}).json()
    list2 = client.post("/api/v1/lists", headers=auth_headers, json={"name": "List 2"}).json()

    # Add item to list1
    client.post(
        f"/api/v1/lists/{list1['id']}/items",
        headers=auth_headers,
        json={"name": "Item in List 1"},
    )

    # Get items from list2
    items = client.get(f"/api/v1/lists/{list2['id']}/items", headers=auth_headers).json()
    assert len(items) == 0


def test_item_creation_uses_history_for_category(client, auth_headers, db):
    """Test that creating an item without category_id uses item history to assign category."""
    from src.models.item_history import ItemHistory

    # Create list and category
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shopping"})
    list_id = list_response.json()["id"]

    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "sort_order": 1},
    )
    category_id = category_response.json()["id"]

    # Add history record for "milk" -> Dairy
    history = ItemHistory(
        list_id=list_id,
        category_id=category_id,
        normalized_name="milk",
        occurrence_count=5,
    )
    db.add(history)
    db.commit()

    # Create an item named "Milk" without specifying category_id
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Milk"},  # No category_id provided
    )
    assert item_response.status_code == 201
    item = item_response.json()

    # The item should have been assigned the category from history
    assert (
        item["category_id"] == category_id
    ), f"Expected category_id {category_id} from history, got {item['category_id']}"


def test_item_creation_without_history_stays_uncategorized(client, auth_headers):
    """Test that creating an item without history and without category_id stays uncategorized."""
    # Create list (no categories, no history)
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test"})
    list_id = list_response.json()["id"]

    # Create an item without specifying category_id
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Random Item"},
    )
    assert item_response.status_code == 201
    item = item_response.json()

    # The item should have no category
    assert item["category_id"] is None


def test_item_creation_explicit_category_overrides_history(client, auth_headers, db):
    """Test that explicitly providing category_id overrides history lookup."""
    from src.models.item_history import ItemHistory

    # Create list and two categories
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shopping"})
    list_id = list_response.json()["id"]

    dairy_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "sort_order": 1},
    )
    dairy_id = dairy_response.json()["id"]

    produce_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Produce", "sort_order": 2},
    )
    produce_id = produce_response.json()["id"]

    # Add history record for "apples" -> Dairy (incorrect, but testing override)
    history = ItemHistory(
        list_id=list_id,
        category_id=dairy_id,
        normalized_name="apples",
        occurrence_count=3,
    )
    db.add(history)
    db.commit()

    # Create item with explicit category_id (Produce)
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Apples", "category_id": produce_id},
    )
    assert item_response.status_code == 201
    item = item_response.json()

    # The item should use the explicitly provided category, not history
    assert item["category_id"] == produce_id


def test_list_unchecked_count(client, auth_headers):
    """Test that lists include unchecked_count field."""
    # Create a list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test List"})
    assert list_response.status_code == 201
    list_data = list_response.json()
    list_id = list_data["id"]

    # New list should have unchecked_count of 0
    assert "unchecked_count" in list_data
    assert list_data["unchecked_count"] == 0

    # Add 3 unchecked items
    for i in range(3):
        client.post(
            f"/api/v1/lists/{list_id}/items",
            headers=auth_headers,
            json={"name": f"Item {i + 1}"},
        )

    # Get the list and verify unchecked_count is 3
    get_response = client.get(f"/api/v1/lists/{list_id}", headers=auth_headers)
    assert get_response.status_code == 200
    assert get_response.json()["unchecked_count"] == 3

    # Also verify via get_lists endpoint
    lists_response = client.get("/api/v1/lists", headers=auth_headers)
    assert lists_response.status_code == 200
    test_list = next(lst for lst in lists_response.json() if lst["id"] == list_id)
    assert test_list["unchecked_count"] == 3

    # Check one item
    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    item_id = items[0]["id"]
    client.post(f"/api/v1/items/{item_id}/check", headers=auth_headers)

    # Verify unchecked_count is now 2
    get_response = client.get(f"/api/v1/lists/{list_id}", headers=auth_headers)
    assert get_response.json()["unchecked_count"] == 2

    # Delete one item
    item_id_to_delete = items[1]["id"]
    client.delete(f"/api/v1/items/{item_id_to_delete}", headers=auth_headers)

    # Verify unchecked_count is now 1
    get_response = client.get(f"/api/v1/lists/{list_id}", headers=auth_headers)
    assert get_response.json()["unchecked_count"] == 1


# =============================================================================
# Cross-User Data Isolation Tests (IDOR Prevention)
# =============================================================================


def test_user_cannot_access_other_users_list(client, auth_headers):
    """Test that User A cannot access User B's list (IDOR prevention)."""
    import uuid

    # User A creates a list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "User A List"})
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to GET User A's list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 404

    # User B tries to UPDATE User A's list
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=user_b_headers,
        json={"name": "Hacked Name"},
    )
    assert response.status_code == 404

    # User B tries to DELETE User A's list
    response = client.delete(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 404


def test_user_cannot_access_other_users_items(client, auth_headers):
    """Test that User A cannot access/modify User B's items."""
    import uuid

    # User A creates list and item
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "User A List"})
    list_id = list_response.json()["id"]
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "User A Item"},
    )
    item_id = item_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to check User A's item
    response = client.post(f"/api/v1/items/{item_id}/check", headers=user_b_headers)
    assert response.status_code == 404

    # User B tries to uncheck User A's item
    response = client.post(f"/api/v1/items/{item_id}/uncheck", headers=user_b_headers)
    assert response.status_code == 404

    # User B tries to update User A's item
    response = client.put(
        f"/api/v1/items/{item_id}",
        headers=user_b_headers,
        json={"name": "Hacked Item"},
    )
    assert response.status_code == 404

    # User B tries to delete User A's item
    response = client.delete(f"/api/v1/items/{item_id}", headers=user_b_headers)
    assert response.status_code == 404


def test_user_cannot_access_other_users_categories(client, auth_headers):
    """Test that User A cannot access/modify User B's categories."""
    import uuid

    # User A creates list and category
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "User A List"})
    list_id = list_response.json()["id"]
    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "User A Category", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to update User A's category
    response = client.put(
        f"/api/v1/categories/{category_id}",
        headers=user_b_headers,
        json={"name": "Hacked Category"},
    )
    assert response.status_code == 404

    # User B tries to delete User A's category
    response = client.delete(f"/api/v1/categories/{category_id}", headers=user_b_headers)
    assert response.status_code == 404


def test_user_cannot_access_other_users_recipes(client, auth_headers):
    """Test that User A cannot access/modify User B's recipes."""
    import uuid

    # User A creates a recipe
    recipe_response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "User A Recipe", "ingredients": [{"name": "Salt"}]},
    )
    recipe_id = recipe_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to GET User A's recipe
    response = client.get(f"/api/v1/recipes/{recipe_id}", headers=user_b_headers)
    assert response.status_code == 404

    # User B tries to UPDATE User A's recipe
    response = client.put(
        f"/api/v1/recipes/{recipe_id}",
        headers=user_b_headers,
        json={"name": "Hacked Recipe"},
    )
    assert response.status_code == 404

    # User B tries to DELETE User A's recipe
    response = client.delete(f"/api/v1/recipes/{recipe_id}", headers=user_b_headers)
    assert response.status_code == 404


def test_user_cannot_access_other_users_pantry(client, auth_headers):
    """Test that User A cannot access/modify User B's pantry items."""
    import uuid

    # User A creates a pantry item
    pantry_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "User A Pantry Item"},
    )
    pantry_id = pantry_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to GET User A's pantry item
    response = client.get(f"/api/v1/pantry/{pantry_id}", headers=user_b_headers)
    assert response.status_code == 404

    # User B tries to UPDATE User A's pantry item
    response = client.put(
        f"/api/v1/pantry/{pantry_id}",
        headers=user_b_headers,
        json={"status": "out"},
    )
    assert response.status_code == 404

    # User B tries to DELETE User A's pantry item
    response = client.delete(f"/api/v1/pantry/{pantry_id}", headers=user_b_headers)
    assert response.status_code == 404


def test_user_lists_only_show_own_data(client, auth_headers):
    """Test that listing endpoints only return the user's own data."""
    import uuid

    # User A creates some data
    client.post("/api/v1/lists", headers=auth_headers, json={"name": "User A List"})
    client.post("/api/v1/recipes", headers=auth_headers, json={"name": "User A Recipe"})
    client.post("/api/v1/pantry", headers=auth_headers, json={"name": "User A Pantry"})

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"userb-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B's lists should be empty
    lists = client.get("/api/v1/lists", headers=user_b_headers).json()
    assert len(lists) == 0

    recipes = client.get("/api/v1/recipes", headers=user_b_headers).json()
    assert len(recipes) == 0

    pantry = client.get("/api/v1/pantry", headers=user_b_headers).json()
    assert len(pantry) == 0


# =============================================================================
# JWT Token Edge Case Tests
# =============================================================================


def test_expired_token_returns_401(client):
    """Test that an expired JWT token returns 401."""
    from datetime import UTC, datetime, timedelta

    from jose import jwt

    from src.config import get_settings

    settings = get_settings()

    # Create an expired token
    expire = datetime.now(UTC) - timedelta(hours=1)  # Expired 1 hour ago
    to_encode = {
        "sub": "1",
        "email": "test@example.com",
        "exp": expire,
    }
    expired_token = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    headers = {"Authorization": f"Bearer {expired_token}"}
    response = client.get("/api/v1/lists", headers=headers)
    assert response.status_code == 401


def test_malformed_token_returns_401(client):
    """Test that a malformed JWT token returns 401."""
    # Completely invalid token
    headers = {"Authorization": "Bearer not-a-valid-jwt-token"}
    response = client.get("/api/v1/lists", headers=headers)
    assert response.status_code == 401

    # Valid JWT structure but wrong secret
    from datetime import UTC, datetime, timedelta

    from jose import jwt

    expire = datetime.now(UTC) + timedelta(hours=1)
    to_encode = {"sub": "1", "email": "test@example.com", "exp": expire}
    wrong_secret_token = jwt.encode(to_encode, "wrong-secret-key", algorithm="HS256")

    headers = {"Authorization": f"Bearer {wrong_secret_token}"}
    response = client.get("/api/v1/lists", headers=headers)
    assert response.status_code == 401


def test_token_with_nonexistent_user_returns_401(client, db):
    """Test that a valid token for a deleted/nonexistent user returns 401."""
    from datetime import UTC, datetime, timedelta

    from jose import jwt

    from src.config import get_settings

    settings = get_settings()

    # Create a token for user ID 99999 which doesn't exist
    expire = datetime.now(UTC) + timedelta(hours=1)
    to_encode = {
        "sub": "99999",
        "email": "nonexistent@example.com",
        "exp": expire,
    }
    token = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/api/v1/lists", headers=headers)
    assert response.status_code == 401
    assert "User not found" in response.json()["detail"]


def test_missing_auth_header_returns_401(client):
    """Test that missing Authorization header returns 401."""
    response = client.get("/api/v1/lists")
    assert response.status_code == 401


def test_empty_bearer_token_returns_401(client):
    """Test that empty Bearer token returns 401."""
    headers = {"Authorization": "Bearer "}
    response = client.get("/api/v1/lists", headers=headers)
    assert response.status_code in [401, 403]  # FastAPI may return 403 for empty token


# =============================================================================
# List Sharing Authorization Tests
# =============================================================================


def test_share_list_success(client, auth_headers):
    """Test successfully sharing a list with another user."""
    import uuid

    # User A creates a list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shared List"})
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"shareduser-{unique_id}@example.com"
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User A shares the list with User B
    share_response = client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "edit"},
    )
    assert share_response.status_code == 201

    # User B should now be able to see the list
    lists = client.get("/api/v1/lists", headers=user_b_headers).json()
    assert any(lst["id"] == list_id for lst in lists)

    # User B should be able to get the list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 200


def test_shared_user_view_only_cannot_edit(client, auth_headers):
    """Test that user with 'view' permission cannot edit the list."""
    import uuid

    # User A creates a list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "View Only List"}
    )
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"viewonly-{unique_id}@example.com"
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User A shares the list with User B (view only)
    client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "view"},
    )

    # User B tries to update the list - should fail
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=user_b_headers,
        json={"name": "Hacked Name"},
    )
    assert response.status_code == 403
    assert "permission" in response.json()["detail"].lower()


def test_shared_user_edit_cannot_delete(client, auth_headers):
    """Test that user with 'edit' permission cannot delete the list."""
    import uuid

    # User A creates a list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Edit But No Delete"}
    )
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"editnodelete-{unique_id}@example.com"
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User A shares the list with User B (edit permission)
    client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "edit"},
    )

    # User B can edit the list
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=user_b_headers,
        json={"name": "Updated by B"},
    )
    assert response.status_code == 200

    # User B tries to delete the list - should fail
    response = client.delete(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 403


def test_share_list_nonexistent_email(client, auth_headers):
    """Test sharing with a non-existent email returns 404."""
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test List"})
    list_id = list_response.json()["id"]

    response = client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": "nonexistent@example.com", "permission": "edit"},
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_share_list_already_shared(client, auth_headers):
    """Test that sharing with the same user twice fails."""
    import uuid

    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Test List"})
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"alreadyshared-{unique_id}@example.com"
    client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )

    # Share once - success
    response = client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "edit"},
    )
    assert response.status_code == 201

    # Share again - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "view"},
    )
    assert response.status_code == 400
    assert "already shared" in response.json()["detail"].lower()


def test_non_owner_cannot_share_list(client, auth_headers):
    """Test that only the owner can share a list."""
    import uuid

    # User A creates and shares a list with User B
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Owner Only Share"}
    )
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"notowner-{unique_id}@example.com"
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # Share with User B
    client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "edit"},
    )

    # Create User C with unique email
    user_c_email = f"userc-{unique_id}@example.com"
    client.post(
        "/api/v1/auth/register",
        json={"email": user_c_email, "password": "password123", "name": "User C"},
    )

    # User B (not owner) tries to share with User C - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=user_b_headers,
        json={"user_email": user_c_email, "permission": "edit"},
    )
    assert response.status_code == 403


def test_unshare_list(client, auth_headers):
    """Test unsharing a list removes access."""
    import uuid

    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Unshare Test"}
    )
    list_id = list_response.json()["id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_email = f"unsharetest-{unique_id}@example.com"
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={"email": user_b_email, "password": "password123", "name": "User B"},
    )
    user_b_id = user_b_response.json()["user"]["id"]
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # Share with User B
    client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b_email, "permission": "edit"},
    )

    # User B can access
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 200

    # Unshare
    response = client.delete(f"/api/v1/lists/{list_id}/share/{user_b_id}", headers=auth_headers)
    assert response.status_code == 204

    # User B can no longer access
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b_headers)
    assert response.status_code == 404


# =============================================================================
# Item Merge Logic Tests
# =============================================================================


def test_item_merge_case_insensitive(client, auth_headers):
    """Test that item merging is case-insensitive."""
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Merge Test"})
    list_id = list_response.json()["id"]

    # Create "milk"
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "milk", "quantity": "1 gallon"},
    )

    # Create "MILK" - should merge
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "MILK", "quantity": "2 cups"},
    )
    assert response.status_code == 201

    # Should only have 1 item with merged quantity
    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert "1 gallon" in items[0]["quantity"]
    assert "2 cups" in items[0]["quantity"]


def test_item_merge_preserves_category(client, auth_headers):
    """Test that merging preserves the existing item's category."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Category Merge"}
    )
    list_id = list_response.json()["id"]

    # Create category
    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Dairy", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Create item with category
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Cheese", "category_id": category_id},
    )

    # Merge item without category specified
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "cheese", "quantity": "1 block"},
    )

    # Item should still have the category
    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["category_id"] == category_id


def test_item_merge_without_quantity(client, auth_headers):
    """Test merging items when one or both have no quantity."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "No Quantity Merge"}
    )
    list_id = list_response.json()["id"]

    # Create item without quantity
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Bread"},
    )

    # Merge with quantity
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "bread", "quantity": "2 loaves"},
    )
    assert response.status_code == 201

    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["quantity"] == "2 loaves"


def test_item_merge_both_have_quantities(client, auth_headers):
    """Test merging when both items have quantities."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Both Quantities"}
    )
    list_id = list_response.json()["id"]

    # Create item with quantity
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Eggs", "quantity": "1 dozen"},
    )

    # Merge with different quantity
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "eggs", "quantity": "6"},
    )

    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["quantity"] == "1 dozen + 6"


def test_item_merge_does_not_merge_with_checked_items(client, auth_headers):
    """Test that new items don't merge with checked items."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Checked Merge"}
    )
    list_id = list_response.json()["id"]

    # Create and check an item
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Butter", "quantity": "1 stick"},
    )
    item_id = item_response.json()["id"]
    client.post(f"/api/v1/items/{item_id}/check", headers=auth_headers)

    # Add same item again
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "butter", "quantity": "2 sticks"},
    )

    # Should have 2 items (one checked, one unchecked)
    all_items = client.get(
        f"/api/v1/lists/{list_id}/items?include_checked=true", headers=auth_headers
    ).json()
    assert len(all_items) == 2

    # Unchecked items should have the new butter
    unchecked_items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(unchecked_items) == 1
    assert unchecked_items[0]["quantity"] == "2 sticks"


def test_item_merge_adds_adhoc_source(client, auth_headers):
    """Test that merging adds ad-hoc source marker."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Adhoc Source"}
    )
    list_id = list_response.json()["id"]

    # Create initial item
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Sugar"},
    )

    # Merge
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "sugar", "quantity": "2 cups"},
    )

    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    # Should have ad-hoc source
    assert items[0]["recipe_sources"] is not None
    assert any(s.get("recipe_id") is None for s in items[0]["recipe_sources"])


# =============================================================================
# Category Cascade Tests
# =============================================================================


def test_delete_category_uncategorizes_items(client, auth_headers):
    """Test that deleting a category sets items to uncategorized."""
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Category Delete"}
    )
    list_id = list_response.json()["id"]

    # Create category
    category_response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Produce", "sort_order": 0},
    )
    category_id = category_response.json()["id"]

    # Create item in category
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Apples", "category_id": category_id},
    )

    # Delete category
    client.delete(f"/api/v1/categories/{category_id}", headers=auth_headers)

    # Item should now have no category
    items = client.get(f"/api/v1/lists/{list_id}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["category_id"] is None


# =============================================================================
# List Type Tests
# =============================================================================


def test_create_list_with_type(client, auth_headers):
    """Test creating lists with different types."""
    # Default type is grocery
    response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "My Grocery"})
    assert response.status_code == 201
    assert response.json()["list_type"] == "grocery"

    # Explicit grocery type
    response = client.post(
        "/api/v1/lists",
        headers=auth_headers,
        json={"name": "Shopping", "list_type": "grocery"},
    )
    assert response.status_code == 201
    assert response.json()["list_type"] == "grocery"

    # Task type
    response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "My Tasks", "list_type": "task"}
    )
    assert response.status_code == 201
    assert response.json()["list_type"] == "task"


def test_task_list_blocks_categories(client, auth_headers):
    """Test that task lists don't support categories."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Try to create a category - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/categories",
        headers=auth_headers,
        json={"name": "Work", "sort_order": 0},
    )
    assert response.status_code == 400
    assert "Task lists do not support categories" in response.json()["detail"]

    # Get categories should return empty list
    response = client.get(f"/api/v1/lists/{list_id}/categories", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_task_list_blocks_grocery_fields(client, auth_headers):
    """Test that task lists reject grocery-specific fields."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Try to create item with quantity - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Buy milk", "quantity": "1 gallon"},
    )
    assert response.status_code == 400
    assert "quantity" in response.json()["detail"]

    # Try to create item with category_id - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Clean room", "category_id": 1},
    )
    assert response.status_code == 400
    assert "categories" in response.json()["detail"]


def test_grocery_list_blocks_task_fields(client, auth_headers):
    """Test that grocery lists reject task-specific fields."""
    # Create a grocery list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Shopping", "list_type": "grocery"}
    )
    list_id = list_response.json()["id"]

    # Try to create item with due_date - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Milk", "due_date": "2025-01-15T10:00:00Z"},
    )
    assert response.status_code == 400
    assert "due_date" in response.json()["detail"]

    # Try to create item with recurrence_pattern - should fail
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Milk", "recurrence_pattern": "weekly"},
    )
    assert response.status_code == 400
    assert "recurrence_pattern" in response.json()["detail"]


def test_task_item_with_valid_fields(client, auth_headers):
    """Test creating task items with valid task-specific fields."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Create item with task fields
    response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={
            "name": "Exercise",
            "description": "Go for a run",
            "due_date": "2025-01-15T10:00:00Z",
            "reminder_at": "2025-01-15T09:00:00Z",
            "reminder_offset": "1h",
            "recurrence_pattern": "daily",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Exercise"
    assert data["due_date"] is not None
    assert data["reminder_at"] is not None
    assert data["reminder_offset"] == "1h"
    assert data["recurrence_pattern"] == "daily"
    assert data["quantity"] is None
    assert data["category_id"] is None


def test_task_list_auto_categorize_blocked(client, auth_headers):
    """Test that auto-categorize is blocked for task lists."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Create an item
    client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Exercise"},
    )

    # Try to auto-categorize - should fail
    response = client.post(f"/api/v1/lists/{list_id}/items/auto-categorize", headers=auth_headers)
    assert response.status_code == 400
    assert "Task lists do not support categories" in response.json()["detail"]


def test_complete_task_item(client, auth_headers):
    """Test completing a task item."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Create a task item
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Exercise", "due_date": "2025-01-15T10:00:00Z"},
    )
    item_id = item_response.json()["id"]

    # Complete the task
    response = client.post(f"/api/v1/items/{item_id}/complete", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["checked"] is True
    assert data["completed_at"] is not None


def test_complete_endpoint_blocked_for_grocery(client, auth_headers):
    """Test that complete endpoint only works for task lists."""
    # Create a grocery list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Shopping", "list_type": "grocery"}
    )
    list_id = list_response.json()["id"]

    # Create an item
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items", headers=auth_headers, json={"name": "Milk"}
    )
    item_id = item_response.json()["id"]

    # Try to complete - should fail
    response = client.post(f"/api/v1/items/{item_id}/complete", headers=auth_headers)
    assert response.status_code == 400
    assert "task list items" in response.json()["detail"]


def test_recurring_task_creates_next_occurrence(client, auth_headers):
    """Test that completing a recurring task creates the next occurrence."""
    # Create a task list
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Tasks", "list_type": "task"}
    )
    list_id = list_response.json()["id"]

    # Create a recurring task
    item_response = client.post(
        f"/api/v1/lists/{list_id}/items",
        headers=auth_headers,
        json={
            "name": "Daily Exercise",
            "due_date": "2025-01-15T10:00:00Z",
            "reminder_offset": "1h",
            "recurrence_pattern": "daily",
        },
    )
    item_id = item_response.json()["id"]

    # Complete the task
    client.post(f"/api/v1/items/{item_id}/complete", headers=auth_headers)

    # Get all items - should see the completed one and the new occurrence
    response = client.get(
        f"/api/v1/lists/{list_id}/items?include_checked=true", headers=auth_headers
    )
    items = response.json()

    # Should have 2 items now
    assert len(items) == 2

    # Find the new (unchecked) item
    new_item = next(item for item in items if not item["checked"])
    assert new_item["name"] == "Daily Exercise"
    assert new_item["recurrence_pattern"] == "daily"
    # The new due_date should be 1 day after the original
    assert "2025-01-16" in new_item["due_date"]
    # recurrence_parent_id should point to the original item
    assert new_item["recurrence_parent_id"] == item_id
