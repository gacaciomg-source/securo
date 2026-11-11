"""goals shared by the household, and a cover photo

Revision ID: 112
Revises: 111
"""

import sqlalchemy as sa

from alembic import op

revision = "112"
down_revision = "111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("goals")}
    if "is_joint" not in columns:
        op.add_column("goals", sa.Column("is_joint", sa.Boolean(), nullable=False, server_default="false"))
    if "image_key" not in columns:
        op.add_column("goals", sa.Column("image_key", sa.String(500), nullable=True))
    if "image_content_type" not in columns:
        op.add_column("goals", sa.Column("image_content_type", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("goals", "image_content_type")
    op.drop_column("goals", "image_key")
    op.drop_column("goals", "is_joint")
