"""let a credit-card bill be marked paid by hand

Revision ID: 110
Revises: 109
"""

import sqlalchemy as sa

from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("credit_card_bills")}
    if "paid_manually_at" not in columns:
        op.add_column(
            "credit_card_bills",
            sa.Column("paid_manually_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("credit_card_bills", "paid_manually_at")
