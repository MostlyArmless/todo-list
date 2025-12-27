"""Pantry API tests."""


def test_create_pantry_item(client, auth_headers):
    """Test creating a pantry item."""
    response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Olive Oil", "status": "have", "category": "Oils"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Olive Oil"
    assert data["normalized_name"] == "olive oil"
    assert data["status"] == "have"
    assert data["category"] == "Oils"


def test_create_pantry_item_defaults(client, auth_headers):
    """Test creating a pantry item with default status."""
    response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Salt"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "have"
    assert data["category"] is None


def test_create_duplicate_pantry_item(client, auth_headers):
    """Test that duplicate pantry items are rejected."""
    client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Garlic"},
    )

    # Try to add the same item again
    response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "garlic"},  # different case
    )
    assert response.status_code == 409  # Conflict


def test_list_pantry_items(client, auth_headers):
    """Test listing pantry items."""
    # Create some items
    client.post("/api/v1/pantry", headers=auth_headers, json={"name": "Sugar", "category": "Baking"})
    client.post("/api/v1/pantry", headers=auth_headers, json={"name": "Flour", "category": "Baking"})
    client.post("/api/v1/pantry", headers=auth_headers, json={"name": "Salt"})

    response = client.get("/api/v1/pantry", headers=auth_headers)
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 3


def test_get_pantry_item(client, auth_headers):
    """Test getting a specific pantry item."""
    create_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Pepper"},
    )
    item_id = create_response.json()["id"]

    response = client.get(f"/api/v1/pantry/{item_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Pepper"


def test_update_pantry_item(client, auth_headers):
    """Test updating a pantry item."""
    create_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Cumin", "status": "have"},
    )
    item_id = create_response.json()["id"]

    response = client.put(
        f"/api/v1/pantry/{item_id}",
        headers=auth_headers,
        json={"status": "low"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "low"


def test_update_pantry_item_name(client, auth_headers):
    """Test updating pantry item name updates normalized_name."""
    create_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Old Name"},
    )
    item_id = create_response.json()["id"]

    response = client.put(
        f"/api/v1/pantry/{item_id}",
        headers=auth_headers,
        json={"name": "NEW NAME"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "NEW NAME"
    assert response.json()["normalized_name"] == "new name"


def test_delete_pantry_item(client, auth_headers):
    """Test deleting a pantry item."""
    create_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "To Delete"},
    )
    item_id = create_response.json()["id"]

    response = client.delete(f"/api/v1/pantry/{item_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's gone
    items = client.get("/api/v1/pantry", headers=auth_headers).json()
    assert not any(i["id"] == item_id for i in items)


def test_bulk_add_pantry_items(client, auth_headers):
    """Test bulk adding items to pantry."""
    response = client.post(
        "/api/v1/pantry/bulk",
        headers=auth_headers,
        json={
            "items": [
                {"name": "Rice", "status": "have"},
                {"name": "Pasta", "status": "low"},
                {"name": "Beans"},
            ]
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["added"] == 3
    assert data["updated"] == 0
    assert len(data["items"]) == 3


def test_bulk_add_updates_existing(client, auth_headers):
    """Test that bulk add updates existing items to 'have' status."""
    # Create an item with 'out' status
    client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Milk", "status": "out"},
    )

    # Bulk add including Milk
    response = client.post(
        "/api/v1/pantry/bulk",
        headers=auth_headers,
        json={
            "items": [
                {"name": "Milk"},  # same item
                {"name": "Eggs"},  # new item
            ]
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["added"] == 1  # Only Eggs added
    assert data["updated"] == 1  # Milk updated

    # Verify Milk is now 'have'
    items = client.get("/api/v1/pantry", headers=auth_headers).json()
    milk = next(i for i in items if i["normalized_name"] == "milk")
    assert milk["status"] == "have"


def test_pantry_item_not_found(client, auth_headers):
    """Test 404 for non-existent pantry item."""
    response = client.get("/api/v1/pantry/99999", headers=auth_headers)
    assert response.status_code == 404


def test_status_cycle(client, auth_headers):
    """Test cycling through status values."""
    create_response = client.post(
        "/api/v1/pantry",
        headers=auth_headers,
        json={"name": "Test Item", "status": "have"},
    )
    item_id = create_response.json()["id"]

    # Update to low
    response = client.put(f"/api/v1/pantry/{item_id}", headers=auth_headers, json={"status": "low"})
    assert response.json()["status"] == "low"

    # Update to out
    response = client.put(f"/api/v1/pantry/{item_id}", headers=auth_headers, json={"status": "out"})
    assert response.json()["status"] == "out"

    # Update back to have
    response = client.put(f"/api/v1/pantry/{item_id}", headers=auth_headers, json={"status": "have"})
    assert response.json()["status"] == "have"
