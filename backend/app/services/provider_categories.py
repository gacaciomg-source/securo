"""Mapping a bank provider's transaction categories onto the default ones.

Kept apart from the sync so read paths (bill status, backfills) can tell a
bill payment from a purchase without importing the whole sync machinery.
"""
import re
from typing import Optional

#: Pluggy transaction categories (the English names its API returns) mapped
#: to the internal keys of the default categories, so the match works whatever
#: language the workspace's categories were seeded in. A parent name also
#: matches its "Parent - Child" subcategories. Bill payments and transfers
#: between the holder's own accounts map to `transfers`, a treat_as_transfer
#: category: they move money and must count as neither income nor spending,
#: on the checking side or on the card. "Third-party transfers" stay unmapped:
#: a PIX to someone else is real spending.
#: Taxonomy: https://docs.pluggy.ai/docs/transaction-categories
PLUGGY_CATEGORY_KEYS: dict[str, str] = {
    # Income
    "Income": "salary",
    "Salary": "salary",
    "Retirement": "salary",
    "Entrepreneurial activities": "salary",
    "Government aid": "salary",
    "Non-recurring income": "salary",
    # Money moved, not earned or spent
    "Transfer": "transfers",
    "Transfers": "transfers",
    "Wire transfers": "transfers",
    "Same person transfer": "transfers",
    "Credit card payment": "transfers",
    "Investments": "investments",
    "Automatic investment": "investments",
    "Fixed income": "investments",
    "Mutual funds": "investments",
    "Variable income": "investments",
    "Pension": "investments",
    # Food
    "Food and drinks": "food",
    "Food": "food",
    "Eating out": "food",
    "Restaurants": "food",
    "Food delivery": "food",
    "Groceries": "groceries",
    "Supermarkets": "groceries",
    # Health and care
    "Healthcare": "health",
    "Health": "health",
    "Pharmacy": "health",
    "Dentist": "health",
    "Optometry": "health",
    "Hospital clinics and labs": "health",
    "Wellness and fitness": "personal_care",
    "Gyms and fitness centers": "personal_care",
    "Sports practice": "personal_care",
    "Wellness": "personal_care",
    # Home
    "Housing": "housing",
    "Rent": "housing",
    "Houseware": "housing",
    "Utilities": "housing",
    "Water": "housing",
    "Electricity": "housing",
    # Under Utilities: cooking gas. Fuel is "Gas stations".
    "Gas": "housing",
    # Getting around
    "Transportation": "transport",
    "Transport": "transport",
    "Taxi and ride-hailing": "transport",
    "Public transportation": "transport",
    "Car rental": "transport",
    "Bicycle": "transport",
    "Automotive": "transport",
    "Gas stations": "transport",
    "Parking": "transport",
    "Tolls and in vehicle payment": "transport",
    "Vehicle maintenance": "transport",
    "Vehicle ownership taxes and fees": "transport",
    "Traffic tickets": "transport",
    "Travel": "transport",
    "Airport and airlines": "transport",
    "Bus tickets": "transport",
    # Fun
    "Leisure": "leisure",
    "Entertainment": "leisure",
    "Tickets": "leisure",
    "Stadiums and arenas": "leisure",
    "Landmarks and museums": "leisure",
    "Cinema, theater and concerts": "leisure",
    "Accommodation": "leisure",
    "Gaming": "leisure",
    "Gambling": "leisure",
    "Lottery": "leisure",
    "Online bet": "leisure",
    # Recurring services
    "Subscriptions": "subscriptions",
    "Online services": "subscriptions",
    "Digital services": "subscriptions",
    "Video streaming": "subscriptions",
    "Music streaming": "subscriptions",
    "Telecommunications": "subscriptions",
    "Internet": "subscriptions",
    "Mobile": "subscriptions",
    "TV": "subscriptions",
    # Learning
    "Education": "education",
    "Online courses": "education",
    "University": "education",
    "School": "education",
    "Kindergarten": "education",
    "Bookstore": "education",
    # Shopping
    "Shopping": "shopping",
    "Online shopping": "shopping",
    "Electronics": "shopping",
    "Clothing": "shopping",
    "Pet supplies and vet": "shopping",
    "Kids and toys": "shopping",
    "Sports goods": "shopping",
    "Office supplies": "shopping",
    # Giving
    "Donations": "donations",
    # Fees and taxes
    "Taxes": "taxes",
    "Income taxes": "taxes",
    "Taxes on investments": "taxes",
    "Tax on financial operations": "taxes",
    "Urban land and building tax": "taxes",
    "Bank fees": "taxes",
    "Account fees": "taxes",
    "Wire transfer and ATM fees": "taxes",
    "Credit card fees": "taxes",
    "Interests charged": "taxes",
    "Late payment and overdraft costs": "taxes",
}


def _normalize_provider_category(name: str) -> str:
    """Lowercase words only: "Taxi/ride-hailing" and "Taxi and ride-hailing"
    differ only in connectors, so both reduce to the same lookup key."""
    words = re.findall(r"[a-z0-9]+", name.lower())
    return " ".join(w for w in words if w != "and")


_PLUGGY_KEYS_NORMALIZED = {
    _normalize_provider_category(name): key for name, key in PLUGGY_CATEGORY_KEYS.items()
}


def pluggy_category_key(pluggy_category: Optional[str]) -> Optional[str]:
    """The default-category key a Pluggy category maps to, if any."""
    if not pluggy_category:
        return None
    key = _PLUGGY_KEYS_NORMALIZED.get(_normalize_provider_category(pluggy_category))
    if key is None and " - " in pluggy_category:
        key = _PLUGGY_KEYS_NORMALIZED.get(
            _normalize_provider_category(pluggy_category.split(" - ")[0])
        )
    return key
