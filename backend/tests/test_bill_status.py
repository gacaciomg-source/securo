"""Credit-card bill status: what the card's payments say, and the manual mark."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.category import Category
from app.models.credit_card_bill import CreditCardBill
from app.models.transaction import Transaction
from app.services.bill_status_service import bill_close_date, bill_statuses


async def _card(session: AsyncSession, user_id, close_day=None) -> Account:
    account = Account(
        id=uuid.uuid4(), user_id=user_id, name="Nubank", type="credit_card",
        currency="BRL", statement_close_day=close_day,
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return account


async def _bill(session, user_id, workspace_id, account, due_in_days: int, total) -> CreditCardBill:
    bill = CreditCardBill(
        id=uuid.uuid4(), user_id=user_id, workspace_id=workspace_id, account_id=account.id,
        external_id=f"bill-{uuid.uuid4()}", due_date=app_today() + timedelta(days=due_in_days),
        total_amount=Decimal(str(total)), currency="BRL",
    )
    session.add(bill)
    await session.commit()
    await session.refresh(bill)
    return bill


async def _credit(session, user_id, account, days_ago: int, amount, *, category=None, pluggy=None):
    tx = Transaction(
        id=uuid.uuid4(), user_id=user_id, account_id=account.id,
        description="Pagamento recebido", amount=Decimal(str(amount)),
        date=app_today() - timedelta(days=days_ago), type="credit", source="sync",
        category_id=category.id if category else None,
        raw_data={"category": pluggy} if pluggy else None,
    )
    session.add(tx)
    await session.commit()
    return tx


async def _transfers(session, user_id) -> Category:
    category = Category(
        id=uuid.uuid4(), user_id=user_id, name="Transferências", icon="tag",
        color="#000000", treat_as_transfer=True,
    )
    session.add(category)
    await session.commit()
    return category


async def _status(session, account, bill):
    return (await bill_statuses(session, account, [bill]))[bill.id]


def test_close_date_defaults_to_a_week_before_due():
    due = app_today()
    assert bill_close_date(due, None) == due - timedelta(days=7)


def test_close_date_uses_the_close_day_before_the_due_date():
    from datetime import date

    assert bill_close_date(date(2026, 11, 10), 3) == date(2026, 11, 3)
    assert bill_close_date(date(2026, 11, 2), 25) == date(2026, 10, 25)


@pytest.mark.asyncio
async def test_bill_still_collecting_purchases_is_open(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=10, total="300")

    assert (await _status(session, card, bill)).status == "open"


@pytest.mark.asyncio
async def test_closed_unpaid_bill_before_due_is_closed(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=3, total="300")

    assert (await _status(session, card, bill)).status == "closed"


@pytest.mark.asyncio
async def test_unpaid_bill_past_due_is_overdue(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=-2, total="300")

    assert (await _status(session, card, bill)).status == "overdue"


@pytest.mark.asyncio
async def test_transfer_category_payment_pays_the_bill(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=-1, total="300")
    await _credit(session, test_user.id, card, days_ago=2, amount="300", category=await _transfers(session, test_user.id))

    status = await _status(session, card, bill)

    assert status.status == "paid"
    assert status.paid_amount == Decimal("300")


@pytest.mark.asyncio
async def test_pluggy_bill_payment_counts_even_uncategorized(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=2, total="300")
    await _credit(session, test_user.id, card, days_ago=1, amount="300", pluggy="Credit card payment")

    assert (await _status(session, card, bill)).status == "paid"


@pytest.mark.asyncio
async def test_smaller_payment_leaves_the_bill_partial(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=2, total="300")
    await _credit(session, test_user.id, card, days_ago=1, amount="120", pluggy="Credit card payment")

    status = await _status(session, card, bill)

    assert status.status == "partial"
    assert status.paid_amount == Decimal("120")


@pytest.mark.asyncio
async def test_refund_is_not_a_payment(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=2, total="300")
    await _credit(session, test_user.id, card, days_ago=1, amount="300", pluggy="Online shopping")

    assert (await _status(session, card, bill)).status == "closed"


@pytest.mark.asyncio
async def test_payments_settle_the_oldest_bill_first(session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    old = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=-30, total="200")
    new = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=1, total="300")
    # Paid late: one payment covers the old bill and part of the new one.
    await _credit(session, test_user.id, card, days_ago=1, amount="350", pluggy="Credit card payment")

    statuses = await bill_statuses(session, card, [old, new])

    assert statuses[old.id].status == "paid"
    assert statuses[new.id].status == "partial"
    assert statuses[new.id].paid_amount == Decimal("150")


@pytest.mark.asyncio
async def test_manually_paid_bill_takes_no_payment_from_the_next(session, test_user, test_workspace):
    from datetime import datetime, timezone

    card = await _card(session, test_user.id)
    old = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=-30, total="200")
    old.paid_manually_at = datetime.now(timezone.utc)
    await session.commit()
    new = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=1, total="300")
    await _credit(session, test_user.id, card, days_ago=1, amount="300", pluggy="Credit card payment")

    statuses = await bill_statuses(session, card, [old, new])

    assert statuses[old.id].status == "paid"
    assert statuses[old.id].paid_manually is True
    assert statuses[new.id].status == "paid"


@pytest.mark.asyncio
async def test_api_lists_status_and_marks_paid_by_hand(
    client: AsyncClient, auth_headers, session, test_user, test_workspace
):
    card = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, card, due_in_days=-2, total="300")

    r = await client.get(f"/api/accounts/{card.id}/bills", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()[0]["status"] == "overdue"
    assert r.json()[0]["paid_amount"] == 0

    r = await client.post(f"/api/accounts/{card.id}/bills/{bill.id}/paid", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"
    assert r.json()["paid_manually"] is True

    r = await client.delete(f"/api/accounts/{card.id}/bills/{bill.id}/paid", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "overdue"
    assert r.json()["paid_manually"] is False


@pytest.mark.asyncio
async def test_api_refuses_a_bill_of_another_card(client: AsyncClient, auth_headers, session, test_user, test_workspace):
    card = await _card(session, test_user.id)
    other = await _card(session, test_user.id)
    bill = await _bill(session, test_user.id, test_workspace.id, other, due_in_days=2, total="300")

    r = await client.post(f"/api/accounts/{card.id}/bills/{bill.id}/paid", headers=auth_headers)

    assert r.status_code == 404
