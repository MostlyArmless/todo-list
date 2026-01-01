"""add list_type and task item fields

Revision ID: a663a531e286
Revises: 1641c3cc0ad1
Create Date: 2026-01-01 04:55:42.303831

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a663a531e286"
down_revision: str | None = "1641c3cc0ad1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create enum types first (values match Python enum string values)
    listtype_enum = sa.Enum("grocery", "task", name="listtype")
    listtype_enum.create(op.get_bind(), checkfirst=True)

    recurrence_enum = sa.Enum("daily", "weekly", "monthly", name="recurrencepattern")
    recurrence_enum.create(op.get_bind(), checkfirst=True)

    # Add item task-specific columns
    op.add_column("items", sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("items", sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("items", sa.Column("reminder_offset", sa.String(length=20), nullable=True))
    op.add_column("items", sa.Column("recurrence_pattern", recurrence_enum, nullable=True))
    op.add_column("items", sa.Column("recurrence_parent_id", sa.Integer(), nullable=True))
    op.add_column("items", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_items_due_date"), "items", ["due_date"], unique=False)
    op.create_index(op.f("ix_items_reminder_at"), "items", ["reminder_at"], unique=False)
    op.create_foreign_key(
        "fk_items_recurrence_parent", "items", "items", ["recurrence_parent_id"], ["id"]
    )

    # Add list_type column
    op.add_column(
        "lists", sa.Column("list_type", listtype_enum, server_default="grocery", nullable=False)
    )


def downgrade() -> None:
    # Drop list_type column and enum
    op.drop_column("lists", "list_type")
    sa.Enum(name="listtype").drop(op.get_bind(), checkfirst=True)

    # Drop item task fields
    op.drop_constraint("fk_items_recurrence_parent", "items", type_="foreignkey")
    op.drop_index(op.f("ix_items_reminder_at"), table_name="items")
    op.drop_index(op.f("ix_items_due_date"), table_name="items")
    op.drop_column("items", "completed_at")
    op.drop_column("items", "recurrence_parent_id")
    op.drop_column("items", "recurrence_pattern")
    op.drop_column("items", "reminder_offset")
    op.drop_column("items", "reminder_at")
    op.drop_column("items", "due_date")
    sa.Enum(name="recurrencepattern").drop(op.get_bind(), checkfirst=True)
