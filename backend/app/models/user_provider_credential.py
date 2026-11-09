"""Bank-provider app credentials that belong to one person.

The free Meu Pluggy plan hands each person their own Pluggy app (client id
and secret) and only covers accounts of that one holder. On a household
install everyone therefore brings their own keys instead of sharing the
instance-wide PLUGGY_CLIENT_ID. The secret is stored encrypted with the
app SECRET_KEY and never leaves the server.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserProviderCredential(Base):
    __tablename__ = "user_provider_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_user_provider_credentials_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(50))
    client_id: Mapped[str] = mapped_column(String(255))
    client_secret_enc: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
