"""add family tables

Revision ID: f1a2b3c4d5e6
Revises: 6bdab1b936db
Create Date: 2026-01-31 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "6bdab1b936db"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create families table
    op.create_table(
        "families",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_families_id"), "families", ["id"], unique=False)

    # Create family_members table
    op.create_table(
        "family_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("family_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["family_id"],
            ["families.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_family_members_id"), "family_members", ["id"], unique=False)
    op.create_index(
        op.f("ix_family_members_family_id"), "family_members", ["family_id"], unique=False
    )
    op.create_index(op.f("ix_family_members_user_id"), "family_members", ["user_id"], unique=False)

    # Create list_family_shares table
    op.create_table(
        "list_family_shares",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("list_id", sa.Integer(), nullable=False),
        sa.Column("family_id", sa.Integer(), nullable=False),
        sa.Column("permission", sa.String(length=20), nullable=False, server_default="edit"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["list_id"],
            ["lists.id"],
        ),
        sa.ForeignKeyConstraint(
            ["family_id"],
            ["families.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("list_id", "family_id", name="uq_list_family_share"),
    )
    op.create_index(op.f("ix_list_family_shares_id"), "list_family_shares", ["id"], unique=False)
    op.create_index(
        op.f("ix_list_family_shares_list_id"), "list_family_shares", ["list_id"], unique=False
    )
    op.create_index(
        op.f("ix_list_family_shares_family_id"), "list_family_shares", ["family_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_list_family_shares_family_id"), table_name="list_family_shares")
    op.drop_index(op.f("ix_list_family_shares_list_id"), table_name="list_family_shares")
    op.drop_index(op.f("ix_list_family_shares_id"), table_name="list_family_shares")
    op.drop_table("list_family_shares")

    op.drop_index(op.f("ix_family_members_user_id"), table_name="family_members")
    op.drop_index(op.f("ix_family_members_family_id"), table_name="family_members")
    op.drop_index(op.f("ix_family_members_id"), table_name="family_members")
    op.drop_table("family_members")

    op.drop_index(op.f("ix_families_id"), table_name="families")
    op.drop_table("families")
