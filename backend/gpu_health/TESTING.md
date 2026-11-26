# GPU Health Check Engine — Testing & Validation Strategy

## 1. Test Philosophy
To guarantee production stability without requiring continuous access to physical datacenter GPUs, the test suite leverages deterministic, capability-aware mock adapters while providing seamless hooks for live hardware execution.

## 2. Test Coverage Requirements

The test suite must validate:
1. **GPU Detection**: Single GPU, multi-GPU clusters, and zero-GPU fallback.
2. **Model Independence**: Arbitrary, custom, or unknown GPU vendor/model strings.
3. **Capability Handling**: Proper handling of missing or partial metric capabilities (ensuring unsupported metrics are not treated as failures or 0 values).
4. **Health Evaluation & Scoring**:
   - Healthy state (low temp, low VRAM usage).
   - Warning state (moderately high temp or memory saturation).
   - Critical state (thermal throttling, driver error, ECC alert).
   - Score calculation omitting unsupported metrics.
5. **Bounded Operations & Timeouts**:
   - Micro-allocation safety and immediate cleanup.
   - Micro-compute timeout triggering `FAILED` or `WARNING` check without deadlocking.
6. **Deployment Readiness**:
   - Workload requesting more VRAM than available -> `is_ready: false` with explanatory reason.
   - GPU currently allocated -> `is_ready: false`.
   - GPU in critical thermal state -> `is_ready: false`.
   - Workload within capacity -> `is_ready: true`.
7. **API Route Handling**:
   - Proper HTTP status codes (200, 400, 404, 500).
   - Pydantic response contract validation.
8. **Inferexe Non-Regression**:
   - Verify that existing provider adapters (`test_provider_adapters.py`) and routing tests remain 100% green.

## 3. Mock Adapter Capabilities

The `MockGpuCollector` provides deterministic test fixtures:
- `healthy_h100`: High VRAM, normal temp (38°C), 0% error rate.
- `degraded_l40s`: High temp (82°C), moderate memory pressure (88%).
- `critical_a100`: Critical temp (92°C), ECC errors present.
- `legacy_gpu_no_telemetry`: Only reports total VRAM, no thermal/power/ECC sensors.
- `timeout_gpu`: Injected latency exceeding configured check timeout.

## 4. Running Tests

Execute test suites using the project Python virtual environment:
```powershell
.\backend\venv\Scripts\python.exe -m unittest backend\gpu_health\tests\test_core_engine.py
.\backend\venv\Scripts\python.exe -m unittest backend\gpu_health\tests\test_collectors.py
.\backend\venv\Scripts\python.exe -m unittest backend\gpu_health\tests\test_readiness.py
.\backend\venv\Scripts\python.exe -m unittest backend\gpu_health\tests\test_api_routes.py
```
