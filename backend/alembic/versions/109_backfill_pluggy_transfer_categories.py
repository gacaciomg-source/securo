"""file synced bill payments and own-account transfers under the transfer category

Pluggy labels a credit-card bill payment "Credit card payment" and a move
between the holder's own accounts "Same person transfer". Neither was in the
sync's category map, so those rows arrived uncategorized and counted twice:
as spending on the checking account and as income on the card. The map now
sends both to the workspace's transfer category; this applies the same rule
to the rows already synced.

Only rows that are still uncategorized are touched, so nothing a person or a
rule chose is overwritten. Respects the `use_provider_categories` admin
setting: when it is off, sync never maps provider categories and neither
does this. Idempotent: a second run finds the rows already categorized.

Revision ID: 109
Revises: 108
"""
import json

from alembic import op
from sqlalchemy import text

from app.services.category_defaults import DEFAULT_CATEGORIES, name_variants
from app.services.provider_categories import pluggy_category_key

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    setting = bind.execute(
        text("SELECT value FROM app_settings WHERE key = 'use_provider_categories'")
    ).scalar()
    if setting is not None and str(setting).lower() != "true":
        return

    transfer_names = sorted(name_variants(DEFAULT_CATEGORIES["transfers"]))
    transfer_by_workspace: dict = {}
    for row in bind.execute(
        text("SELECT id, workspace_id, name FROM categories WHERE workspace_id IS NOT NULL")
    ).fetchall():
        if row.name in transfer_names:
            transfer_by_workspace.setdefault(row.workspace_id, row.id)
    if not transfer_by_workspace:
        return

    rows = bind.execute(
        text(
            """
            SELECT t.id, t.workspace_id, t.raw_data
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            JOIN bank_connections bc ON bc.id = a.connection_id
            WHERE bc.provider = 'pluggy'
              AND t.source = 'sync'
              AND t.category_id IS NULL
              AND t.raw_data IS NOT NULL
            """
        )
    ).fetchall()
    for row in rows:
        raw = row.raw_data
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            continue
        if pluggy_category_key(raw.get("category")) != "transfers":
            continue
        category_id = transfer_by_workspace.get(row.workspace_id)
        if category_id is None:
            continue
        bind.execute(
            text("UPDATE transactions SET category_id = :category_id WHERE id = :id"),
            {"category_id": category_id, "id": row.id},
        )


def downgrade() -> None:
    # Data-only: the rows were uncategorized before and nothing records which
    # ones this filed, so there is nothing safe to undo.
    pass
