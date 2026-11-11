"""Where a credit-card bill stands: open, closed, partly paid, paid or overdue.

Banks don't say. Pluggy's /bills has a total and a due date but no payment
field, so the status is read off the card itself: paying the bill puts a
credit on the card account that moves money (a paired transfer, a
transfer-like category, or Pluggy's "Credit card payment") rather than
refunding a purchase.

Payments settle the oldest bill first, the way banks apply them, and only a
bill that has already closed can be paid: money sent before the close lowers
that bill's total at the bank instead, which the synced total already
reflects. A bill someone marked paid by hand (`paid_manually_at`) is paid
whatever the payments say, and takes no payment away from the next one.
"""
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.category import Category
from app.models.credit_card_bill import CreditCardBill
from app.models.transaction import Transaction
from app.services.credit_card_service import _clamp_day
from app.services.provider_categories import pluggy_category_key

#: Closed set, in the order a bill moves through them.
BILL_STATUSES = ("open", "closed", "partial", "overdue", "paid")

#: Without a configured close day, banks close about a week before the due date.
_DEFAULT_CLOSE_GAP = timedelta(days=7)

_CENT = Decimal("0.01")


@dataclass(frozen=True)
class BillStatus:
    status: str
    paid_amount: Decimal
    close_date: date
    paid_manually: bool


def bill_close_date(due_date: date, close_day: Optional[int]) -> date:
    """The latest statement close on or before the due date."""
    if not close_day:
        return due_date - _DEFAULT_CLOSE_GAP
    same_month = _clamp_day(due_date.year, due_date.month, close_day)
    if same_month <= due_date:
        return same_month
    prev_year, prev_month = (
        (due_date.year - 1, 12) if due_date.month == 1 else (due_date.year, due_date.month - 1)
    )
    return _clamp_day(prev_year, prev_month, close_day)


def _is_bill_payment(tx: Transaction, category: Optional[Category]) -> bool:
    if tx.transfer_pair_id is not None:
        return True
    if category is not None and category.treat_as_transfer:
        return True
    raw = tx.raw_data if isinstance(tx.raw_data, dict) else {}
    return pluggy_category_key(raw.get("category")) == "transfers"


async def bill_statuses(
    session: AsyncSession, account: Account, bills: list[CreditCardBill]
) -> dict[uuid.UUID, BillStatus]:
    """Status of each bill of one card account."""
    if not bills:
        return {}
    today = app_today()
    ordered = sorted(bills, key=lambda b: b.due_date)
    close = {b.id: bill_close_date(b.due_date, account.statement_close_day) for b in ordered}

    result = await session.execute(
        select(Transaction, Category)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id == account.id,
            Transaction.type == "credit",
            Transaction.is_ignored.is_(False),
            Transaction.source != "opening_balance",
            Transaction.date > min(close.values()),
        )
        .order_by(Transaction.date, Transaction.created_at)
    )
    payments = [tx for tx, category in result.all() if _is_bill_payment(tx, category)]

    owed = {
        b.id: Decimal("0") if b.paid_manually_at else max(Decimal(b.total_amount), Decimal("0"))
        for b in ordered
    }
    paid = {b.id: Decimal("0") for b in ordered}
    for payment in payments:
        left = abs(Decimal(payment.amount))
        for bill in ordered:
            if close[bill.id] >= payment.date:
                break
            take = min(left, owed[bill.id] - paid[bill.id])
            if take > 0:
                paid[bill.id] += take
                left -= take
            if left <= 0:
                break

    statuses: dict[uuid.UUID, BillStatus] = {}
    for bill in ordered:
        total = Decimal(bill.total_amount)
        manual = bill.paid_manually_at is not None
        if manual or total <= _CENT or owed[bill.id] - paid[bill.id] <= _CENT:
            status = "paid"
        elif today <= close[bill.id]:
            status = "open"
        elif bill.due_date < today:
            status = "overdue"
        elif paid[bill.id] > 0:
            status = "partial"
        else:
            status = "closed"
        statuses[bill.id] = BillStatus(
            status=status,
            paid_amount=max(total, Decimal("0")) if manual else paid[bill.id],
            close_date=close[bill.id],
            paid_manually=manual,
        )
    return statuses


async def set_bill_paid(
    session: AsyncSession,
    account: Account,
    bill_id: uuid.UUID,
    paid: bool,
) -> Optional[CreditCardBill]:
    """Mark a bill paid by hand, or take the mark back. None when the bill
    does not belong to this card."""
    bill = await session.get(CreditCardBill, bill_id)
    if bill is None or bill.account_id != account.id:
        return None
    bill.paid_manually_at = datetime.now(timezone.utc) if paid else None
    await session.commit()
    await session.refresh(bill)
    return bill
