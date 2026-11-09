"""Per-person Pluggy keys: saving them, and every call picking the right app.

The free Meu Pluggy plan only covers one holder's accounts, so on a shared
install each person connects their banks through their own Pluggy app.
"""
import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import select

from app.models.bank_connection import BankConnection
from app.models.user_provider_credential import UserProviderCredential
from app.providers import register_provider
from app.providers.base import ConnectTokenData, ProviderNotConfiguredError
from app.providers.pluggy import PluggyProvider
from app.services import connection_service
from app.services import provider_credentials_service as service


def _rejected(status_code: int = 401) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.pluggy.ai/auth")
    return httpx.HTTPStatusError(
        "rejected", request=request, response=httpx.Response(status_code, request=request)
    )


async def _connection(session, user, credentials: dict) -> BankConnection:
    connection = BankConnection(
        id=uuid.uuid4(),
        user_id=user.id,
        provider="pluggy",
        external_id="item-1",
        institution_name="Nubank",
        credentials=credentials,
        status="active",
    )
    session.add(connection)
    await session.commit()
    await session.refresh(connection)
    return connection


@pytest.mark.asyncio
async def test_secret_is_stored_encrypted(session, test_user):
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")

    row = (await session.execute(select(UserProviderCredential))).scalar_one()
    assert row.client_id == "cid-1"
    assert row.client_secret_enc != "s3cret"
    assert "s3cret" not in row.client_secret_enc


@pytest.mark.asyncio
async def test_saving_again_replaces_the_keys(session, test_user):
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "a")
    await service.save_credential(session, test_user.id, "pluggy", "cid-2", "b")

    rows = (await session.execute(select(UserProviderCredential))).scalars().all()
    assert [r.client_id for r in rows] == ["cid-2"]


@pytest.mark.asyncio
async def test_new_connection_uses_personal_keys(session, test_user):
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")

    provider = await connection_service._provider_for_user(session, "pluggy", test_user.id)

    assert isinstance(provider, PluggyProvider)
    assert provider.uses_personal_credentials
    assert provider._app_credentials() == ("cid-1", "s3cret")


@pytest.mark.asyncio
async def test_new_connection_falls_back_to_instance_keys(session, test_user):
    register_provider("pluggy", PluggyProvider)

    provider = await connection_service._provider_for_user(session, "pluggy", test_user.id)

    assert isinstance(provider, PluggyProvider)
    assert not provider.uses_personal_credentials


@pytest.mark.asyncio
async def test_new_connection_without_any_keys_is_refused(session, test_user):
    with pytest.raises(ValueError):
        await connection_service._provider_for_user(session, "pluggy", test_user.id)


@pytest.mark.asyncio
async def test_only_personal_providers_get_stamped():
    personal = PluggyProvider(client_id="cid-1", client_secret="x")
    instance = PluggyProvider()

    assert service.stamp_personal_client_id(personal, {"item_id": "i"}) == {
        "item_id": "i",
        service.PERSONAL_CLIENT_ID_KEY: "cid-1",
    }
    assert service.stamp_personal_client_id(instance, {"item_id": "i"}) == {"item_id": "i"}


@pytest.mark.asyncio
async def test_existing_connection_keeps_the_app_that_made_it(session, test_user):
    register_provider("pluggy", PluggyProvider)
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")
    legacy = await _connection(session, test_user, {"item_id": "i"})
    personal = await _connection(
        session, test_user, {"item_id": "i", service.PERSONAL_CLIENT_ID_KEY: "cid-1"}
    )

    legacy_provider = await connection_service._provider_for_connection(session, legacy)
    personal_provider = await connection_service._provider_for_connection(session, personal)

    assert not legacy_provider.uses_personal_credentials
    assert personal_provider._app_credentials() == ("cid-1", "s3cret")


@pytest.mark.asyncio
async def test_connection_breaks_loudly_when_its_keys_change(session, test_user):
    await service.save_credential(session, test_user.id, "pluggy", "cid-2", "other")
    connection = await _connection(
        session, test_user, {"item_id": "i", service.PERSONAL_CLIENT_ID_KEY: "cid-1"}
    )

    with pytest.raises(ProviderNotConfiguredError):
        await connection_service._provider_for_connection(session, connection)


@pytest.mark.asyncio
async def test_api_keys_are_cached_per_app():
    PluggyProvider._api_keys.clear()
    first = PluggyProvider(client_id="cid-a", client_secret="a")
    second = PluggyProvider(client_id="cid-b", client_secret="b")
    with patch(
        "app.providers.pluggy.authenticate", new=AsyncMock(side_effect=["key-a", "key-b"])
    ) as auth:
        assert await first._ensure_api_key() == "key-a"
        assert await second._ensure_api_key() == "key-b"
        assert await first._ensure_api_key() == "key-a"

    assert auth.await_count == 2
    PluggyProvider._api_keys.clear()


@pytest.mark.asyncio
async def test_api_saves_checked_keys_and_never_returns_the_secret(client, auth_headers):
    with patch("app.providers.pluggy.authenticate", new=AsyncMock(return_value="k")) as auth:
        r = await client.put(
            "/api/provider-credentials/pluggy",
            json={"client_id": " cid-1 ", "client_secret": "s3cret"},
            headers=auth_headers,
        )
    assert r.status_code == 200, r.text
    auth.assert_awaited_once_with("cid-1", "s3cret")
    body = r.json()
    assert body["has_personal_credentials"] is True
    assert body["client_id"] == "cid-1"
    assert "s3cret" not in r.text

    r = await client.get("/api/provider-credentials/pluggy", headers=auth_headers)
    assert r.json()["client_id"] == "cid-1"
    assert "s3cret" not in r.text


@pytest.mark.asyncio
async def test_api_refuses_keys_pluggy_rejects(client, auth_headers, session):
    with patch("app.providers.pluggy.authenticate", new=AsyncMock(side_effect=_rejected())):
        r = await client.put(
            "/api/provider-credentials/pluggy",
            json={"client_id": "cid-1", "client_secret": "wrong"},
            headers=auth_headers,
        )
    assert r.status_code == 400
    assert r.json()["detail"] == "invalid_credentials"
    assert (await session.execute(select(UserProviderCredential))).first() is None


@pytest.mark.asyncio
async def test_api_unknown_provider_is_404(client, auth_headers):
    r = await client.get("/api/provider-credentials/simplefin", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_api_delete_warns_when_banks_still_use_the_keys(
    client, auth_headers, session, test_user
):
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")
    await _connection(session, test_user, {"item_id": "i", service.PERSONAL_CLIENT_ID_KEY: "cid-1"})

    r = await client.get("/api/provider-credentials/pluggy", headers=auth_headers)
    assert r.json()["connections_using"] == 1

    r = await client.delete("/api/provider-credentials/pluggy", headers=auth_headers)
    assert r.status_code == 409

    r = await client.delete("/api/provider-credentials/pluggy?force=true", headers=auth_headers)
    assert r.status_code == 204
    r = await client.get("/api/provider-credentials/pluggy", headers=auth_headers)
    assert r.json()["has_personal_credentials"] is False


@pytest.mark.asyncio
async def test_providers_list_counts_personal_keys(client, auth_headers, session, test_user):
    def pluggy(body):
        return next(p for p in body["providers"] if p["name"] == "pluggy")

    r = await client.get("/api/connections/providers", headers=auth_headers)
    assert pluggy(r.json())["configured"] is False

    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")
    r = await client.get("/api/connections/providers", headers=auth_headers)
    assert pluggy(r.json())["configured"] is True
    assert pluggy(r.json())["has_personal_credentials"] is True


@pytest.mark.asyncio
async def test_providers_list_flags_people_on_the_shared_account(client, auth_headers):
    """Instance keys alone: connectable, but the person has none of their own."""
    register_provider("pluggy", PluggyProvider)

    r = await client.get("/api/connections/providers", headers=auth_headers)

    pluggy = next(p for p in r.json()["providers"] if p["name"] == "pluggy")
    assert pluggy["configured"] is True
    assert pluggy["has_personal_credentials"] is False


@pytest.mark.asyncio
async def test_providers_list_still_answers_anonymous_callers(client):
    r = await client.get("/api/connections/providers")

    assert r.status_code == 200
    assert all(p["has_personal_credentials"] is False for p in r.json()["providers"])


@pytest.mark.asyncio
async def test_connect_token_goes_through_the_persons_app(
    client, auth_headers, session, test_user, test_workspace
):
    await service.save_credential(session, test_user.id, "pluggy", "cid-1", "s3cret")
    used: list[tuple[str, str]] = []

    async def fake_token(self, client_user_id, item_id=None):
        used.append(self._app_credentials())
        return ConnectTokenData(access_token="tok")

    with patch.object(PluggyProvider, "create_connect_token", new=fake_token):
        r = await client.post(
            "/api/connections/connect-token",
            json={"provider": "pluggy"},
            headers={**auth_headers, "X-Workspace-Id": str(test_workspace.id)},
        )

    assert r.status_code == 200, r.text
    assert used == [("cid-1", "s3cret")]
