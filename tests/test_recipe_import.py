"""Recipe import and step completion tests."""

from unittest.mock import patch


def test_create_recipe_import(client, auth_headers):
    """Test creating a recipe import."""
    with patch("src.tasks.recipe_import.process_recipe_import.delay") as mock_task:
        response = client.post(
            "/api/v1/recipes/import",
            headers=auth_headers,
            json={
                "raw_text": "Pasta Carbonara\n\nIngredients:\n- 1 lb spaghetti\n- 4 eggs\n\nInstructions:\n1. Boil pasta\n2. Mix eggs"
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pending"
        assert data["user_id"] == auth_headers.user_id
        mock_task.assert_called_once_with(data["id"])


def test_get_recipe_import_not_found(client, auth_headers):
    """Test getting a non-existent import."""
    response = client.get("/api/v1/recipes/import/99999", headers=auth_headers)
    assert response.status_code == 404


def test_get_recipe_import(client, auth_headers, db):
    """Test getting an import status."""
    from src.models.recipe_import import RecipeImport

    # Create an import directly in db
    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="completed",
        parsed_recipe={
            "name": "Test Recipe",
            "servings": 4,
            "ingredients": [{"name": "Flour", "quantity": "2 cups"}],
            "instructions": "1. Mix ingredients",
        },
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    response = client.get(f"/api/v1/recipes/import/{recipe_import.id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert data["parsed_recipe"]["name"] == "Test Recipe"


def test_confirm_recipe_import_creates_recipe(client, auth_headers, db):
    """Test confirming an import creates a recipe."""
    from src.models.recipe_import import RecipeImport

    # Create a completed import
    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="completed",
        parsed_recipe={
            "name": "Imported Recipe",
            "servings": 4,
            "ingredients": [
                {"name": "Flour", "quantity": "2 cups"},
                {"name": "Sugar", "quantity": "1 cup"},
            ],
            "instructions": "1. Mix flour\n2. Add sugar",
        },
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    # Confirm it
    response = client.post(
        f"/api/v1/recipes/import/{recipe_import.id}/confirm",
        headers=auth_headers,
        json={},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Imported Recipe"
    assert data["servings"] == 4
    assert data["instructions"] == "1. Mix flour\n2. Add sugar"
    assert len(data["ingredients"]) == 2


def test_confirm_recipe_import_with_edits(client, auth_headers, db):
    """Test confirming an import with edits."""
    from src.models.recipe_import import RecipeImport

    # Create a completed import
    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="completed",
        parsed_recipe={
            "name": "Original Name",
            "servings": 4,
            "ingredients": [{"name": "Flour", "quantity": "2 cups"}],
            "instructions": "1. Mix",
        },
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    # Confirm with edits
    response = client.post(
        f"/api/v1/recipes/import/{recipe_import.id}/confirm",
        headers=auth_headers,
        json={
            "name": "Edited Name",
            "servings": 6,
            "instructions": "1. New instructions",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Edited Name"
    assert data["servings"] == 6
    assert data["instructions"] == "1. New instructions"


def test_confirm_pending_import_fails(client, auth_headers, db):
    """Test confirming a pending import fails."""
    from src.models.recipe_import import RecipeImport

    # Create a pending import
    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="pending",
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    response = client.post(
        f"/api/v1/recipes/import/{recipe_import.id}/confirm",
        headers=auth_headers,
        json={},
    )
    assert response.status_code == 404


def test_delete_recipe_import(client, auth_headers, db):
    """Test deleting an import."""
    from src.models.recipe_import import RecipeImport

    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="pending",
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    response = client.delete(f"/api/v1/recipes/import/{recipe_import.id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's gone
    response = client.get(f"/api/v1/recipes/import/{recipe_import.id}", headers=auth_headers)
    assert response.status_code == 404


def test_step_completion_toggle(client, auth_headers):
    """Test toggling step completion."""
    # Create a recipe with instructions
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "instructions": "1. Step one\n2. Step two\n3. Step three",
        },
    ).json()
    recipe_id = recipe["id"]

    # Toggle step 0 on
    response = client.post(f"/api/v1/recipes/{recipe_id}/steps/0/toggle", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["completed"] is True

    # Toggle step 0 off
    response = client.post(f"/api/v1/recipes/{recipe_id}/steps/0/toggle", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["completed"] is False


def test_step_completions_list(client, auth_headers):
    """Test getting list of completed steps."""
    # Create a recipe
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "instructions": "1. Step one\n2. Step two\n3. Step three",
        },
    ).json()
    recipe_id = recipe["id"]

    # Complete some steps
    client.post(f"/api/v1/recipes/{recipe_id}/steps/0/toggle", headers=auth_headers)
    client.post(f"/api/v1/recipes/{recipe_id}/steps/2/toggle", headers=auth_headers)

    # Get completions
    response = client.get(f"/api/v1/recipes/{recipe_id}/step-completions", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert sorted(data["completed_steps"]) == [0, 2]


def test_reset_step_completions(client, auth_headers):
    """Test resetting all step completions."""
    # Create a recipe
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "instructions": "1. Step one\n2. Step two",
        },
    ).json()
    recipe_id = recipe["id"]

    # Complete some steps
    client.post(f"/api/v1/recipes/{recipe_id}/steps/0/toggle", headers=auth_headers)
    client.post(f"/api/v1/recipes/{recipe_id}/steps/1/toggle", headers=auth_headers)

    # Verify they exist
    response = client.get(f"/api/v1/recipes/{recipe_id}/step-completions", headers=auth_headers)
    assert len(response.json()["completed_steps"]) == 2

    # Reset
    response = client.delete(f"/api/v1/recipes/{recipe_id}/step-completions", headers=auth_headers)
    assert response.status_code == 204

    # Verify they're gone
    response = client.get(f"/api/v1/recipes/{recipe_id}/step-completions", headers=auth_headers)
    assert response.json()["completed_steps"] == []


def test_step_toggle_nonexistent_recipe(client, auth_headers):
    """Test toggling step on non-existent recipe."""
    response = client.post("/api/v1/recipes/99999/steps/0/toggle", headers=auth_headers)
    assert response.status_code == 404


def test_recipe_instructions_in_create(client, auth_headers):
    """Test that instructions are included when creating a recipe."""
    response = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "instructions": "1. Do this\n2. Do that",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["instructions"] == "1. Do this\n2. Do that"


def test_recipe_instructions_in_update(client, auth_headers):
    """Test that instructions can be updated."""
    # Create recipe
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Test Recipe"},
    ).json()

    # Update instructions
    response = client.put(
        f"/api/v1/recipes/{recipe['id']}",
        headers=auth_headers,
        json={"instructions": "New instructions"},
    )
    assert response.status_code == 200
    assert response.json()["instructions"] == "New instructions"


def test_recipe_instructions_in_list(client, auth_headers):
    """Test that instructions are included in recipe list."""
    client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Test Recipe",
            "instructions": "Some instructions",
        },
    )

    response = client.get("/api/v1/recipes", headers=auth_headers)
    assert response.status_code == 200
    recipes = response.json()
    assert len(recipes) == 1
    assert recipes[0]["instructions"] == "Some instructions"


def test_other_user_cannot_access_import(client, auth_headers, db):
    """Test that user A cannot access user B's import."""
    import uuid

    from src.models.recipe_import import RecipeImport

    # Create import for user A (auth_headers)
    recipe_import = RecipeImport(
        user_id=auth_headers.user_id,
        raw_text="Test recipe",
        status="completed",
        parsed_recipe={"name": "Test", "ingredients": [], "instructions": ""},
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    # Create user B
    unique_id = uuid.uuid4().hex[:8]
    user_b_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"import-test-{unique_id}@example.com",
            "password": "password123",
            "name": "User B",
        },
    )
    user_b_headers = {"Authorization": f"Bearer {user_b_response.json()['access_token']}"}

    # User B tries to access user A's import
    response = client.get(f"/api/v1/recipes/import/{recipe_import.id}", headers=user_b_headers)
    assert response.status_code == 404
