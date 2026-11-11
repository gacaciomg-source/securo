"""Goals the household shares, and their cover photo."""
from unittest.mock import patch

import pytest

from app.providers.storage import StoredFile

STORAGE_PATCH = "app.services.goal_service.get_storage_provider"
PNG = b"\x89PNG\r\n\x1a\nsynthetic"


class _MemoryStorage:
    """In-memory stand-in for the storage provider."""

    def __init__(self):
        self.files: dict[str, tuple[bytes, str]] = {}

    async def upload(self, key, data, content_type):
        self.files[key] = (data, content_type)
        return StoredFile(storage_key=key, size=len(data), content_type=content_type)

    async def download(self, key):
        return self.files[key][0]

    async def delete(self, key):
        self.files.pop(key, None)


async def _goal(client, auth_headers, **extra):
    r = await client.post(
        "/api/goals",
        json={"name": "Viagem", "target_amount": "8000", "currency": "BRL", **extra},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_goal_can_be_shared_by_the_household(client, auth_headers):
    goal = await _goal(client, auth_headers, is_joint=True)
    assert goal["is_joint"] is True
    assert goal["has_image"] is False

    r = await client.patch(f"/api/goals/{goal['id']}", json={"is_joint": False}, headers=auth_headers)
    assert r.json()["is_joint"] is False


@pytest.mark.asyncio
async def test_cover_photo_upload_read_replace_and_remove(client, auth_headers):
    storage = _MemoryStorage()
    goal = await _goal(client, auth_headers)
    with patch(STORAGE_PATCH, return_value=storage):
        r = await client.post(
            f"/api/goals/{goal['id']}/image",
            files={"file": ("praia.png", PNG, "image/png")},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        first_version = r.json()["image_version"]
        assert r.json()["has_image"] is True and first_version

        r = await client.get(f"/api/goals/{goal['id']}/image", headers=auth_headers)
        assert r.status_code == 200
        assert r.content == PNG
        assert r.headers["content-type"] == "image/png"

        r = await client.post(
            f"/api/goals/{goal['id']}/image",
            files={"file": ("praia.jpg", b"\xff\xd8synthetic", "image/jpeg")},
            headers=auth_headers,
        )
        assert r.json()["image_version"] != first_version
        assert len(storage.files) == 1, "the replaced photo is deleted"

        r = await client.delete(f"/api/goals/{goal['id']}/image", headers=auth_headers)
        assert r.json()["has_image"] is False
        assert storage.files == {}
        r = await client.get(f"/api/goals/{goal['id']}/image", headers=auth_headers)
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_only_photos_are_accepted(client, auth_headers):
    goal = await _goal(client, auth_headers)
    with patch(STORAGE_PATCH, return_value=_MemoryStorage()):
        r = await client.post(
            f"/api/goals/{goal['id']}/image",
            files={"file": ("nota.pdf", b"%PDF-1.4", "application/pdf")},
            headers=auth_headers,
        )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_deleting_a_goal_deletes_its_photo(client, auth_headers):
    storage = _MemoryStorage()
    goal = await _goal(client, auth_headers)
    with patch(STORAGE_PATCH, return_value=storage):
        await client.post(
            f"/api/goals/{goal['id']}/image",
            files={"file": ("praia.png", PNG, "image/png")},
            headers=auth_headers,
        )
        r = await client.delete(f"/api/goals/{goal['id']}", headers=auth_headers)
    assert r.status_code == 204
    assert storage.files == {}
