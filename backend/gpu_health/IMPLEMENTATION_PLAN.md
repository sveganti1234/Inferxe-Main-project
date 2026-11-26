# GPU Health Check Engine — Implementation Plan

This plan establishes the phases, engineering tasks, and validation gates for developing the GPU Health Check Engine.

## Phase 1: Rules & Architectural Documentation (Complete)
- [x] Establish `AGENTS.md` and module-specific `gpu_health/AGENTS.md`.
- [x] Create `gpu_health/README.md` with usage instructions and quickstart.
- [x] Create `gpu_health/ARCHITECTURE.md` documenting orthogonal state, collector contracts, and evaluation flow.
- [x] Create `gpu_health/API.md` defining request/response schemas for `/api/v1/gpu/health` endpoints.
- [x] Create `gpu_health/IMPLEMENTATION_PLAN.md` and `gpu_health/TESTING.md`.

## Phase 2: Core Domain Models & Thresholds
- [ ] Implement `gpu_health/core/types.py` with Pydantic v2 data models:
  - `HealthStatus`, `CheckResultStatus`, `AvailabilityStatus`, `MetricCapability`
  - `GpuDeviceInfo`, `GpuMetrics`, `CheckResult`, `HealthReport`
  - `DeploymentRequirement`, `ReadinessResult`
- [ ] Implement `gpu_health/core/config.py`:
  - `HealthThresholds` (warning/critical thermal, memory, utilization, check timeouts)
- [ ] Implement `gpu_health/core/collector.py`:
  - Abstract base class `BaseGpuCollector`

## Phase 3: Hardware Telemetry Collectors
- [ ] Implement `gpu_health/collectors/mock_collector.py`:
  - Deterministic in-memory collector supporting single/multi-GPU topologies, healthy, degraded, critical, and missing states.
- [ ] Implement `gpu_health/collectors/nvidia_collector.py`:
  - Dynamic discovery of NVML (`pynvml` or ctypes) and `nvidia-smi` fallback.
  - Safe capability reporting: returns `unsupported` when specific metrics (like power or ECC) are unavailable.
- [ ] Implement `gpu_health/collectors/registry.py`:
  - Collector manager to register, discover, and pick active collectors.

## Phase 4: Modular Health Checks
- [ ] Implement `BaseHealthCheck` interface in `gpu_health/core/checks.py`.
- [ ] Implement standard health checks in `gpu_health/checks/`:
  - `AccessibilityCheck`: Verifies driver communication and device indexing.
  - `DriverCheck`: Verifies driver version, compatibility, and runtime responsiveness.
  - `MemoryCheck`: Verifies total VRAM, checks memory pressure, and runs a safe bounded micro-allocation test.
  - `ComputeCheck`: Executes a bounded micro-matrix multiplication or verification tensor within strict timeouts.
  - `ThermalCheck`: Inspects core and memory temperature against thresholds.
  - `UtilizationCheck`: Measures compute core and memory bus activity.
  - `ErrorCheck`: Scrapes hardware XID errors, driver fault codes, or uncorrectable ECC flags.

## Phase 5: Evaluator & Deployment Readiness
- [ ] Implement `gpu_health/core/evaluator.py`:
  - Computes composite health score (0-100) only from supported metrics.
  - Assigns `HealthStatus` based on configurable thresholds.
  - Generates clear remediation recommendations.
- [ ] Implement `gpu_health/core/readiness.py`:
  - Checks workload resource specifications against current GPU status, VRAM availability, and thermal limits.
- [ ] Implement `gpu_health/core/engine.py`:
  - Coordinates detection, checks, evaluation, and readiness into clean public API methods.

## Phase 6: Persistence, Service Layer & API Integration
- [ ] Implement SQLAlchemy model `GpuHealthRecord` in `gpu_health/models.py`.
- [ ] Create database migration `009_gpu_health_history.sql` in `database/migrations/`.
- [ ] Implement `gpu_health/service.py`:
  - Bridges the pure engine with the database and Inferexe provider adapters.
- [ ] Implement `gpu_health/routes.py`:
  - FastAPI endpoints for `/api/v1/gpu/health`.
  - Mount router cleanly into `inference/main.py`.

## Phase 7: Verification & Test Harness
- [ ] Implement unit tests covering detection, multiple GPUs, unknown models, metric omissions, memory failures, timeouts, and readiness.
- [ ] Implement API route integration tests.
- [ ] Run full test suite using Python virtual environment.
