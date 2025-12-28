"""Recipe API tests."""


def test_create_recipe(client, auth_headers):
    """Test creating a recipe with ingredients."""
    response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Pasta Carbonara",
            "description": "Classic Italian pasta",
            "servings": 4,
            "ingredients": [
                {"name": "Spaghetti", "quantity": "1 lb"},
                {"name": "Eggs", "quantity": "4"},
                {"name": "Parmesan", "quantity": "1 cup", "store_preference": "Costco"},
            ],
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Pasta Carbonara"
    assert data["servings"] == 4
    assert len(data["ingredients"]) == 3
    assert data["ingredients"][2]["store_preference"] == "Costco"


def test_list_recipes(client, auth_headers):
    """Test listing recipes."""
    # Create a recipe first
    client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test Recipe", "ingredients": [{"name": "Onion"}]},
    )

    response = client.get("/api/v1/recipes", headers=auth_headers)
    assert response.status_code == 200
    recipes = response.json()
    assert len(recipes) == 1
    assert recipes[0]["name"] == "Test Recipe"
    assert recipes[0]["ingredient_count"] == 1


def test_get_recipe(client, auth_headers):
    """Test getting a specific recipe."""
    create_response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "ingredients": [{"name": "Flour", "quantity": "2 cups"}],
        },
    )
    recipe_id = create_response.json()["id"]

    response = client.get(f"/api/v1/recipes/{recipe_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Test Recipe"
    assert len(response.json()["ingredients"]) == 1


def test_update_recipe(client, auth_headers):
    """Test updating recipe metadata."""
    create_response = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Old Name"}
    )
    recipe_id = create_response.json()["id"]

    response = client.put(
        f"/api/v1/recipes/{recipe_id}",
        headers=auth_headers,
        json={"name": "New Name", "servings": 6},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["servings"] == 6


def test_delete_recipe(client, auth_headers):
    """Test soft deleting a recipe."""
    create_response = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "To Delete"}
    )
    recipe_id = create_response.json()["id"]

    response = client.delete(f"/api/v1/recipes/{recipe_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's not in the list anymore
    recipes = client.get("/api/v1/recipes", headers=auth_headers).json()
    assert not any(r["id"] == recipe_id for r in recipes)


def test_add_ingredient(client, auth_headers):
    """Test adding an ingredient to a recipe."""
    create_response = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Test Recipe"}
    )
    recipe_id = create_response.json()["id"]

    response = client.post(
        f"/api/v1/recipes/{recipe_id}/ingredients",
        headers=auth_headers,
        json={"name": "Salt", "quantity": "1 tsp", "description": "For seasoning"},
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Salt"
    assert response.json()["quantity"] == "1 tsp"


def test_update_ingredient(client, auth_headers):
    """Test updating an ingredient."""
    create_response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "Old Name", "quantity": "1"}]},
    )
    ingredient_id = create_response.json()["ingredients"][0]["id"]

    response = client.put(
        f"/api/v1/recipes/ingredients/{ingredient_id}",
        headers=auth_headers,
        json={"name": "New Name", "quantity": "2"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["quantity"] == "2"


def test_delete_ingredient(client, auth_headers):
    """Test deleting an ingredient."""
    create_response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "To Delete"}]},
    )
    recipe_id = create_response.json()["id"]
    ingredient_id = create_response.json()["ingredients"][0]["id"]

    response = client.delete(f"/api/v1/recipes/ingredients/{ingredient_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's gone
    recipe = client.get(f"/api/v1/recipes/{recipe_id}", headers=auth_headers).json()
    assert len(recipe["ingredients"]) == 0


def test_add_recipe_to_list_creates_lists(client, auth_headers):
    """Test that adding to list creates Grocery/Costco lists if needed."""
    # Create recipe
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test",
            "ingredients": [{"name": "Milk", "quantity": "1 gallon"}],
        },
    ).json()

    # Add to list
    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["grocery_items_added"] == 1
    assert result["event_id"] is not None

    # Verify Grocery list exists
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    assert any(lst["name"] == "Grocery" for lst in lists)


def test_add_recipe_respects_store_preference(client, auth_headers):
    """Test ingredient store preference routing."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test",
            "ingredients": [
                {"name": "Milk", "quantity": "1 gallon"},  # Default: Grocery
                {"name": "Cheese", "quantity": "2 lb", "store_preference": "Costco"},
            ],
        },
    ).json()

    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    result = response.json()
    assert result["grocery_items_added"] == 1
    assert result["costco_items_added"] == 1


def test_duplicate_ingredients_merged_within_recipe_batch(client, auth_headers):
    """Test that same ingredient from multiple recipes is merged."""
    recipe1 = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Recipe 1",
            "ingredients": [{"name": "Onion", "quantity": "2"}],
        },
    ).json()

    recipe2 = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Recipe 2",
            "ingredients": [{"name": "Onion", "quantity": "1"}],
        },
    ).json()

    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe1["id"], recipe2["id"]]},
    )
    result = response.json()
    # Should be 1 item (merged), not 2
    assert result["grocery_items_added"] == 1
    assert result["items_merged"] == 0  # Merged within the batch, but new on list

    # Verify quantity is combined
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    onion = next(i for i in items if "onion" in i["name"].lower())
    assert onion["quantity"] == "2 + 1"


def test_item_tracks_recipe_sources(client, auth_headers):
    """Test that items track which recipes they came from."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Pasta",
            "ingredients": [{"name": "Tomatoes", "quantity": "4"}],
        },
    ).json()

    client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )

    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    tomatoes = next(i for i in items if "tomato" in i["name"].lower())

    assert tomatoes["recipe_sources"] is not None
    assert len(tomatoes["recipe_sources"]) == 1
    assert tomatoes["recipe_sources"][0]["recipe_name"] == "Pasta"


def test_add_to_existing_item_merges(client, auth_headers):
    """Test adding ingredient that already exists on list."""
    # Create Grocery list and add milk
    grocery = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Grocery", "icon": "🛒"}
    ).json()
    client.post(
        f"/api/v1/lists/{grocery['id']}/items",
        headers=auth_headers,
        json={"name": "Milk", "quantity": "1 gallon"},
    )

    # Create recipe with milk
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Smoothie",
            "ingredients": [{"name": "Milk", "quantity": "2 cups"}],
        },
    ).json()

    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    result = response.json()
    assert result["items_merged"] == 1
    assert result["grocery_items_added"] == 0

    # Verify quantity is combined
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    milk = next(i for i in items if "milk" in i["name"].lower())
    assert milk["quantity"] == "1 gallon + 2 cups"


def test_undo_deletes_created_items(client, auth_headers):
    """Test that undo deletes items that were created."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test",
            "ingredients": [{"name": "Butter", "quantity": "1 stick"}],
        },
    ).json()

    # Add to list
    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # Verify item exists
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    assert len(items) == 1

    # Undo
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)
    assert response.status_code == 200

    # Verify item is deleted
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    assert len(items) == 0


def test_undo_restores_merged_items(client, auth_headers):
    """Test that undo restores merged items to original state."""
    # Create Grocery list and add eggs
    grocery = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "Grocery", "icon": "🛒"}
    ).json()
    client.post(
        f"/api/v1/lists/{grocery['id']}/items",
        headers=auth_headers,
        json={"name": "Eggs", "quantity": "1 dozen"},
    )

    # Create recipe with eggs
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Cake",
            "ingredients": [{"name": "Eggs", "quantity": "3"}],
        },
    ).json()

    # Add to list (merges)
    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # Verify merged
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    eggs = next(i for i in items if "egg" in i["name"].lower())
    assert eggs["quantity"] == "1 dozen + 3"

    # Undo
    client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)

    # Verify restored to original
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    eggs = next(i for i in items if "egg" in i["name"].lower())
    assert eggs["quantity"] == "1 dozen"
    assert eggs["recipe_sources"] is None


def test_cannot_undo_twice(client, auth_headers):
    """Test that the same event cannot be undone twice."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test",
            "ingredients": [{"name": "Sugar"}],
        },
    ).json()

    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # First undo succeeds
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)
    assert response.status_code == 200

    # Second undo fails
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)
    assert response.status_code == 400
    assert "already undone" in response.json()["detail"]


def test_store_defaults(client, auth_headers):
    """Test setting and using store defaults."""
    # Set default for cheese to Costco
    response = client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Cheese", "store_preference": "Costco"},
    )
    assert response.status_code == 201
    assert response.json()["store_preference"] == "Costco"

    # Create recipe with cheese (no store_preference)
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Nachos",
            "ingredients": [{"name": "Cheese", "quantity": "1 lb"}],
        },
    ).json()

    # Add to list
    result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()

    # Should go to Costco
    assert result["costco_items_added"] == 1
    assert result["grocery_items_added"] == 0


def test_store_preference_override_beats_default(client, auth_headers):
    """Test that recipe-level store preference overrides global default."""
    # Set default for milk to Costco
    client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Milk", "store_preference": "Costco"},
    )

    # Create recipe with milk, but override to Grocery
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Cereal",
            "ingredients": [
                {"name": "Milk", "quantity": "1 gallon", "store_preference": "Grocery"}
            ],
        },
    ).json()

    # Add to list
    result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()

    # Should go to Grocery (override wins)
    assert result["grocery_items_added"] == 1
    assert result["costco_items_added"] == 0


def test_list_store_defaults(client, auth_headers):
    """Test listing store defaults."""
    # Create some defaults
    client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Paper Towels", "store_preference": "Costco"},
    )
    client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Toilet Paper", "store_preference": "Costco"},
    )

    response = client.get("/api/v1/recipes/store-defaults", headers=auth_headers)
    assert response.status_code == 200
    defaults = response.json()
    assert len(defaults) == 2


def test_list_add_events(client, auth_headers):
    """Test listing recent add events."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "Salt"}]},
    ).json()

    client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )

    response = client.get("/api/v1/recipes/add-events", headers=auth_headers)
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 1
    assert events[0]["undone_at"] is None


def test_skip_ingredients_like_water(client, auth_headers):
    """Test that common pantry items like water are skipped."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Pasta",
            "ingredients": [
                {"name": "Spaghetti", "quantity": "1 lb"},
                {"name": "Water", "quantity": "4 cups"},  # Should be skipped
                {"name": "Salt", "quantity": "1 tsp"},
                {"name": "Ice cubes"},  # Should be skipped
            ],
        },
    ).json()

    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    result = response.json()

    # Should skip water and ice cubes
    assert result["items_skipped"] == 2
    assert result["grocery_items_added"] == 2  # Only spaghetti and salt

    # Verify the items on the list
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()

    item_names = [i["name"].lower() for i in items]
    assert "spaghetti" in item_names
    assert "salt" in item_names
    assert "water" not in item_names
    assert "ice cubes" not in item_names


def test_update_recipe_color_propagates_to_items(client, auth_headers):
    """Test that updating a recipe's color updates items that reference it."""
    # Create recipe with initial color
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Pasta",
            "ingredients": [{"name": "Tomatoes", "quantity": "4"}],
        },
    ).json()
    recipe_id = recipe["id"]
    original_color = recipe["label_color"]

    # Add to list
    client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe_id]},
    )

    # Verify item has original color
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    tomatoes = next(i for i in items if "tomato" in i["name"].lower())
    assert tomatoes["recipe_sources"][0]["label_color"] == original_color

    # Update recipe color
    new_color = "#911eb4"  # Purple
    client.put(
        f"/api/v1/recipes/{recipe_id}",
        headers=auth_headers,
        json={"label_color": new_color},
    )

    # Verify item now has updated color
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    tomatoes = next(i for i in items if "tomato" in i["name"].lower())
    assert tomatoes["recipe_sources"][0]["label_color"] == new_color


# =============================================================================
# Recipe Add/Undo Edge Case Tests
# =============================================================================


def test_add_deleted_recipe_fails(client, auth_headers):
    """Test that adding a soft-deleted recipe returns 404."""
    # Create and delete a recipe
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Deleted Recipe", "ingredients": [{"name": "Salt"}]},
    ).json()
    recipe_id = recipe["id"]

    client.delete(f"/api/v1/recipes/{recipe_id}", headers=auth_headers)

    # Try to add deleted recipe to list
    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe_id]},
    )
    assert response.status_code == 404
    assert "No valid recipes found" in response.json()["detail"]


def test_add_recipe_with_empty_ingredients(client, auth_headers):
    """Test adding a recipe with no ingredients."""
    # Create recipe without ingredients
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Empty Recipe"},
    ).json()

    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["grocery_items_added"] == 0
    assert result["costco_items_added"] == 0


def test_add_recipe_with_nonexistent_ids(client, auth_headers):
    """Test adding non-existent recipe IDs returns 404."""
    response = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [99999, 99998]},
    )
    assert response.status_code == 404


def test_undo_nonexistent_event_fails(client, auth_headers):
    """Test undoing a non-existent event returns 404."""
    response = client.post("/api/v1/recipes/add-events/99999/undo", headers=auth_headers)
    assert response.status_code == 404


def test_undo_other_users_event_fails(client, auth_headers):
    """Test that User A cannot undo User B's add event."""
    import uuid

    # User A creates recipe and adds to list
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "User A Recipe", "ingredients": [{"name": "Flour"}]},
    ).json()

    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # Create User B with unique email
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"undotest-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to undo User A's event
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=user_b_headers)
    assert response.status_code == 404


def test_undo_after_item_manually_deleted(client, auth_headers):
    """Test undoing when item was already manually deleted."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "Pepper"}]},
    ).json()

    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # Get and delete the item manually
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    item_id = items[0]["id"]
    client.delete(f"/api/v1/items/{item_id}", headers=auth_headers)

    # Undo should still succeed (gracefully handle missing item)
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)
    assert response.status_code == 200


def test_undo_after_item_checked(client, auth_headers):
    """Test undoing when item was checked off."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "Garlic"}]},
    ).json()

    add_result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    ).json()
    event_id = add_result["event_id"]

    # Check the item
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(
        f"/api/v1/lists/{grocery['id']}/items?include_checked=true", headers=auth_headers
    ).json()
    item_id = items[0]["id"]
    client.post(f"/api/v1/items/{item_id}/check", headers=auth_headers)

    # Undo should still work
    response = client.post(f"/api/v1/recipes/add-events/{event_id}/undo", headers=auth_headers)
    assert response.status_code == 200

    # Item should be soft deleted
    items = client.get(
        f"/api/v1/lists/{grocery['id']}/items?include_checked=true", headers=auth_headers
    ).json()
    assert len(items) == 0


def test_add_recipe_same_ingredient_different_stores(client, auth_headers):
    """Test that same ingredient with different store preferences creates separate items."""
    # Set default for milk to Costco
    client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Milk", "store_preference": "Costco"},
    )

    # Create two recipes with milk - one override to Grocery, one uses default
    recipe1 = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Recipe 1",
            "ingredients": [
                {"name": "Milk", "quantity": "1 gallon", "store_preference": "Grocery"}
            ],
        },
    ).json()

    recipe2 = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Recipe 2",
            "ingredients": [{"name": "Milk", "quantity": "2 gallons"}],  # Uses Costco default
        },
    ).json()

    result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe1["id"], recipe2["id"]]},
    ).json()

    # Should have 1 item on Grocery and 1 on Costco
    assert result["grocery_items_added"] == 1
    assert result["costco_items_added"] == 1


def test_add_multiple_recipes_batch_merging(client, auth_headers):
    """Test that multiple recipes with same ingredients merge correctly in batch."""
    recipes = []
    for i in range(3):
        recipe = client.post(
            "/api/v1/recipes",
            headers=auth_headers,
            json={
                "name": f"Recipe {i + 1}",
                "ingredients": [
                    {"name": "Onion", "quantity": f"{i + 1}"},
                    {"name": "Garlic", "quantity": f"{i + 1} cloves"},
                ],
            },
        ).json()
        recipes.append(recipe)

    result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [r["id"] for r in recipes]},
    ).json()

    # Should create 2 items (onion and garlic), each merged from 3 recipes
    assert result["grocery_items_added"] == 2

    # Verify quantities are combined
    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()

    onion = next(i for i in items if "onion" in i["name"].lower())
    # All three quantities should be present in the merged quantity string
    assert "1" in onion["quantity"]
    assert "2" in onion["quantity"]
    assert "3" in onion["quantity"]

    # Verify recipe sources
    assert len(onion["recipe_sources"]) == 3


def test_recipe_sources_deduplication(client, auth_headers):
    """Test that adding same recipe twice doesn't duplicate sources."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test", "ingredients": [{"name": "Oregano"}]},
    ).json()

    # Add twice
    client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )

    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    oregano = next(i for i in items if "oregano" in i["name"].lower())

    # Should only have one recipe source (deduplicated)
    assert len(oregano["recipe_sources"]) == 1


def test_ingredient_override_skip(client, auth_headers):
    """Test that ingredient_overrides can skip specific ingredients."""
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test",
            "ingredients": [
                {"name": "Flour", "quantity": "2 cups"},
                {"name": "Sugar", "quantity": "1 cup"},
                {"name": "Butter", "quantity": "1 stick"},
            ],
        },
    ).json()

    # Skip flour and butter
    result = client.post(
        "/api/v1/recipes/add-to-list",
        headers=auth_headers,
        json={
            "recipe_ids": [recipe["id"]],
            "ingredient_overrides": [
                {"name": "Flour", "add_to_list": False},
                {"name": "Butter", "add_to_list": False},
            ],
        },
    ).json()

    # Only sugar should be added
    assert result["grocery_items_added"] == 1
    assert result["items_skipped"] == 2

    lists = client.get("/api/v1/lists", headers=auth_headers).json()
    grocery = next(lst for lst in lists if lst["name"] == "Grocery")
    items = client.get(f"/api/v1/lists/{grocery['id']}/items", headers=auth_headers).json()
    assert len(items) == 1
    assert "sugar" in items[0]["name"].lower()


def test_recipe_label_color_auto_assignment(client, auth_headers):
    """Test that recipes get auto-assigned colors from the palette."""
    colors_seen = set()

    # Create 11 recipes (more than the 10 colors)
    for i in range(11):
        recipe = client.post(
            "/api/v1/recipes",
            headers=auth_headers,
            json={"name": f"Recipe {i + 1}"},
        ).json()
        colors_seen.add(recipe["label_color"])

    # Should have used 10 unique colors (11th recipe wraps to first color)
    assert len(colors_seen) == 10


def test_update_store_default_replaces_existing(client, auth_headers):
    """Test that updating a store default replaces the existing one."""
    # Set default to Costco
    client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Olive Oil", "store_preference": "Costco"},
    )

    # Update to Grocery
    response = client.post(
        "/api/v1/recipes/store-defaults",
        headers=auth_headers,
        json={"ingredient_name": "Olive Oil", "store_preference": "Grocery"},
    )
    assert response.status_code == 201
    assert response.json()["store_preference"] == "Grocery"

    # Verify only one default exists
    defaults = client.get("/api/v1/recipes/store-defaults", headers=auth_headers).json()
    olive_oil_defaults = [d for d in defaults if "olive oil" in d["normalized_name"]]
    assert len(olive_oil_defaults) == 1
    assert olive_oil_defaults[0]["store_preference"] == "Grocery"
