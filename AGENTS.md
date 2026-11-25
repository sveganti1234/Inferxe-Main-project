# Project Rules & Instructions for GPU Health Check Engine

This document defines the overarching rules, development standards, and agent instructions for working on the Inferexe GPU infrastructure backend, specifically the GPU Health Check Engine.

## Core Directives

1. **GPU-Model-Independent Architecture**
   - Never hardcode GPU models (e.g. H100, L40S, A100) into health check logic, thresholds, or evaluation rules.
   - Any GPU hardware must be evaluated dynamically through capabilities and runtime telemetry.

2. **Decoupled & Reusable Core Engine**
   - The core health engine (`backend/gpu_health/core/`) must have zero dependencies on FastAPI routes, database ORM models, or frontend UI components.
   - It must be easily importable as a standalone Python library by other backend services, CLI tools, or background workers.

3. **Capability-Based Detection & Collection**
   - Hardware detection and metrics collection must query what the hardware and driver actually support.
   - If a capability (e.g., power draw, ECC error counts, thermal sensor) is missing, mark the metric as `unsupported`. Never treat unsupported metrics as 0 or as failures.

4. **Vendor-Specific Collectors as Optional Adapters**
   - The engine core defines abstract collector interfaces.
   - Vendor implementations (NVIDIA NVML, AMD ROCm/SMI, Intel XPU) are optional pluggable adapters. If a collector's libraries or hardware are absent, gracefully skip without crashing.

5. **Strict Metric Integrity**
   - Never replace missing hardware telemetry with fake or fabricated numbers in production mode.
   - Mock data is strictly reserved for unit/integration tests and must be explicitly labeled (`source: mock`).

6. **Orthogonal Statuses: Health, Availability, and Readiness**
   - **Health**: Hardware physical and operational condition (`healthy`, `warning`, `critical`, `unknown`, `unavailable`).
   - **Availability**: Whether the GPU is currently idle or allocated to an active workload (`available`, `allocated`, `draining`, `reserved`).
   - **Deployment Readiness**: Whether the GPU satisfies specific workload constraints (e.g., sufficient free VRAM, acceptable temperature, compatible runtime).

7. **Configurable Thresholds**
   - Thermal limits, memory pressure percentages, and timeout durations must be configurable per instance, cluster, or request. Default fallback values must be sane and standard.

8. **Bounded & Non-Disruptive Execution**
   - Functional checks (e.g. memory allocation, compute test) must be strictly bounded in compute size (small matrix/tensor operations) and enforce configurable execution timeouts.
   - Never run stress benchmarks or heavy compute loops that disrupt active customer workloads.

9. **Inferexe Compatibility & System Integrity**
   - Do not break existing inference endpoints, provider adapters, database models, or customer-facing APIs.
   - Keep new dependencies minimal, relying on standard library or already present packages (Pydantic, SQLAlchemy, httpx, asyncio).

10. **Consistent Error Handling and Logging**
    - Provide structured logging and typed exception hierarchies (`GpuHealthError`, `CollectorError`, `EvaluationError`, `ReadinessError`).
    - API endpoints must return standard HTTP status codes and structured Pydantic response payloads.
