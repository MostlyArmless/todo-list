"""change recipe_sources to jsonb

Revision ID: 36dfb2cbfd34
Revises: b38c0ebf1f16
Create Date: 2025-12-28 03:33:47.168838

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "36dfb2cbfd34"
down_revision: str | None = "b38c0ebf1f16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE items ALTER COLUMN recipe_sources TYPE jsonb USING recipe_sources::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE items ALTER COLUMN recipe_sources TYPE json USING recipe_sources::json")
