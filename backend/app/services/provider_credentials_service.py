"""Per-person bank provider credentials, and picking the right ones.

Only Pluggy takes personal keys today. The free Meu Pluggy plan gives each
person their own Pluggy app and only covers accounts of that one holder, so
a couple sharing one Securo install needs two sets of keys: each person's
banks are reached through their own app.

Which keys a call uses:

  - A new connection uses the person's own keys when they saved some.
    Without them, administrators fall back to the instance-wide
    PLUGGY_CLIENT_ID; everyone else is asked for their own keys
    (PersonalCredentialsRequiredError), so nobody's banks quietly land on
    the server owner's Pluggy account. PLUGGY_INSTANCE_KEYS_ADMIN_ONLY=false
    shares the instance keys with everyone instead.
  - An existing connection keeps using the app that created its item. A
    connection made with personal keys records that app's client id in its
    credentials (PERSONAL_CLIENT_ID_KEY); one without the marker predates
    personal keys and stays on the instance-wide app.
"""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.services.crypto import decrypt, encrypt
from app.core.config import get_settings
from app.models.bank_connection import BankConnection
from app.models.user import User
from app.models.user_provider_credential import UserProviderCredential
from app.providers import BankProvider, is_provider_registered
from app.providers.base import ProviderNotConfiguredError

#: Providers a person can bring their own app keys for.
PERSONAL_CREDENTIAL_PROVIDERS = frozenset({"pluggy"})

#: Key in BankConnection.credentials naming the personal app that made it.
PERSONAL_CLIENT_ID_KEY = "personal_client_id"

#: Error detail the client recognises to open the keys dialog.
PERSONAL_CREDENTIALS_REQUIRED = "personal_credentials_required"


class PersonalCredentialsRequiredError(ValueError):
    """This person has to save their own keys before connecting a bank.

    A ValueError so the connect-token route answers 400 with this detail,
    like any other request it can't serve.
    """

    def __init__(self) -> None:
        super().__init__(PERSONAL_CREDENTIALS_REQUIRED)


def must_bring_own_keys(provider_name: str, user: Optional[User]) -> bool:
    """Whether this person may not fall back to the instance's keys."""
    if provider_name not in PERSONAL_CREDENTIAL_PROVIDERS:
        return False
    if not get_settings().pluggy_instance_keys_admin_only:
        return False
    return not (user is not None and user.is_superuser)


def instance_keys_usable_by(provider_name: str, user: Optional[User]) -> bool:
    """Whether the instance has keys for this provider that this person may use."""
    return is_provider_registered(provider_name) and not must_bring_own_keys(
        provider_name, user
    )


async def get_credential(
    session: AsyncSession, user_id: uuid.UUID, provider: str
) -> Optional[UserProviderCredential]:
    result = await session.execute(
        select(UserProviderCredential).where(
            UserProviderCredential.user_id == user_id,
            UserProviderCredential.provider == provider,
        )
    )
    return result.scalar_one_or_none()


async def save_credential(
    session: AsyncSession,
    user_id: uuid.UUID,
    provider: str,
    client_id: str,
    client_secret: str,
) -> UserProviderCredential:
    if provider not in PERSONAL_CREDENTIAL_PROVIDERS:
        raise ValueError(f"Provider '{provider}' does not take personal credentials")
    secret_enc = encrypt(client_secret)
    if not secret_enc:
        raise ValueError("Client secret is required")
    credential = await get_credential(session, user_id, provider)
    if credential is None:
        credential = UserProviderCredential(user_id=user_id, provider=provider)
        session.add(credential)
    credential.client_id = client_id
    credential.client_secret_enc = secret_enc
    await session.commit()
    await session.refresh(credential)
    return credential


async def delete_credential(session: AsyncSession, user_id: uuid.UUID, provider: str) -> bool:
    credential = await get_credential(session, user_id, provider)
    if credential is None:
        return False
    await session.delete(credential)
    await session.commit()
    return True


async def count_connections_using(
    session: AsyncSession, user_id: uuid.UUID, provider: str, client_id: str
) -> int:
    """How many of this person's connections were made with these keys."""
    result = await session.execute(
        select(BankConnection).where(
            BankConnection.user_id == user_id, BankConnection.provider == provider
        )
    )
    return sum(
        1
        for connection in result.scalars()
        if (connection.credentials or {}).get(PERSONAL_CLIENT_ID_KEY) == client_id
    )


def _personal_provider(provider_name: str, credential: UserProviderCredential) -> BankProvider:
    secret = decrypt(credential.client_secret_enc)
    if not secret:
        # SECRET_KEY rotated or the row is corrupt: the keys are unusable.
        raise ProviderNotConfiguredError(
            "Your saved Pluggy keys can no longer be read. Save them again in "
            "Settings > Open Finance."
        )
    if provider_name == "pluggy":
        from app.providers.pluggy import PluggyProvider

        return PluggyProvider(client_id=credential.client_id, client_secret=secret)
    raise ValueError(f"Provider '{provider_name}' does not take personal credentials")


async def personal_provider_for_user(
    session: AsyncSession, provider_name: str, user_id: uuid.UUID
) -> Optional[BankProvider]:
    """The provider built from this person's own keys, for a new connection.

    None when they saved none; the caller then falls back to the instance's
    keys through get_provider.
    """
    if provider_name not in PERSONAL_CREDENTIAL_PROVIDERS:
        return None
    credential = await get_credential(session, user_id, provider_name)
    if credential is None:
        return None
    return _personal_provider(provider_name, credential)


async def personal_provider_for_connection(
    session: AsyncSession, connection: BankConnection
) -> Optional[BankProvider]:
    """The personal app an existing connection must keep talking through.

    None for a connection made with the instance's keys. Raises
    ProviderNotConfiguredError when the personal keys that made it were
    removed or replaced: the item belongs to that app, so no other keys can
    read it and the owner has to save them again or reconnect.
    """
    personal_client_id = (connection.credentials or {}).get(PERSONAL_CLIENT_ID_KEY)
    if not personal_client_id:
        return None
    credential = await get_credential(session, connection.user_id, connection.provider)
    if credential is None or credential.client_id != personal_client_id:
        raise ProviderNotConfiguredError(
            "The Pluggy keys this bank was connected with were removed or changed. "
            "Its owner needs to save those keys again or reconnect the bank."
        )
    return _personal_provider(connection.provider, credential)


def stamp_personal_client_id(provider: BankProvider, credentials: Optional[dict]) -> Optional[dict]:
    """Record on a new connection which personal app created it."""
    # `is True`, not truthiness: only a PluggyProvider built from personal
    # keys answers yes; any other provider has no such attribute.
    if credentials is None or getattr(provider, "uses_personal_credentials", False) is not True:
        return credentials
    return {**credentials, PERSONAL_CLIENT_ID_KEY: provider.client_id}  # type: ignore[attr-defined]


async def personal_providers_for_user(session: AsyncSession, user_id: uuid.UUID) -> set[str]:
    """Providers this person saved keys of their own for."""
    result = await session.execute(
        select(UserProviderCredential.provider).where(UserProviderCredential.user_id == user_id)
    )
    return set(result.scalars())
