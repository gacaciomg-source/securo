"""mark an account as shared by the household

Revision ID: 111
Revises: 110
"""

import sqlalchemy as sa

from alembic import op

revision = "111"
down_revision = "110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("accounts")}
    if "is_joint" not in columns:
        op.add_column(
            "accounts",
            sa.Column("is_joint", sa.Boolean(), nullable=False, server_default="false"),
        )


def downgrade() -> None:
    op.drop_column("accounts", "is_joint")
