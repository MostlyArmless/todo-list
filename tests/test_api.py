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
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "test@example.com", "password": "password123", "name": "Duplicate"},
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_login(client, auth_headers):
    """Test user login."""
    response = client.post(
        "/api/v1/auth/login", json={"email": "test@example.com", "password": "testpass123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_wrong_password(client, auth_headers):
    """Test login with wrong password."""
    response = client.post(
        "/api/v1/auth/login", json={"email": "test@example.com", "password": "wrongpass"}
    )
    assert response.status_code == 401


def test_get_current_user(client, auth_headers):
    """Test getting current user info."""
    response = client.get("/api/v1/auth/me", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["email"] == "test@example.com"


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
