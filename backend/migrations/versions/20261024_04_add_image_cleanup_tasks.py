"""add image cleanup tasks

Revision ID: 20261024_04
Revises: 20261024_03
"""

from alembic import op
import sqlalchemy as sa


revision = "20261024_04"
down_revision = "20261024_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_cleanup_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )


def downgrade() -> None:
    op.drop_table("image_cleanup_tasks")
