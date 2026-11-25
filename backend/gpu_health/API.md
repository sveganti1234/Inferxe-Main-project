# GPU Health Check Engine — REST API Specification

This document details the HTTP REST API endpoints exposed by the GPU Health Check module under `/api/v1/gpu/health`.

## Base Path
```
/api/v1/gpu/health
```

## Authentication & Headers
- All endpoints support Inferexe Customer API Key authentication (`x-api-key` header) or Admin Session / JWT where applicable.
- Unauthenticated requests in production environments return `401 Unauthorized`.

---

## 1. List Health Information for All GPUs
Retrieve current health and summary telemetry across all detected GPUs.

- **Method**: `GET`
- **Path**: `/api/v1/gpu/health`
- **Query Parameters**:
  - `include_metrics` (boolean, default: `true`): Include full metric details.
  - `force_refresh` (boolean, default: `false`): Run a fresh scan instead of cached telemetry.
- **Success Response** (`200 OK`):
```json
{
  "total_gpus": 2,
  "healthy_count": 2,
  "warning_count": 0,
  "critical_count": 0,
  "unavailable_count": 0,
  "items": [
    {
      "gpu_id": "gpu-0",
      "device_info": {
        "device_id": "0",
        "vendor": "NVIDIA",
        "model": "NVIDIA H100 80GB HBM3",
        "total_vram_bytes": 85899345920,
        "driver_version": "550.54.15",
        "runtime_version": "CUDA 12.4",
        "pci_bus_id": "0000:01:00.0",
        "capabilities": ["thermal", "memory", "compute", "ecc", "power", "utilization"]
      },
      "overall_status": "healthy",
      "health_score": 98.5,
      "availability_status": "available",
      "timestamp": "2026-11-25T12:00:00Z",
      "execution_duration_ms": 42
    }
  ]
}
```

---

## 2. Get Health Report for a Specific GPU
Fetch the latest generated health report for a specific GPU ID.

- **Method**: `GET`
- **Path**: `/api/v1/gpu/health/{gpu_id}`
- **Success Response** (`200 OK`):
```json
{
  "gpu_id": "gpu-0",
  "device_info": { ... },
  "overall_status": "healthy",
  "health_score": 98.5,
  "availability_status": "available",
  "is_deployment_ready": true,
  "individual_checks": [
    {
      "check_name": "accessibility",
      "status": "passed",
      "message": "Device accessible via driver interface.",
      "duration_ms": 2.1,
      "metrics": {}
    },
    {
      "check_name": "thermal",
      "status": "passed",
      "message": "Core temperature 42.0°C within threshold 78.0°C.",
      "duration_ms": 3.4,
      "metrics": { "temperature_celsius": 42.0, "threshold_celsius": 78.0 }
    }
  ],
  "supported_metrics": ["temperature_celsius", "vram_used_bytes", "utilization_pct"],
  "unsupported_metrics": [],
  "errors": [],
  "recommendations": ["Device is in optimal operating state."],
  "timestamp": "2026-11-25T12:00:00Z",
  "execution_duration_ms": 55
}
```
- **Error Response** (`404 Not Found`):
```json
{
  "detail": "GPU with ID 'gpu-999' not found or not registered."
}
```

---

## 3. Run Live Health Check for a GPU
Trigger a fresh, synchronous health evaluation cycle on the target GPU.

- **Method**: `POST`
- **Path**: `/api/v1/gpu/health/{gpu_id}/check`
- **Request Body** (optional):
```json
{
  "timeout_seconds": 10.0,
  "custom_thresholds": {
    "warning_temp_celsius": 75.0,
    "critical_temp_celsius": 85.0
  },
  "persist_history": true
}
```
- **Success Response** (`200 OK`): Full `HealthReport` schema.

---

## 4. Check Deployment Readiness
Evaluate whether a specific GPU meets workload criteria for an upcoming model deployment.

- **Method**: `POST`
- **Path**: `/api/v1/gpu/health/{gpu_id}/readiness`
- **Request Body**:
```json
{
  "required_vram_bytes": 25769803776,
  "required_runtime": "cuda",
  "min_health_score": 80.0,
  "max_acceptable_temp_celsius": 80.0,
  "allow_shared": false
}
```
- **Success Response** (`200 OK`):
```json
{
  "gpu_id": "gpu-0",
  "is_ready": true,
  "overall_status": "healthy",
  "reasons": ["GPU is healthy and has 48.2 GB free VRAM (exceeds required 24.0 GB)."],
  "missing_requirements": [],
  "current_vram_available_bytes": 51754352640,
  "current_temp_celsius": 42.0
}
```
- **Incompatible Workload Response** (`200 OK` with `is_ready: false`):
```json
{
  "gpu_id": "gpu-0",
  "is_ready": false,
  "overall_status": "healthy",
  "reasons": ["Insufficient free VRAM: requested 70.0 GB, available 48.2 GB."],
  "missing_requirements": ["vram_capacity"],
  "current_vram_available_bytes": 51754352640,
  "current_temp_celsius": 42.0
}
```

---

## 5. Retrieve Health Check History
Retrieve past health check logs and evaluation records for audit and telemetry trends.

- **Method**: `GET`
- **Path**: `/api/v1/gpu/health/{gpu_id}/history`
- **Query Parameters**:
  - `limit` (integer, default: 20, max: 100): Number of records to return.
  - `offset` (integer, default: 0): Pagination offset.
- **Success Response** (`200 OK`):
```json
{
  "gpu_id": "gpu-0",
  "total": 45,
  "limit": 20,
  "offset": 0,
  "history": [
    {
      "id": "c1f7b0a8-...",
      "health_status": "healthy",
      "health_score": 98.5,
      "is_available": true,
      "is_deployment_ready": true,
      "summary": "All 7 health checks passed.",
      "created_at": "2026-11-25T11:50:00Z"
    }
  ]
}
```
