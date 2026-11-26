# GPU Health Module — Agent Rules & Engineering Standards

## Scope & Purpose
The `gpu_health` module delivers an enterprise-grade, vendor-extensible, model-independent health evaluation and deployment readiness engine for GPUs across the Inferexe ecosystem.

## Module Engineering Rules

### 1. Architectural Boundaries
- `gpu_health.core`: Pure domain logic. No imports from `fastapi`, `starlette`, `sqlalchemy`, or external API clients.
- `gpu_health.collectors`: Device drivers and metric scrapers implementing `BaseGpuCollector`. Failures in vendor tools must degrade gracefully.
- `gpu_health.checks`: Individual check units implementing `BaseHealthCheck`. Every check must be idempotent, bounded in runtime, and timeout-protected.
- `gpu_health.evaluator`: Pure decision logic mapping check outputs and metrics to `HealthStatus` and generating `HealthReport`.
- `gpu_health.readiness`: Workload suitability evaluator implementing `DeploymentReadinessChecker`.
- `gpu_health.service`: Bridge between the pure engine, persistence layers (SQLAlchemy/Supabase), and provider adapters.
- `gpu_health.api`: FastAPI routers exposing endpoints. Must parse, validate, and delegate to `service` or `engine`.

### 2. Typing & Contracts
- All core entities must be defined with Pydantic v2 or standard Python dataclasses/typing (`Optional`, `Dict`, `List`, `Union`).
- No implicit `Any` types in public interfaces.
- Standard enum values:
  - `HealthStatus`: `HEALTHY`, `WARNING`, `CRITICAL`, `UNKNOWN`, `UNAVAILABLE`
  - `CheckResultStatus`: `PASSED`, `FAILED`, `WARNING`, `UNSUPPORTED`, `UNAVAILABLE`
  - `AvailabilityStatus`: `AVAILABLE`, `BUSY`, `ALLOCATED`, `DRAINING`, `OFFLINE`

### 3. Check Design Guidelines
- **Safe Memory Check**: Only allocate minimal test buffers (e.g. 1MB - 16MB) and immediately free them. Never exhaust VRAM.
- **Safe Compute Check**: Run a micro-matrix or kernel operation with strict execution bounds (< 500ms).
- **Timeouts**: Every check must accept a timeout parameter (default: 5.0 seconds) and abort cleanly if exceeded.

### 4. Evaluation Logic Rules
- An `unsupported` check does not penalize health score and does not trigger `CRITICAL` or `WARNING` status.
- A health score (0.0 to 100.0) is calculated only from supported and successfully measured metrics.
- Overheating or hardware bus/driver failures must immediately flag `CRITICAL`.
- High utilization alone is an availability concern, not a health defect (unless accompanied by thermal throttling or critical memory exhaustion).

### 5. Testing Requirements
- Unit tests must mock all physical hardware queries by default.
- Integration tests must verify collector fallback, multi-GPU handling, timeout handling, and malformed inputs.
- Real hardware discovery must be gated by environment capability checks.
