# GPU Health Check Engine — Architecture & Design

## 1. Architectural Philosophy

The GPU Health Check Engine is designed around four foundational principles:

1. **Vendor & Model Decoupling**: Hardware variations (NVIDIA, AMD, Intel, Cloud virtual GPUs) are encapsulated behind uniform collector interfaces.
2. **Capability-Driven Collection**: Telemetry is queried dynamically based on runtime device capabilities rather than static assumptions.
3. **Orthogonality of State**: Physical hardware health, allocation availability, and workload suitability are evaluated independently.
4. **Isolated Pure Core**: The domain logic in `gpu_health.core` has no dependency on web frameworks or persistence engines.

## 2. High-Level Component Diagram

```
+---------------------------------------------------------------------------------+
|                                 Consumer Layer                                  |
|  (FastAPI Routes / CLI Admin Tools / Deployment Scheduler / Provider Adapters)  |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                       Service Layer (`gpu_health.service`)                      |
|       - Coordinates Engine with Database (SQLAlchemy / Supabase)                |
|       - Interfaces with Inferexe Provider Adapters (JarvisLabs, Mock)          |
|       - Handles background telemetry logging & history queries                  |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                     Core Engine (`gpu_health.core.engine`)                      |
|       - Coordinates Collectors, Checks, Evaluators, and Readiness               |
+---------------------------------------------------------------------------------+
          |                                  |                        |
          v                                  v                        v
+--------------------+             +--------------------+   +-------------------+
| Check Orchestrator |             |  Health Evaluator  |   | Readiness Checker |
| (`core.checks`)    |             | (`core.evaluator`) |   | (`core.readiness`)|
+--------------------+             +--------------------+   +-------------------+
          |                                  |                        |
          +----------------------------------+------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                       Collector Layer (`gpu_health.collectors`)                |
|  - Abstract: `BaseGpuCollector`                                                 |
|  - Implementations: `NvidiaCollector` (NVML/smi), `MockCollector` (testing)     |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                         Physical / Virtual Hardware                             |
|           (NVML C-types, nvidia-smi CLI, SysFS, Mock Hardware)                 |
+---------------------------------------------------------------------------------+
```

## 3. Data Flow & Evaluation Lifecycle

1. **Detection Phase**:
   - `CollectorRegistry` queries active collectors to identify available GPUs.
   - Returns a list of `GpuDeviceInfo` describing vendor, model, total VRAM, driver/runtime version, and reported capabilities (`THERMAL_SENSORS`, `POWER_MONITORING`, `ECC_REPORTING`, `MEMORY_INFO`, etc.).

2. **Metrics Collection Phase**:
   - For a given GPU ID, the collector scrapes metrics according to its declared capabilities.
   - Returns structured `GpuMetrics` containing memory (used/free), temperatures, clock frequencies, power draw, PCIe bandwidth, and error flags.

3. **Check Execution Phase**:
   - Individual checks (`AccessibilityCheck`, `DriverCheck`, `MemoryCheck`, `ComputeCheck`, `ThermalCheck`, `UtilizationCheck`, `ErrorCheck`) run sequentially or concurrently.
   - Each check checks if the necessary capability is present:
     - If capability is missing: returns `CheckResultStatus.UNSUPPORTED` with a clear explanation.
     - If check runs: bounds execution within a configurable timeout (`check_timeout_seconds`), records duration, and returns `PASSED`, `WARNING`, or `FAILED`.

4. **Health Evaluation & Scoring Phase**:
   - `HealthEvaluator` ingests `GpuDeviceInfo`, `GpuMetrics`, and all check results.
   - Evaluates metrics against configurable `HealthThresholds` (e.g., warning at 78°C, critical at 88°C).
   - Generates an overall `HealthStatus`:
     - `HEALTHY`: All supported checks passed without warning.
     - `WARNING`: Non-fatal anomalies detected (e.g., moderately high temp or memory pressure).
     - `CRITICAL`: Severe conditions (e.g., thermal throttle, uncorrectable ECC errors, compute failure, driver crash).
     - `UNAVAILABLE`: Device physically or logically unreachable.
     - `UNKNOWN`: Insufficient telemetry to determine state.
   - Calculates a normalized `health_score` (0-100) based strictly on supported checks and telemetry.

5. **Readiness Evaluation Phase**:
   - Given a specific `DeploymentRequirement` (required VRAM, runtime version, maximum allowable temperature, exclusive allocation requirement):
   - Computes whether the GPU is ready to immediately accept the workload.
   - If not ready, outputs precise blocking reasons (e.g., "Insufficient available VRAM: requested 24GB, available 8GB").

6. **Standardized Report Assembly**:
   - Synthesizes findings into a unified `HealthReport` containing detected information, overall status, score, availability, individual check details, supported/unsupported metrics, and action recommendations.

## 4. Orthogonality Model

| Dimension | Definition | Possible States | Independent of |
| :--- | :--- | :--- | :--- |
| **Physical Health** | Hardware operational soundness and integrity | `healthy`, `warning`, `critical`, `unknown`, `unavailable` | Current workload allocation |
| **Availability** | Instance scheduling and lease status | `available`, `busy`, `allocated`, `draining`, `offline` | Workload memory requirements |
| **Deployment Readiness** | Workload-specific compatibility & fit | `is_ready: true/false`, with detailed requirement match | Overall system lifetime |

A GPU can be 100% `healthy` (no hardware defects, normal temperature), but `busy` (running another model), meaning it is not `ready` for a new deployment. Conversely, a GPU might be `available` (0% load) but `critical` (fan failure or ECC error), thus also not `ready`.
