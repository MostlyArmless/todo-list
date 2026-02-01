"""Family feature tests."""

import uuid


def create_user(client, name="Test User"):
    """Create a user and return headers and user info."""
    unique_email = f"test-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": unique_email, "password": "testpass123", "name": name},
    )
    assert response.status_code == 201
    data = response.json()
    return {
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "user_id": data["user"]["id"],
        "email": unique_email,
    }


# =============================================================================
# Family CRUD Tests
# =============================================================================


def test_create_family(client, auth_headers):
    """Test creating a family."""
    response = client.post(
        "/api/v1/families",
        headers=auth_headers,
        json={"name": "Smith Family"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Smith Family"
    assert data["created_by"] == auth_headers.user_id
    assert data["member_count"] == 1


def test_create_family_already_in_family(client, auth_headers):
    """Test that a user can't create a family if already in one."""
    # Create first family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family 1"})

    # Try to create second family
    response = client.post(
        "/api/v1/families",
        headers=auth_headers,
        json={"name": "Family 2"},
    )
    assert response.status_code == 400
    assert "already in a family" in response.json()["detail"]


def test_get_my_family(client, auth_headers):
    """Test getting current user's family."""
    # Create family
    create_response = client.post(
        "/api/v1/families", headers=auth_headers, json={"name": "My Family"}
    )
    family_id = create_response.json()["id"]

    # Get my family
    response = client.get("/api/v1/families/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == family_id
    assert data["name"] == "My Family"
    assert len(data["members"]) == 1
    assert data["members"][0]["user_id"] == auth_headers.user_id
    assert data["members"][0]["role"] == "admin"


def test_get_my_family_no_family(client, auth_headers):
    """Test getting family when user has none."""
    response = client.get("/api/v1/families/me", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() is None


def test_update_family(client, auth_headers):
    """Test updating family name."""
    # Create family
    create_response = client.post(
        "/api/v1/families", headers=auth_headers, json={"name": "Old Name"}
    )
    family_id = create_response.json()["id"]

    # Update family
    response = client.put(
        f"/api/v1/families/{family_id}",
        headers=auth_headers,
        json={"name": "New Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_update_family_non_admin(client, auth_headers):
    """Test that non-admin can't update family."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Create and add another user
    user_b = create_user(client, "User B")
    client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # User B tries to update - should fail
    response = client.put(
        f"/api/v1/families/{family_id}",
        headers=user_b["headers"],
        json={"name": "New Name"},
    )
    assert response.status_code == 403


def test_delete_family(client, auth_headers):
    """Test deleting a family."""
    # Create family
    create_response = client.post(
        "/api/v1/families", headers=auth_headers, json={"name": "To Delete"}
    )
    family_id = create_response.json()["id"]

    # Delete family
    response = client.delete(f"/api/v1/families/{family_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify deleted
    response = client.get("/api/v1/families/me", headers=auth_headers)
    assert response.json() is None


# =============================================================================
# Family Member Management Tests
# =============================================================================


def test_add_family_member(client, auth_headers):
    """Test adding a member to family."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Create User B
    user_b = create_user(client, "User B")

    # Add User B to family
    response = client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )
    assert response.status_code == 201
    assert response.json()["role"] == "member"
    assert response.json()["user_email"] == user_b["email"]


def test_add_member_already_in_family(client, auth_headers):
    """Test adding a member who is already in a family."""
    # Create family 1
    create_response = client.post(
        "/api/v1/families", headers=auth_headers, json={"name": "Family 1"}
    )
    family_id = create_response.json()["id"]

    # Create User B with their own family
    user_b = create_user(client, "User B")
    client.post("/api/v1/families", headers=user_b["headers"], json={"name": "Family 2"})

    # Try to add User B to Family 1
    response = client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )
    assert response.status_code == 400
    assert "already in another family" in response.json()["detail"]


def test_remove_family_member(client, auth_headers):
    """Test removing a member from family."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Add User B
    user_b = create_user(client, "User B")
    client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Remove User B
    response = client.delete(
        f"/api/v1/families/{family_id}/members/{user_b['user_id']}",
        headers=auth_headers,
    )
    assert response.status_code == 204

    # Verify User B is no longer in family
    members = client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers).json()
    assert len(members) == 1  # Only the creator left


def test_member_can_leave_family(client, auth_headers):
    """Test that a member can leave family themselves."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Add User B
    user_b = create_user(client, "User B")
    client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # User B leaves
    response = client.delete(
        f"/api/v1/families/{family_id}/members/{user_b['user_id']}",
        headers=user_b["headers"],
    )
    assert response.status_code == 204


def test_cannot_remove_last_admin(client, auth_headers):
    """Test that the last admin cannot be removed."""
    # Create family (creator is only admin)
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Try to remove self (last admin)
    response = client.delete(
        f"/api/v1/families/{family_id}/members/{auth_headers.user_id}",
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "last admin" in response.json()["detail"]


def test_promote_member_to_admin(client, auth_headers):
    """Test promoting a member to admin."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Add User B
    user_b = create_user(client, "User B")
    client.post(
        f"/api/v1/families/{family_id}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Promote User B to admin
    response = client.put(
        f"/api/v1/families/{family_id}/members/{user_b['user_id']}",
        headers=auth_headers,
        json={"role": "admin"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_cannot_demote_last_admin(client, auth_headers):
    """Test that the last admin cannot be demoted."""
    # Create family
    create_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = create_response.json()["id"]

    # Try to demote self (last admin)
    response = client.put(
        f"/api/v1/families/{family_id}/members/{auth_headers.user_id}",
        headers=auth_headers,
        json={"role": "member"},
    )
    assert response.status_code == 400
    assert "last admin" in response.json()["detail"]


# =============================================================================
# List Family Sharing Tests
# =============================================================================


def test_share_list_with_family(client, auth_headers):
    """Test sharing a list with family."""
    # Create family
    family_response = client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})
    family_id = family_response.json()["id"]

    # Create list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shared List"})
    list_id = list_response.json()["id"]

    # Share with family
    response = client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )
    assert response.status_code == 201
    assert response.json()["family_id"] == family_id
    assert response.json()["permission"] == "edit"


def test_share_list_no_family(client, auth_headers):
    """Test sharing list when not in a family."""
    # Create list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "List"})
    list_id = list_response.json()["id"]

    # Try to share with family
    response = client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )
    assert response.status_code == 400
    assert "not in a family" in response.json()["detail"]


def test_family_member_sees_shared_list(client, auth_headers):
    """Test that family members can see shared lists."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Create list and share with family
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Family List"})
    list_id = list_response.json()["id"]
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )

    # User B should see the list
    lists = client.get("/api/v1/lists", headers=user_b["headers"]).json()
    assert any(lst["id"] == list_id for lst in lists)

    # User B can get the list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b["headers"])
    assert response.status_code == 200


def test_family_member_can_edit_shared_list(client, auth_headers):
    """Test that family members with edit permission can modify the list."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Create list and share with family (edit permission)
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Family List"})
    list_id = list_response.json()["id"]
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )

    # User B can update the list
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=user_b["headers"],
        json={"name": "Updated by Family Member"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated by Family Member"


def test_family_member_view_only_cannot_edit(client, auth_headers):
    """Test that family members with view permission cannot edit."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Create list and share with family (view only)
    list_response = client.post(
        "/api/v1/lists", headers=auth_headers, json={"name": "View Only List"}
    )
    list_id = list_response.json()["id"]
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "view"},
    )

    # User B cannot update the list
    response = client.put(
        f"/api/v1/lists/{list_id}",
        headers=user_b["headers"],
        json={"name": "Try to Update"},
    )
    assert response.status_code == 403


def test_unshare_list_from_family(client, auth_headers):
    """Test removing family share from a list."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Create list and share with family
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "To Unshare"})
    list_id = list_response.json()["id"]
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )

    # Unshare from family
    response = client.delete(f"/api/v1/lists/{list_id}/share-family", headers=auth_headers)
    assert response.status_code == 204

    # User B can no longer access the list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b["headers"])
    assert response.status_code == 404


def test_leaving_family_removes_list_access(client, auth_headers):
    """Test that leaving a family removes access to family-shared lists."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Create list and share with family
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Family List"})
    list_id = list_response.json()["id"]
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )

    # User B can access the list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b["headers"])
    assert response.status_code == 200

    # User B leaves the family
    client.delete(
        f"/api/v1/families/{my_family['id']}/members/{user_b['user_id']}",
        headers=user_b["headers"],
    )

    # User B can no longer access the list
    response = client.get(f"/api/v1/lists/{list_id}", headers=user_b["headers"])
    assert response.status_code == 404


def test_get_list_shares(client, auth_headers):
    """Test getting all shares for a list."""
    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Create list
    list_response = client.post("/api/v1/lists", headers=auth_headers, json={"name": "Shared List"})
    list_id = list_response.json()["id"]

    # Add individual share
    user_b = create_user(client, "User B")
    client.post(
        f"/api/v1/lists/{list_id}/share",
        headers=auth_headers,
        json={"user_email": user_b["email"], "permission": "view"},
    )

    # Add family share
    client.post(
        f"/api/v1/lists/{list_id}/share-family",
        headers=auth_headers,
        json={"permission": "edit"},
    )

    # Get shares
    response = client.get(f"/api/v1/lists/{list_id}/shares", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data["individual_shares"]) == 1
    assert len(data["family_shares"]) == 1


# =============================================================================
# Household Calculation Tests
# =============================================================================


def test_household_includes_family_members(client, auth_headers, db):
    """Test that household includes family members."""
    from src.api.dependencies import get_household_user_ids
    from src.models.user import User

    # Create family
    client.post("/api/v1/families", headers=auth_headers, json={"name": "Family"})

    # Add User B to family
    user_b = create_user(client, "User B")
    my_family = client.get("/api/v1/families/me", headers=auth_headers).json()
    client.post(
        f"/api/v1/families/{my_family['id']}/members",
        headers=auth_headers,
        json={"email": user_b["email"]},
    )

    # Get household user IDs
    current_user = db.query(User).filter(User.id == auth_headers.user_id).first()
    household_ids = get_household_user_ids(db, current_user)

    # Should include both users
    assert auth_headers.user_id in household_ids
    assert user_b["user_id"] in household_ids
