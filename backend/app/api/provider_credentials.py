"""A person's own bank provider keys (Meu Pluggy client id and secret).

Personal, not workspace-scoped: the keys reach one person's banks whichever
workspace they connect them from.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_active_user
from app.core.database import get_async_session
from app.models.user import User
from app.schemas.provider_credential import ProviderCredentialRead, ProviderCredentialUpdate
from app.services import provider_credentials_service as service

router = APIRouter(prefix="/api/provider-credentials", tags=["provider-credentials"])


def _require_supported(provider: str) -> None:
    if provider not in service.PERSONAL_CREDENTIAL_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{provider}' does not take personal credentials",
        )


async def _read(session: AsyncSession, user: User, provider: str) -> ProviderCredentialRead:
    credential = await service.get_credential(session, user.id, provider)
    using = 0
    if credential is not None:
        using = await service.count_connections_using(
            session, user.id, provider, credential.client_id
        )
    return ProviderCredentialRead(
        provider=provider,
        has_personal_credentials=credential is not None,
        client_id=credential.client_id if credential else None,
        # Whether *this person* may fall back to the instance's keys, not just
        # whether they exist: by default only administrators may.
        instance_configured=service.instance_keys_usable_by(provider, user),
        connections_using=using,
    )


@router.get("/{provider}", response_model=ProviderCredentialRead)
async def get_provider_credential(
    provider: str,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    _require_supported(provider)
    return await _read(session, user, provider)


@router.put("/{provider}", response_model=ProviderCredentialRead)
async def save_provider_credential(
    provider: str,
    data: ProviderCredentialUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Save the person's keys after checking the provider accepts them."""
    _require_supported(provider)
    client_id = data.client_id.strip()
    client_secret = data.client_secret.strip()

    from app.providers.pluggy import authenticate

    try:
        await authenticate(client_id, client_secret)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 401, 403):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid_credentials",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="provider_unavailable"
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="provider_unavailable"
        ) from exc

    await service.save_credential(session, user.id, provider, client_id, client_secret)
    return await _read(session, user, provider)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider_credential(
    provider: str,
    force: bool = Query(False, description="Remove even if bank connections still use these keys"),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    _require_supported(provider)
    credential = await service.get_credential(session, user.id, provider)
    if credential is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    using = await service.count_connections_using(session, user.id, provider, credential.client_id)
    if using and not force:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="credentials_in_use")
    await service.delete_credential(session, user.id, provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
