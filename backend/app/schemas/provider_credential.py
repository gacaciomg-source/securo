from typing import Optional

from pydantic import BaseModel, Field


class ProviderCredentialRead(BaseModel):
    provider: str
    # The person's own keys. The secret never comes back, only whether one is saved.
    has_personal_credentials: bool
    client_id: Optional[str] = None
    # Whether the instance has keys of its own to fall back on.
    instance_configured: bool
    # This person's bank connections made with the saved keys; removing the
    # keys stops those from syncing.
    connections_using: int = 0


class ProviderCredentialUpdate(BaseModel):
    client_id: str = Field(min_length=1, max_length=255)
    client_secret: str = Field(min_length=1, max_length=1000)
