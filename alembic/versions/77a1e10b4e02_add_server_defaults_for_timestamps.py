"""Add server defaults for timestamps

Revision ID: 77a1e10b4e02
Revises: 3cfc4495f153
Create Date: 2025-12-28 20:50:35.552341

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "77a1e10b4e02"
down_revision: str | None = "3cfc4495f153"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# All tables that use TimestampMixin (have created_at and updated_at columns)
# Excluded: item_history, pantry_match_history (only have last_used_at)
# Excluded: recipe_add_event_items (no timestamps)
TABLES_WITH_TIMESTAMPS = [
    "users",
    "lists",
    "list_shares",
    "categories",
    "items",
    "recipes",
    "recipe_ingredients",
    "recipe_imports",
    "recipe_step_completions",
    "recipe_add_events",
    "ingredient_store_defaults",
    "pending_confirmations",
    "voice_inputs",
    "pantry_items",
    "receipt_scans",
]


def upgrade() -> None:
    # Add server defaults for created_at and updated_at columns
    for table in TABLES_WITH_TIMESTAMPS:
        # Add server default for created_at
        op.alter_column(
            table,
            "created_at",
            server_default=sa.text("now()"),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )
        # Add server default for updated_at
        op.alter_column(
            table,
            "updated_at",
            server_default=sa.text("now()"),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )


def downgrade() -> None:
    # Remove server defaults
    for table in TABLES_WITH_TIMESTAMPS:
        op.alter_column(
            table,
            "created_at",
            server_default=None,
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )
        op.alter_column(
            table,
            "updated_at",
            server_default=None,
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )
