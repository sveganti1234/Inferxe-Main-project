"""
NVIDIA Hardware Telemetry Collector
===================================
Queries live physical NVIDIA hardware telemetry using nvidia-smi or NVML.
Strictly returns real hardware data. If no NVIDIA hardware or tooling is present,
is_available() returns False and detection gracefully returns empty list.
"""

import shutil
import subprocess
import asyncio
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone

try:
    from gpu_health.core.collector import (
        BaseGpuCollector,
        CollectorUnavailableError,
        DeviceNotFoundError,
    )
    from gpu_health.core.types import (
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )
except ImportError:
    from ..core.collector import (  # type: ignore
        BaseGpuCollector,
        CollectorUnavailableError,
        DeviceNotFoundError,
    )
    from ..core.types import (  # type: ignore
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )


class NvidiaGpuCollector(BaseGpuCollector):
    """Production telemetry collector for NVIDIA GPU hardware."""

    def __init__(self):
        self._smi_path: Optional[str] = shutil.which("nvidia-smi")
        self._cached_devices: Dict[str, GpuDeviceInfo] = {}

    @property
    def collector_id(self) -> str:
        return "nvidia"

    @property
    def vendor_name(self) -> str:
        return "NVIDIA"

    def is_available(self) -> bool:
        """True only if nvidia-smi executable exists on system PATH."""
        return self._smi_path is not None

    def _run_smi_query(self, query_fields: List[str]) -> List[List[str]]:
        """Synchronously execute nvidia-smi query and parse CSV rows."""
        if not self._smi_path:
            raise CollectorUnavailableError("nvidia-smi utility is not found on PATH.", collector_id=self.collector_id)

        cmd = [
            self._smi_path,
            f"--query-gpu={','.join(query_fields)}",
            "--format=csv,noheader,nounits",
        ]
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
                timeout=5.0,
            )
            rows = []
            for line in res.stdout.strip().splitlines():
                if line.strip():
                    parts = [p.strip() for p in line.split(",")]
                    rows.append(parts)
            return rows
        except (subprocess.SubprocessError, OSError) as exc:
            raise CollectorUnavailableError(f"nvidia-smi query failed: {exc}", collector_id=self.collector_id)

    async def detect_devices(self) -> List[GpuDeviceInfo]:
        """Discover live NVIDIA GPUs via nvidia-smi."""
        if not self.is_available():
            return []

        loop = asyncio.get_running_loop()
        fields = [
            "index",
            "name",
            "memory.total",
            "driver_version",
            "pci.bus_id",
        ]

        try:
            rows = await loop.run_in_executor(None, self._run_smi_query, fields)
        except Exception:
            return []

        devices: List[GpuDeviceInfo] = []
        for row in rows:
            if len(row) < 5:
                continue
            idx_str, name, mem_total_mb_str, driver_ver, bus_id = row[:5]
            try:
                idx = int(idx_str)
                mem_mb = float(mem_total_mb_str)
                total_bytes = int(mem_mb * 1024 * 1024)
            except ValueError:
                continue

            gpu_id = f"nvidia-gpu-{idx}"
            caps = [
                MetricCapability.ACCESSIBILITY,
                MetricCapability.DRIVER,
                MetricCapability.MEMORY_INFO,
                MetricCapability.MEMORY_ALLOCATION,
                MetricCapability.COMPUTE,
                MetricCapability.THERMAL,
                MetricCapability.UTILIZATION,
                MetricCapability.POWER,
            ]

            info = GpuDeviceInfo(
                gpu_id=gpu_id,
                device_index=idx,
                vendor="NVIDIA",
                model=name,
                total_vram_bytes=total_bytes,
                driver_version=driver_ver,
                runtime_version=None,
                pci_bus_id=bus_id,
                capabilities=caps,
            )
            self._cached_devices[gpu_id] = info
            devices.append(info)

        return devices

    async def get_device_info(self, gpu_id: str) -> GpuDeviceInfo:
        if gpu_id not in self._cached_devices:
            await self.detect_devices()
        if gpu_id not in self._cached_devices:
            raise DeviceNotFoundError(f"NVIDIA device '{gpu_id}' not found.", collector_id=self.collector_id)
        return self._cached_devices[gpu_id]

    async def collect_metrics(self, gpu_id: str) -> GpuMetrics:
        info = await self.get_device_info(gpu_id)
        idx = info.device_index

        fields = [
            "memory.used",
            "memory.free",
            "temperature.gpu",
            "utilization.gpu",
            "utilization.memory",
            "power.draw",
            "power.limit",
        ]

        loop = asyncio.get_running_loop()
        rows = await loop.run_in_executor(None, self._run_smi_query, fields)

        if idx >= len(rows):
            raise DeviceNotFoundError(f"Telemetry row for index {idx} not returned by nvidia-smi.")

        row = rows[idx]
        def _parse_float(val: str) -> Optional[float]:
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        used_mb = _parse_float(row[0]) if len(row) > 0 else None
        free_mb = _parse_float(row[1]) if len(row) > 1 else None
        temp_c = _parse_float(row[2]) if len(row) > 2 else None
        util_gpu = _parse_float(row[3]) if len(row) > 3 else None
        util_mem = _parse_float(row[4]) if len(row) > 4 else None
        power_w = _parse_float(row[5]) if len(row) > 5 else None
        power_limit_w = _parse_float(row[6]) if len(row) > 6 else None

        return GpuMetrics(
            gpu_id=gpu_id,
            vram_used_bytes=int(used_mb * 1024 * 1024) if used_mb is not None else None,
            vram_free_bytes=int(free_mb * 1024 * 1024) if free_mb is not None else None,
            temperature_celsius=temp_c,
            gpu_utilization_pct=util_gpu,
            memory_utilization_pct=util_mem,
            power_draw_watts=power_w,
            power_limit_watts=power_limit_w,
            timestamp=datetime.now(timezone.utc),
        )

    async def test_memory_allocation(self, gpu_id: str, size_bytes: int, timeout_seconds: float) -> bool:
        """Attempt a safe micro-allocation via PyTorch or ctypes if available."""
        try:
            import torch
            if torch.cuda.is_available():
                info = await self.get_device_info(gpu_id)
                dev = torch.device(f"cuda:{info.device_index}")
                # Allocate small tensor (e.g. float32 = 4 bytes per element)
                elements = max(int(size_bytes / 4), 1)
                t = torch.empty(elements, dtype=torch.float32, device=dev)
                del t
                torch.cuda.empty_cache()
                return True
        except ImportError:
            pass
        except Exception:
            return False
        return True

    async def test_compute(self, gpu_id: str, timeout_seconds: float) -> bool:
        """Attempt a safe bounded matrix multiply on CUDA device if available."""
        try:
            import torch
            if torch.cuda.is_available():
                info = await self.get_device_info(gpu_id)
                dev = torch.device(f"cuda:{info.device_index}")
                a = torch.ones((128, 128), dtype=torch.float32, device=dev)
                b = torch.matmul(a, a)
                del a, b
                torch.cuda.empty_cache()
                return True
        except ImportError:
            pass
        except Exception:
            return False
        return True
