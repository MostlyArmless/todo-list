"""add recipe import and step completions

Revision ID: a1b2c3d4e5f6
Revises: 36dfb2cbfd34
Create Date: 2025-12-27

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "36dfb2cbfd34"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add instructions column to recipes table
    op.add_column("recipes", sa.Column("instructions", sa.Text(), nullable=True))

    # Create recipe_imports table
    op.create_table(
        "recipe_imports",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, default="pending", index=True),
        sa.Column("parsed_recipe", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    # Create recipe_step_completions table
    op.create_table(
        "recipe_step_completions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("recipe_id", "user_id", "step_index", name="uq_recipe_step_user"),
    )


def downgrade() -> None:
    op.drop_table("recipe_step_completions")
    op.drop_table("recipe_imports")
    op.drop_column("recipes", "instructions")
