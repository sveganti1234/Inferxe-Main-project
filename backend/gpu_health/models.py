"""
SQLAlchemy ORM Model for GPU Health Check History
=================================================
Cross-database compatible (PostgreSQL native UUID/JSONB, SQLite CHAR/JSON for testing).
Persists historical health evaluation reports, scores, check telemetry, and recommendations.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Boolean,
    DateTime,
    Text,
    Index,
    JSON,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.types import TypeDecorator, CHAR

# Fallback Base if inference.database Base is not yet initialized
try:
    from inference.database import Base
except ImportError:
    from sqlalchemy.orm import declarative_base
    Base = declarative_base()


class GUID(TypeDecorator):
    """Platform-independent GUID type."""
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


class GpuHealthRecord(Base):
    """
    Historical log of an evaluated GPU health check cycle.
    """
    __tablename__ = "gpu_health_history"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    gpu_id = Column(String(128), nullable=False, index=True)
    vendor = Column(String(64), nullable=True)
    model = Column(String(128), nullable=True)
    health_status = Column(String(32), nullable=False, index=True)  # healthy, warning, critical, unknown, unavailable
    health_score = Column(Float, nullable=True)
    availability_status = Column(String(32), nullable=False, default="available")
    is_deployment_ready = Column(Boolean, nullable=False, default=True)
    summary = Column(Text, nullable=True)
    check_results = Column(JSON, nullable=True)
    metrics = Column(JSON, nullable=True)
    recommendations = Column(JSON, nullable=True)
    execution_duration_ms = Column(Integer, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    __table_args__ = (
        Index("idx_gpu_health_created", "gpu_id", "created_at"),
        Index("idx_gpu_health_status", "health_status"),
    )

    def __repr__(self):
        return f"<GpuHealthRecord id={self.id} gpu_id={self.gpu_id} status={self.health_status} score={self.health_score}>"
