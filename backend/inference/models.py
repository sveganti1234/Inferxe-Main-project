"""
models.py
=========
SQLAlchemy ORM models for customer API key management and inference request tracking.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Integer,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.types import TypeDecorator, CHAR
from sqlalchemy.orm import relationship

from inference.database import Base


# Cross-database compatible UUID type (PostgreSQL native UUID, CHAR(36) for SQLite/tests)
class GUID(TypeDecorator):
    """Platform-independent GUID type.
    Uses PostgreSQL's native UUID type, otherwise uses CHAR(36).
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return str(value)
        else:
            if not isinstance(value, uuid.UUID):
                return str(uuid.UUID(str(value)))
            return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if not isinstance(value, uuid.UUID):
            return uuid.UUID(str(value))
        return value


class APIKey(Base):
    """
    Customer API Key entity.
    Stores cryptographically hashed API keys for authentication.
    Raw keys are never persisted.
    """
    __tablename__ = "api_keys"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(String(255), nullable=True, index=True)  # Cognito sub or customer ID
    name = Column(String(255), nullable=False, default="Default Key")
    key_prefix = Column(String(16), nullable=False, index=True)  # e.g. "inf_live_abcd"
    key_hash = Column(String(64), nullable=False, unique=True, index=True)  # SHA-256 hex
    environment = Column(String(32), nullable=False, default="live")  # 'live' | 'test'
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    inference_requests = relationship(
        "InferenceRequest",
        back_populates="api_key",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    __table_args__ = (
        Index("idx_api_keys_hash_active", "key_hash", "is_active"),
    )

    def __repr__(self):
        return f"<APIKey prefix={self.key_prefix} user_id={self.user_id} active={self.is_active}>"


class InferenceRequest(Base):
    """
    Inference Request telemetry & audit record.
    Tracks provider, model, token usage, latency, and status.
    """
    __tablename__ = "inference_requests"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    api_key_id = Column(
        GUID,
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    user_id = Column(String(255), nullable=True, index=True)
    provider = Column(String(64), nullable=False, default="nvidia")
    model = Column(String(128), nullable=False)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    status = Column(String(32), nullable=False, default="success")  # 'success' | 'failed' | 'timeout'
    latency_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    api_key = relationship("APIKey", back_populates="inference_requests")

    __table_args__ = (
        Index("idx_inf_req_api_created", "api_key_id", "created_at"),
        Index("idx_inf_req_user_created", "user_id", "created_at"),
    )

    def __repr__(self):
        return f"<InferenceRequest id={self.id} model={self.model} tokens={self.total_tokens} status={self.status}>"

