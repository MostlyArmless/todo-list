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
