"""
GPU Health Service Layer
========================
Coordinates between the pure domain GpuHealthEngine, persistence layers
(SQLAlchemy/PostgreSQL/Supabase), and Inferexe cloud provider adapters.
"""

import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from .core.engine import GpuHealthEngine
from .core.types import (
    HealthReport,
    GpuDeviceInfo,
    DeploymentRequirement,
    ReadinessResult,
    AvailabilityStatus,
)
from .core.config import HealthThresholds
from .models import GpuHealthRecord

logger = logging.getLogger("inferxe.gpu_health.service")


class GpuHealthService:
    """Service facade handling health check execution, caching, persistence, and provider bridging."""

    def __init__(
        self,
        engine: Optional[GpuHealthEngine] = None,
        db_session_factory=None,
    ):
        self.engine = engine or GpuHealthEngine()
        self._db_session_factory = db_session_factory

    def _get_db(self):
        """Retrieve database session if configured."""
        if self._db_session_factory:
            return self._db_session_factory()
        try:
            from inference.database import SessionLocal, engine
            # Ensure table exists if running on local SQLite/development database
            from .models import GpuHealthRecord, Base
            try:
                Base.metadata.create_all(bind=engine, tables=[GpuHealthRecord.__table__], checkfirst=True)
            except Exception:
                pass
            return SessionLocal()
        except Exception:
            return None

    async def list_gpus_health(self) -> List[Dict[str, Any]]:
        """List health summary for all registered / detected GPUs."""
        devices = await self.engine.detect_gpus()
        summaries = []
        for dev in devices:
            try:
                report = await self.engine.run_all_checks(dev.gpu_id)
                summaries.append({
                    "gpu_id": dev.gpu_id,
                    "device_info": dev.model_dump(),
                    "overall_status": report.overall_status.value,
                    "health_score": report.health_score,
                    "availability_status": report.availability_status.value,
                    "is_deployment_ready": report.is_deployment_ready,
                    "timestamp": report.timestamp.isoformat(),
                    "execution_duration_ms": report.execution_duration_ms,
                })
            except Exception as exc:
                logger.warning(f"Error generating health summary for {dev.gpu_id}: {exc}")
                summaries.append({
                    "gpu_id": dev.gpu_id,
                    "device_info": dev.model_dump(),
                    "overall_status": "unavailable",
                    "health_score": None,
                    "availability_status": "offline",
                    "is_deployment_ready": False,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "execution_duration_ms": 0.0,
                    "error": str(exc),
                })
        return summaries

    async def get_gpu_health_report(self, gpu_id: str, persist: bool = False) -> HealthReport:
        """Fetch or run full health check for specific GPU and optionally persist."""
        report = await self.engine.run_all_checks(gpu_id)
        if persist:
            await self.persist_health_report(report)
        return report

    async def check_deployment_readiness(
        self,
        gpu_id: str,
        requirement: DeploymentRequirement,
    ) -> ReadinessResult:
        """Evaluate if the GPU can accept the requested deployment."""
        return await self.engine.check_deployment_readiness(gpu_id, requirement)

    async def persist_health_report(self, report: HealthReport) -> Optional[str]:
        """Save a health check report to the database history."""
        db = self._get_db()
        if not db:
            logger.debug("Database not configured or unreachable; skipping persistence.")
            return None

        try:
            summary_msg = f"{report.overall_status.value.upper()} (Score: {report.health_score}): {len(report.individual_checks)} checks executed."
            record = GpuHealthRecord(
                gpu_id=report.gpu_id,
                vendor=report.device_info.vendor,
                model=report.device_info.model,
                health_status=report.overall_status.value,
                health_score=report.health_score,
                availability_status=report.availability_status.value,
                is_deployment_ready=report.is_deployment_ready,
                summary=summary_msg,
                check_results=[c.model_dump() for c in report.individual_checks],
                metrics={},
                recommendations=report.recommendations,
                execution_duration_ms=int(report.execution_duration_ms),
                created_at=report.timestamp,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            return str(record.id)
        except Exception as exc:
            logger.error(f"Failed to persist GPU health report for {report.gpu_id}: {exc}")
            db.rollback()
            return None
        finally:
            db.close()

    async def get_health_history(
        self,
        gpu_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Query past health audit records for a specific GPU or across the entire fleet.
        Returns matching records and total count.
        """
        db = self._get_db()
        if not db:
            return {"total": 0, "history": []}

        try:
            query = db.query(GpuHealthRecord)
            if gpu_id:
                query = query.filter(GpuHealthRecord.gpu_id == gpu_id)
            if status:
                query = query.filter(GpuHealthRecord.health_status == status.lower())

            total = query.count()
            records = (
                query.order_by(GpuHealthRecord.created_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            items = [
                {
                    "id": str(r.id),
                    "gpu_id": r.gpu_id,
                    "vendor": r.vendor,
                    "model": r.model,
                    "health_status": r.health_status,
                    "health_score": r.health_score,
                    "availability_status": r.availability_status,
                    "is_deployment_ready": r.is_deployment_ready,
                    "summary": r.summary,
                    "check_results": r.check_results or [],
                    "recommendations": r.recommendations or [],
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "execution_duration_ms": r.execution_duration_ms,
                }
                for r in records
            ]
            return {"total": total, "history": items}
        except Exception as exc:
            logger.error(f"Failed to retrieve health history: {exc}")
            return {"total": 0, "history": []}
        finally:
            db.close()


# Default singleton instance
_DEFAULT_SERVICE: Optional[GpuHealthService] = None


def get_gpu_health_service() -> GpuHealthService:
    """Return singleton service instance."""
    global _DEFAULT_SERVICE
    if _DEFAULT_SERVICE is None:
        _DEFAULT_SERVICE = GpuHealthService()
    return _DEFAULT_SERVICE
