"""
Centralized LLM model registry (single source of truth for model metadata and GPU memory estimates).

Data lives in database/datasets/models/model_registry.json and is validated here with Pydantic when it is
loaded. The existing recommendation modules (inference/routing.py and inference/routing_engine.py) build
their model tables from this registry and use `estimate_memory_components`, so all three agree.

Two parameter counts are kept per model on purpose:
  * `params_billion`: the rounded planning value the recommendation APIs have always used. Keeping it
    unchanged keeps /recommend and /routing/recommend responses identical.
  * `params_total`: the exact count published for the checkpoint. `check_fit` (used for deployment
    decisions) uses this value when known, because rounding down under-estimates memory.

Memory model (an estimate, not a measurement): weights + KV cache + runtime overhead, compared against
VRAM x gpu_memory_utilization (vLLM's --gpu-memory-utilization). It does not model CUDA-graph memory or
activation peaks; real placements must be confirmed by loading the model and reading the KV-cache size
vLLM reports at startup.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

REGISTRY_PATH = Path(__file__).resolve().parents[2] / "database" / "datasets" / "models" / "model_registry.json"

ServingStatus = Literal["planned", "beta", "available", "estimate_only", "disabled"]
# Statuses for models that may be deployed (now or once validated); these need complete serving metadata.
DEPLOYABLE_STATUSES = frozenset({"planned", "beta", "available"})

_KEY_PATTERN = r"^[a-z0-9][a-z0-9.\-]*$"


class ModelRegistryError(Exception):
    """The registry file is missing or invalid."""


class UnknownModelError(KeyError):
    """The requested model key is not in the registry."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LicenseInfo(_Strict):
    name: str = Field(..., min_length=1)
    spdx: Optional[str] = None
    url: str = Field(..., min_length=1)
    commercial_use: bool
    attribution_required: bool
    requires_acceptance: bool
    restrictions: List[str] = Field(default_factory=list)


class ArchitectureInfo(_Strict):
    hf_architecture: str = Field(..., min_length=1)
    num_hidden_layers: int = Field(..., gt=0)
    num_attention_heads: int = Field(..., gt=0)
    num_key_value_heads: int = Field(..., gt=0)
    head_dim: int = Field(..., gt=0)
    hidden_size: int = Field(..., gt=0)
    torch_dtype: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _heads_divide(self) -> "ArchitectureInfo":
        if self.num_attention_heads % self.num_key_value_heads:
            raise ValueError("num_attention_heads must be a multiple of num_key_value_heads")
        return self

    def kv_bytes_per_token(self, bytes_per_element: int = 2) -> int:
        """KV cache per token: 2 (K and V) x layers x KV heads x head_dim x bytes per element."""
        return 2 * self.num_hidden_layers * self.num_key_value_heads * self.head_dim * bytes_per_element


class ContextInfo(_Strict):
    native_context: int = Field(..., gt=0)
    max_context: int = Field(..., gt=0)
    default_max_model_len: int = Field(..., gt=0)
    long_context_note: Optional[str] = None

    @model_validator(mode="after")
    def _ordering(self) -> "ContextInfo":
        if self.native_context > self.max_context:
            raise ValueError("native_context cannot exceed max_context")
        if self.default_max_model_len > self.max_context:
            raise ValueError("default_max_model_len cannot exceed max_context")
        return self


class QuantVariant(_Strict):
    hf_repo: str = Field(..., pattern=r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$")
    publisher: Literal["official", "third_party"]
    estimation_quant: str


class QuantizationInfo(_Strict):
    default: str
    variants: Dict[str, QuantVariant] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _default_exists(self) -> "QuantizationInfo":
        if self.default not in self.variants:
            raise ValueError(f"default quantization '{self.default}' is not one of the variants")
        return self


class VllmInfo(_Strict):
    min_version: Optional[str] = Field(default=None, pattern=r"^\d+\.\d+(\.\d+)?$")
    extra_args: List[str] = Field(default_factory=list)
    supported_tensor_parallel_sizes: List[int] = Field(..., min_length=1)
    recommended_temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    notes: Optional[str] = None

    @field_validator("supported_tensor_parallel_sizes")
    @classmethod
    def _tp_sizes(cls, v: List[int]) -> List[int]:
        if any(n < 1 for n in v) or len(set(v)) != len(v) or 1 not in v:
            raise ValueError("tensor parallel sizes must be unique, positive and include 1")
        return v


class PlacementRecommendation(_Strict):
    gpu_class: str
    gpu_count: int = Field(..., ge=1, le=8)
    quantization: str
    max_model_len: int = Field(..., gt=0)
    tier: Literal["minimum", "recommended", "premium"]
    note: Optional[str] = None


class VerificationInfo(_Strict):
    status: Literal["documented", "validated_on_hardware", "repo_legacy"]
    checked_on: Optional[str] = None
    notes: Optional[str] = None


class ModelEntry(_Strict):
    key: str = Field(..., pattern=_KEY_PATTERN)
    display_name: str = Field(..., min_length=1)
    family: Literal["Qwen", "Llama", "Mistral"]
    serving_status: ServingStatus
    serving_types: List[Literal["selfhosted", "nim"]] = Field(default_factory=list)
    hf_repo: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$")
    hf_revision: Optional[str] = None
    gated: Optional[bool] = None
    license: Optional[LicenseInfo] = None
    params_billion: float = Field(..., gt=0)
    params_total: Optional[int] = Field(default=None, gt=0)
    architecture: Optional[ArchitectureInfo] = None
    architecture_label: str = Field(..., min_length=1)
    kv_bytes_per_token: int = Field(..., gt=0)
    context: Optional[ContextInfo] = None
    quantization: Optional[QuantizationInfo] = None
    vllm: Optional[VllmInfo] = None
    recommended_placements: List[PlacementRecommendation] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)
    verification: VerificationInfo

    @property
    def is_deployable_status(self) -> bool:
        return self.serving_status in DEPLOYABLE_STATUSES

    @property
    def params_for_sizing(self) -> float:
        """Parameter count (billions) for deployment sizing: the exact count when known, else the planning value."""
        return self.params_total / 1e9 if self.params_total else self.params_billion

    @model_validator(mode="after")
    def _consistency(self) -> "ModelEntry":
        if self.architecture is not None and self.architecture.kv_bytes_per_token() != self.kv_bytes_per_token:
            raise ValueError(
                f"kv_bytes_per_token {self.kv_bytes_per_token} does not match the architecture "
                f"({self.architecture.kv_bytes_per_token()})"
            )
        if self.params_total is not None and abs(self.params_billion - self.params_total / 1e9) > 0.5:
            raise ValueError("params_billion is more than 0.5B away from params_total")

        if self.is_deployable_status:
            missing = [
                name for name in ("hf_repo", "license", "architecture", "context", "quantization", "vllm")
                if getattr(self, name) is None
            ]
            if self.gated is None:
                missing.append("gated")
            if not self.serving_types:
                missing.append("serving_types")
            if not self.recommended_placements:
                missing.append("recommended_placements")
            if not self.sources:
                missing.append("sources")
            if missing:
                raise ValueError(f"serving_status '{self.serving_status}' requires: {', '.join(missing)}")
            if self.gated and not self.license.requires_acceptance:
                raise ValueError("a gated model must have license.requires_acceptance = true")
            bf16 = self.quantization.variants.get("bf16")
            if bf16 is not None and bf16.hf_repo != self.hf_repo:
                raise ValueError("the bf16 variant must use the model's own hf_repo")
        elif self.serving_types:
            raise ValueError(f"serving_status '{self.serving_status}' cannot declare serving_types")

        if self.vllm is not None and self.architecture is not None:
            for tp in self.vllm.supported_tensor_parallel_sizes:
                if self.architecture.num_attention_heads % tp or self.architecture.num_key_value_heads % tp:
                    raise ValueError(f"tensor parallel size {tp} does not divide the attention/KV heads")

        for p in self.recommended_placements:
            if self.quantization is None or p.quantization not in self.quantization.variants:
                raise ValueError(f"placement quantization '{p.quantization}' is not a registered variant")
            if self.context is not None and p.max_model_len > self.context.max_context:
                raise ValueError("placement max_model_len exceeds max_context")
            if self.vllm is not None and p.gpu_count not in self.vllm.supported_tensor_parallel_sizes:
                raise ValueError(f"placement gpu_count {p.gpu_count} is not a supported tensor parallel size")
        return self


class GpuClass(_Strict):
    name: str = Field(..., min_length=1)
    vram_gb: float = Field(..., gt=0)
    architecture: str = Field(..., min_length=1)
    fp8_native: bool


class RegistryDefaults(_Strict):
    gpu_memory_utilization: float = Field(..., gt=0, le=1)
    overhead_base_gb: float = Field(..., ge=0)
    overhead_per_weight_gb: float = Field(..., ge=0)
    default_max_model_len: int = Field(..., gt=0)
    low_headroom_gb: float = Field(..., ge=0)


class ModelRegistry(_Strict):
    schema_version: Literal[1]
    updated_on: str
    description: Optional[str] = None
    estimation_quant_bytes: Dict[str, float] = Field(..., min_length=1)
    defaults: RegistryDefaults
    gpu_classes: Dict[str, GpuClass]
    models: List[ModelEntry] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _cross_checks(self) -> "ModelRegistry":
        if any(b <= 0 for b in self.estimation_quant_bytes.values()):
            raise ValueError("estimation_quant_bytes values must be positive")
        keys = [m.key for m in self.models]
        duplicates = sorted({k for k in keys if keys.count(k) > 1})
        if duplicates:
            raise ValueError(f"duplicate model keys: {', '.join(duplicates)}")
        lowered = [k.lower() for k in keys]
        if len(set(lowered)) != len(lowered):
            raise ValueError("model keys must be unique ignoring case")
        for m in self.models:
            if m.quantization is not None:
                for name, v in m.quantization.variants.items():
                    if v.estimation_quant not in self.estimation_quant_bytes:
                        raise ValueError(f"{m.key}: variant '{name}' uses unknown estimation_quant '{v.estimation_quant}'")
            for p in m.recommended_placements:
                if p.gpu_class not in self.gpu_classes:
                    raise ValueError(f"{m.key}: placement uses unknown gpu_class '{p.gpu_class}'")
        return self

    # --- lookup -------------------------------------------------------------------------------------

    def keys(self) -> List[str]:
        return [m.key for m in self.models]

    def find(self, key: Optional[str]) -> Optional[ModelEntry]:
        """Case-insensitive lookup; None when the key is unknown."""
        if not isinstance(key, str):
            return None
        wanted = key.strip().lower()
        return next((m for m in self.models if m.key.lower() == wanted), None)

    def get(self, key: str) -> ModelEntry:
        entry = self.find(key)
        if entry is None:
            raise UnknownModelError(key)
        return entry

    def list(self, *, serving_status: Optional[str] = None, deployable_only: bool = False) -> List[ModelEntry]:
        return [
            m for m in self.models
            if (serving_status is None or m.serving_status == serving_status)
            and (not deployable_only or m.is_deployable_status)
        ]


# --- loading -----------------------------------------------------------------------------------------

def parse_registry(data: dict) -> ModelRegistry:
    """Validate raw registry data; raises ModelRegistryError with the validation details."""
    try:
        return ModelRegistry.model_validate(data)
    except ValidationError as err:
        raise ModelRegistryError(f"Invalid model registry: {err}") from err


def load_registry_file(path: Path) -> ModelRegistry:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise ModelRegistryError(f"Cannot read model registry {Path(path).name}: {err}") from err
    return parse_registry(data)


@lru_cache(maxsize=1)
def get_registry() -> ModelRegistry:
    """The validated registry, read once per process (like inference.catalog.load_catalog)."""
    return load_registry_file(REGISTRY_PATH)


def get_model(key: str) -> ModelEntry:
    return get_registry().get(key)


def find_model(key: Optional[str]) -> Optional[ModelEntry]:
    return get_registry().find(key)


def model_keys() -> List[str]:
    return get_registry().keys()


def quant_bytes(quant: str) -> float:
    """Bytes per parameter for an estimation quantization key (fp16, bf16, fp8, int8, int4)."""
    table = get_registry().estimation_quant_bytes
    try:
        return table[quant]
    except KeyError:
        raise KeyError(f"Unknown quantization '{quant}'. Known: {', '.join(table)}") from None


# --- memory estimation -------------------------------------------------------------------------------

@dataclass(frozen=True)
class MemoryEstimate:
    weights_gb: float
    kv_cache_gb: float
    overhead_gb: float
    total_gb: float


def estimate_memory_components(
    params_billion: float,
    kv_bytes_per_token: int,
    bytes_per_param: float,
    context_tokens: int,
    concurrency: int,
    *,
    overhead_base_gb: Optional[float] = None,
    overhead_per_weight_gb: Optional[float] = None,
) -> MemoryEstimate:
    """GPU memory needed (decimal GB): weights + KV cache (every sequence at full context) + overhead.

    The arithmetic and its order match the formula the recommendation APIs and frontend calc.ts have
    always used, so results are bit-for-bit identical.
    """
    defaults = get_registry().defaults
    base = defaults.overhead_base_gb if overhead_base_gb is None else overhead_base_gb
    per_weight = defaults.overhead_per_weight_gb if overhead_per_weight_gb is None else overhead_per_weight_gb
    weights = params_billion * bytes_per_param
    kv = context_tokens * concurrency * kv_bytes_per_token / 1e9
    overhead = base + per_weight * weights
    return MemoryEstimate(weights_gb=weights, kv_cache_gb=kv, overhead_gb=overhead, total_gb=weights + kv + overhead)


def _resolve_quant(entry: ModelEntry, quantization: Optional[str]) -> tuple:
    """(variant name or None, estimation quant key) for a model; accepts variant names or raw quant keys."""
    if quantization is None:
        if entry.quantization is None:
            raise ValueError(f"Model '{entry.key}' has no default quantization; pass one explicitly.")
        quantization = entry.quantization.default
    if entry.quantization is not None and quantization in entry.quantization.variants:
        return quantization, entry.quantization.variants[quantization].estimation_quant
    quant_bytes(quantization)  # raises for unknown keys
    return None, quantization


def estimate_model_memory(
    model_key: str,
    quantization: Optional[str] = None,
    context_tokens: Optional[int] = None,
    concurrency: int = 1,
    *,
    use_exact_params: bool = True,
) -> MemoryEstimate:
    """Memory estimate for a registered model. `quantization` may be a variant name (bf16, fp8, awq) or an
    estimation key (fp16, fp8, int4...). Uses the exact parameter count unless use_exact_params=False."""
    entry = get_model(model_key)
    _, est_quant = _resolve_quant(entry, quantization)
    if context_tokens is None:
        context_tokens = entry.context.default_max_model_len if entry.context else get_registry().defaults.default_max_model_len
    if context_tokens <= 0 or concurrency <= 0:
        raise ValueError("context_tokens and concurrency must be positive")
    params = entry.params_for_sizing if use_exact_params else entry.params_billion
    return estimate_memory_components(params, entry.kv_bytes_per_token, quant_bytes(est_quant), context_tokens, concurrency)


@dataclass(frozen=True)
class FitResult:
    model_key: str
    quantization: str
    gpu_vram_gb: float
    gpu_count: int
    max_model_len: int
    concurrency: int
    gpu_memory_utilization: float
    memory: Optional[MemoryEstimate]
    usable_vram_gb: float
    fits: bool
    headroom_gb: Optional[float]
    kv_token_capacity: Optional[int]
    max_concurrent_sequences: Optional[int]
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def check_fit(
    model_key: str,
    *,
    gpu_vram_gb: float,
    gpu_count: int = 1,
    quantization: Optional[str] = None,
    max_model_len: Optional[int] = None,
    concurrency: int = 1,
    gpu_memory_utilization: Optional[float] = None,
    gpu_fp8_native: Optional[bool] = None,
) -> FitResult:
    """Can this model run on `gpu_count` GPUs of `gpu_vram_gb` each? Returns blocking reasons and warnings.

    Blocking checks: model is deployable, quantization is a registered variant, max_model_len is within the
    model's limit, gpu_count is a supported tensor-parallel size, and estimated memory fits usable VRAM.
    `kv_token_capacity` is how many KV-cache tokens remain after weights and overhead; `max_concurrent_sequences`
    is how many full-length sequences that holds.
    """
    if gpu_vram_gb <= 0 or gpu_count < 1 or concurrency < 1:
        raise ValueError("gpu_vram_gb, gpu_count and concurrency must be positive")
    registry = get_registry()
    entry = registry.get(model_key)
    util = registry.defaults.gpu_memory_utilization if gpu_memory_utilization is None else gpu_memory_utilization
    if not 0 < util <= 1:
        raise ValueError("gpu_memory_utilization must be in (0, 1]")
    usable = gpu_vram_gb * gpu_count * util
    reasons: List[str] = []
    warnings: List[str] = []

    if not entry.is_deployable_status:
        reasons.append(f"Model '{entry.key}' is '{entry.serving_status}' and cannot be deployed.")
    if entry.quantization is None or entry.context is None or entry.vllm is None:
        return FitResult(entry.key, quantization or "", gpu_vram_gb, gpu_count, max_model_len or 0, concurrency,
                         util, None, usable, False, None, None, None, reasons or ["Model has no serving metadata."], warnings)

    variant_name = quantization or entry.quantization.default
    if variant_name not in entry.quantization.variants:
        reasons.append(
            f"Quantization '{variant_name}' is not available for {entry.key}. "
            f"Available: {', '.join(entry.quantization.variants)}."
        )
        return FitResult(entry.key, variant_name, gpu_vram_gb, gpu_count, max_model_len or 0, concurrency,
                         util, None, usable, False, None, None, None, reasons, warnings)
    variant = entry.quantization.variants[variant_name]

    mml = entry.context.default_max_model_len if max_model_len is None else max_model_len
    if mml <= 0:
        raise ValueError("max_model_len must be positive")
    if mml > entry.context.max_context:
        reasons.append(f"max_model_len {mml} exceeds the model limit of {entry.context.max_context}.")
    elif mml > entry.context.native_context:
        warnings.append(
            f"max_model_len {mml} exceeds the native context {entry.context.native_context}; "
            "requires rope scaling (see the model's long_context_note)."
        )
    if gpu_count not in entry.vllm.supported_tensor_parallel_sizes:
        reasons.append(
            f"{gpu_count} GPUs is not a supported tensor-parallel size "
            f"({', '.join(map(str, entry.vllm.supported_tensor_parallel_sizes))})."
        )
    if variant.estimation_quant == "fp8" and gpu_fp8_native is False:
        warnings.append("This GPU has no native FP8 support; FP8 performance must be validated before offering it.")
    if variant.publisher == "third_party":
        warnings.append(f"Uses a third-party checkpoint ({variant.hf_repo}); validate quality before offering it.")
    if entry.gated:
        warnings.append("Gated model: the deployment needs a Hugging Face token with accepted licence terms.")

    memory = estimate_model_memory(entry.key, variant_name, mml, concurrency)
    fits_memory = memory.total_gb <= usable
    if not fits_memory:
        reasons.append(
            f"Needs about {memory.total_gb:.1f} GB but only {usable:.1f} GB is usable "
            f"({gpu_count} x {gpu_vram_gb:g} GB at {util:.0%})."
        )
    spare_for_kv = usable - memory.weights_gb - memory.overhead_gb
    kv_tokens = max(0, math.floor(spare_for_kv * 1e9 / entry.kv_bytes_per_token)) if spare_for_kv > 0 else 0
    headroom = usable - memory.total_gb
    if fits_memory and headroom < registry.defaults.low_headroom_gb:
        warnings.append(f"Only {headroom:.2f} GB headroom; real usage may not fit. Validate on hardware.")

    return FitResult(
        model_key=entry.key,
        quantization=variant_name,
        gpu_vram_gb=gpu_vram_gb,
        gpu_count=gpu_count,
        max_model_len=mml,
        concurrency=concurrency,
        gpu_memory_utilization=util,
        memory=memory,
        usable_vram_gb=usable,
        fits=not reasons,
        headroom_gb=headroom,
        kv_token_capacity=kv_tokens,
        max_concurrent_sequences=kv_tokens // mml,
        reasons=reasons,
        warnings=warnings,
    )


def check_fit_on_gpu_class(model_key: str, gpu_class: str, gpu_count: int = 1, **kwargs) -> FitResult:
    """check_fit using a registered GPU class (VRAM and native-FP8 support come from the registry)."""
    gpu = get_registry().gpu_classes.get(gpu_class)
    if gpu is None:
        raise KeyError(f"Unknown gpu_class '{gpu_class}'")
    return check_fit(model_key, gpu_vram_gb=gpu.vram_gb, gpu_count=gpu_count, gpu_fp8_native=gpu.fp8_native, **kwargs)
