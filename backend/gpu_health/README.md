# GPU Health Check Engine

A robust, modular, and model-independent GPU health evaluation, telemetry collection, and deployment readiness engine for the Inferexe infrastructure platform.

## Highlights

- **Model & Vendor Agnostic**: Works seamlessly with any GPU model or vendor architecture.
- **Capability-Based Detection**: Dynamically discovers supported telemetry (thermal, power, memory, clocks, ECC errors) and gracefully skips unsupported features.
- **Orthogonal Status Design**: Distinct separation between physical health, instance availability, and deployment workload readiness.
- **Configurable Evaluation & Scoring**: Fine-tune thermal thresholds, memory boundaries, and scoring weights without modifying core engine code.
- **Non-Disruptive Functional Tests**: Safe, micro-bounded compute and memory verification that never interferes with live customer inference.
- **Zero-Dependency Core**: The core evaluation engine can be imported and executed in any Python environment (CLIs, workers, or web services).
- **FastAPI & Database Integration**: Out-of-the-box REST API routes, historical telemetry logging, and readiness checking.

## Module Structure

```
gpu_health/
├── __init__.py                # Module exports & version
├── AGENTS.md                  # Development rules and guidelines
├── README.md                  # This documentation
├── ARCHITECTURE.md            # System architecture and design contracts
├── API.md                     # REST API reference and payload schemas
├── IMPLEMENTATION_PLAN.md     # Phase-by-phase implementation plan
├── TESTING.md                 # Test harness, mock runner, and validation guide
├── core/                      # Pure domain models and engine
│   ├── __init__.py
│   ├── types.py               # Enums, Pydantic schemas, and data structures
│   ├── config.py              # HealthThresholds and engine configuration
│   ├── collector.py           # BaseGpuCollector interface
│   ├── checks.py              # BaseHealthCheck and check execution runner
│   ├── evaluator.py           # HealthEvaluator and scoring engine
│   ├── readiness.py           # DeploymentReadinessChecker
│   └── engine.py              # GpuHealthEngine orchestrator
├── collectors/                # Hardware-specific telemetry adapters
│   ├── __init__.py
│   ├── nvidia_collector.py    # NVML & nvidia-smi adapter
│   ├── mock_collector.py      # Configurable mock adapter for testing & CI
│   └── registry.py            # Collector discovery and registry
├── checks/                    # Modular health check implementations
│   ├── __init__.py
│   ├── accessibility_check.py # GPU presence and device enumeration
│   ├── driver_check.py        # Driver version and runtime responsiveness
│   ├── memory_check.py        # VRAM capacity, usage, and safe allocation
│   ├── compute_check.py       # Safe micro-computation verification
│   ├── thermal_check.py       # Temperature and thermal throttle status
│   ├── utilization_check.py   # Core compute & memory bus utilization
│   └── error_check.py         # Hardware errors, XID, and ECC events
├── models.py                  # SQLAlchemy ORM models for health history
├── service.py                 # Application service layer & persistence bridge
├── routes.py                  # FastAPI router (/api/v1/gpu/health)
└── tests/                     # Unit and integration test suite
```

## Quick Start (Python Engine Usage)

```python
from gpu_health.core.engine import GpuHealthEngine
from gpu_health.core.config import HealthThresholds
from gpu_health.core.types import DeploymentRequirement

# 1. Initialize engine with custom or default thresholds
thresholds = HealthThresholds(
    warning_temp_celsius=78.0,
    critical_temp_celsius=88.0,
    warning_vram_pct=85.0
)
engine = GpuHealthEngine(thresholds=thresholds)

# 2. Detect all available GPUs
devices = await engine.detect_gpus()
for dev in devices:
    print(f"Detected GPU: {dev.vendor} {dev.model} (VRAM: {dev.total_vram_bytes / (1024**3):.1f} GB)")

# 3. Run complete health check for a GPU
report = await engine.run_all_checks(gpu_id="gpu-0")
print(f"Health Status: {report.overall_status.value} | Score: {report.health_score}/100")
for check in report.individual_checks:
    print(f" - {check.check_name}: {check.status.value} ({check.message})")

# 4. Check deployment readiness for a workload
requirement = DeploymentRequirement(
    required_vram_bytes=16 * (1024**3),  # 16 GB
    required_runtime="cuda",
    max_acceptable_temp_celsius=80.0
)
readiness = await engine.check_deployment_readiness(gpu_id="gpu-0", requirement=requirement)
print(f"Deployment Ready: {readiness.is_ready} (Reason: {readiness.reason})")
```
