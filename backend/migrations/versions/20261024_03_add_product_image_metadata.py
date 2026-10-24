"""add product image metadata

Revision ID: 20261024_03
Revises: 20261024_02
"""

from alembic import op
import sqlalchemy as sa


revision = "20261024_03"
down_revision = "20261024_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("image_object_key", sa.String(length=255), nullable=True))
    op.add_column("products", sa.Column("image_width", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("image_height", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "image_height")
    op.drop_column("products", "image_width")
    op.drop_column("products", "image_object_key")
