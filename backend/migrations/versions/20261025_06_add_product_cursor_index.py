"""add product cursor index

Revision ID: 20261025_06
Revises: 20261024_05
"""

from alembic import op


revision = "20261025_06"
down_revision = "20261024_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_products_created_at_id", "products", ["created_at", "id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_products_created_at_id", table_name="products")
