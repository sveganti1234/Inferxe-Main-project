"""Central model registry: validation, lookup, memory estimation, fit checks, and parity with the
recommendation modules, the RecommendRequest schema and the frontend model catalogue."""

import copy
import json
import os
import re
import sys
import typing
import uuid
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("INFERXE_TEST_MODE", "1")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402

from inference import model_registry as mr  # noqa: E402
from inference import routing, routing_engine  # noqa: E402
from inference.schemas import RecommendRequest  # noqa: E402

FRONTEND_SRC = BACKEND_DIR.parent / "frontend" / "src"
SELECTED = ["qwen2.5-7b", "llama-3.1-8b", "qwen2.5-14b", "mistral-small-24b", "qwen2.5-32b"]
LEGACY = ["mistral-7b", "llama-3.1-70b"]

# Facts from each model's official config.json / model card (see the registry's `sources`).
EXPECTED = {
    "qwen2.5-7b": dict(repo="Qwen/Qwen2.5-7B-Instruct", arch="Qwen2ForCausalLM", layers=28, heads=28, kv=4, head_dim=128,
                       total=7615616512, spdx="Apache-2.0", gated=False, native=32768),
    "llama-3.1-8b": dict(repo="meta-llama/Llama-3.1-8B-Instruct", arch="LlamaForCausalLM", layers=32, heads=32, kv=8,
                         head_dim=128, total=8030261248, spdx=None, gated=True, native=131072),
    "qwen2.5-14b": dict(repo="Qwen/Qwen2.5-14B-Instruct", arch="Qwen2ForCausalLM", layers=48, heads=40, kv=8, head_dim=128,
                        total=14770033664, spdx="Apache-2.0", gated=False, native=32768),
    "mistral-small-24b": dict(repo="mistralai/Mistral-Small-24B-Instruct-2501", arch="MistralForCausalLM", layers=40,
                              heads=32, kv=8, head_dim=128, total=23572403200, spdx="Apache-2.0", gated=False, native=32768),
    "qwen2.5-32b": dict(repo="Qwen/Qwen2.5-32B-Instruct", arch="Qwen2ForCausalLM", layers=64, heads=40, kv=8, head_dim=128,
                        total=32763876352, spdx="Apache-2.0", gated=False, native=32768),
}


def raw_registry() -> dict:
    return json.loads(mr.REGISTRY_PATH.read_text(encoding="utf-8"))


def model_dict(data: dict, key: str) -> dict:
    return next(m for m in data["models"] if m["key"] == key)


def assert_invalid(data: dict, match: str):
    with pytest.raises(mr.ModelRegistryError, match=match):
        mr.parse_registry(data)


# --- the registry file -----------------------------------------------------------------------------

def test_registry_file_loads_and_validates():
    reg = mr.get_registry()
    assert reg.schema_version == 1
    assert reg.keys() == ["qwen2.5-7b", "llama-3.1-8b", "mistral-7b", "qwen2.5-14b",
                          "mistral-small-24b", "qwen2.5-32b", "llama-3.1-70b"]


def test_exactly_the_five_selected_models_are_deployable():
    assert [m.key for m in mr.get_registry().list(deployable_only=True)] == SELECTED
    for key in SELECTED:
        m = mr.get_model(key)
        assert m.serving_status == "planned"  # documented, not yet validated on hardware
        assert m.serving_types == ["selfhosted"]
        assert m.verification.status == "documented"


@pytest.mark.parametrize("key", SELECTED)
def test_selected_model_has_complete_verified_metadata(key):
    m, exp = mr.get_model(key), EXPECTED[key]
    assert m.hf_repo == exp["repo"] and m.gated is exp["gated"]
    a = m.architecture
    assert (a.hf_architecture, a.num_hidden_layers, a.num_attention_heads, a.num_key_value_heads, a.head_dim) == (
        exp["arch"], exp["layers"], exp["heads"], exp["kv"], exp["head_dim"])
    assert m.params_total == exp["total"]
    assert m.kv_bytes_per_token == 2 * exp["layers"] * exp["kv"] * exp["head_dim"] * 2
    assert m.license.spdx == exp["spdx"] and m.license.commercial_use and m.license.url
    assert m.context.native_context == exp["native"] and m.context.default_max_model_len == 8192
    assert m.quantization.variants["bf16"].hf_repo == m.hf_repo
    assert m.vllm.supported_tensor_parallel_sizes and m.recommended_placements and m.sources


def test_llama_licence_terms_and_gating():
    lic = mr.get_model("llama-3.1-8b").license
    assert lic.requires_acceptance and lic.attribution_required
    text = " ".join(lic.restrictions)
    assert "700 million" in text and "Built with Llama" in text and "Acceptable Use Policy" in text


def test_mistral_small_uses_2501_with_mistral_formats():
    m = mr.get_model("mistral-small-24b")
    assert m.hf_repo.endswith("-2501") and m.context.max_context == 32768
    assert m.vllm.min_version == "0.6.4" and m.vllm.recommended_temperature == 0.15
    for flag in ("--tokenizer-mode", "--config-format", "--load-format"):
        assert m.vllm.extra_args[m.vllm.extra_args.index(flag) + 1] == "mistral"
    assert m.architecture.head_dim != m.architecture.hidden_size // m.architecture.num_attention_heads


@pytest.mark.parametrize("key", LEGACY)
def test_legacy_models_are_estimate_only(key):
    m = mr.get_model(key)
    assert m.serving_status == "estimate_only" and m.serving_types == []
    assert m.verification.status == "repo_legacy"
    fit = mr.check_fit(key, gpu_vram_gb=141, gpu_count=8)
    assert not fit.fits and "cannot be deployed" in fit.reasons[0]


def test_gpu_classes_agree_with_the_catalogue_where_both_exist():
    from inference.catalog import load_catalog
    gpus = load_catalog()["gpus"]
    shared = [k for k in mr.get_registry().gpu_classes if k in gpus]
    assert {"l4", "l40s", "h100", "h200"} <= set(shared)
    for k in shared:
        assert mr.get_registry().gpu_classes[k].vram_gb == gpus[k]["vram_gb"], k


# --- validation rejects bad data -------------------------------------------------------------------

def test_duplicate_model_keys_rejected():
    data = raw_registry()
    data["models"].append(copy.deepcopy(model_dict(data, "qwen2.5-7b")))
    assert_invalid(data, "duplicate model keys: qwen2.5-7b")


def test_keys_differing_only_by_case_rejected():
    data = raw_registry()
    dup = copy.deepcopy(model_dict(data, "mistral-7b"))
    dup["key"] = "Mistral-7b"
    data["models"].append(dup)
    assert_invalid(data, "string_pattern_mismatch|unique ignoring case")


@pytest.mark.parametrize("mutate, match", [
    (lambda m: m.update(kv_bytes_per_token=1), "does not match the architecture"),
    (lambda m: m["quantization"].update(default="int4"), "is not one of the variants"),
    (lambda m: m["recommended_placements"][0].update(gpu_class="tpu-v5"), "unknown gpu_class"),
    (lambda m: m["recommended_placements"][0].update(quantization="gguf"), "not a registered variant"),
    (lambda m: m["recommended_placements"][0].update(gpu_count=3), "not a supported tensor parallel size"),
    (lambda m: m["recommended_placements"][0].update(max_model_len=10**7), "exceeds max_context"),
    (lambda m: m.update(license=None), "requires: license"),
    (lambda m: m.update(sources=[]), "requires: sources"),
    (lambda m: m.update(gated=True), "requires_acceptance"),
    (lambda m: m["context"].update(default_max_model_len=10**7), "cannot exceed max_context"),
    (lambda m: m["vllm"].update(supported_tensor_parallel_sizes=[1, 3]), "does not divide"),
    (lambda m: m["vllm"].update(supported_tensor_parallel_sizes=[2]), "include 1"),
    (lambda m: m["quantization"]["variants"]["awq"].update(estimation_quant="int3"), "unknown estimation_quant"),
    (lambda m: m["quantization"]["variants"]["bf16"].update(hf_repo="someone/else"), "own hf_repo"),
    (lambda m: m.update(params_billion=9.9), "away from params_total"),
    (lambda m: m.update(key="Bad Key!"), "string_pattern_mismatch"),
    (lambda m: m.update(unexpected_field=1), "extra_forbidden"),
    (lambda m: m.update(serving_status="production"), "literal_error"),
])
def test_invalid_model_configurations_rejected(mutate, match):
    data = raw_registry()
    mutate(model_dict(data, "qwen2.5-7b"))
    assert_invalid(data, match)


def test_estimate_only_model_cannot_declare_serving_types():
    data = raw_registry()
    model_dict(data, "mistral-7b")["serving_types"] = ["selfhosted"]
    assert_invalid(data, "cannot declare serving_types")


def test_unreadable_registry_file_raises_registry_error(tmp_path):
    bad = tmp_path / "registry.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(mr.ModelRegistryError, match="Cannot read model registry"):
        mr.load_registry_file(bad)


# --- lookup ----------------------------------------------------------------------------------------

def test_lookup_is_case_insensitive_and_unknown_keys_fail_cleanly():
    assert mr.get_model("QWEN2.5-7B").key == "qwen2.5-7b"
    assert mr.find_model(" llama-3.1-8b ").key == "llama-3.1-8b"
    assert mr.find_model("gpt-5") is None and mr.find_model(None) is None
    with pytest.raises(mr.UnknownModelError):
        mr.get_model("gpt-5")
    assert [m.key for m in mr.get_registry().list(serving_status="estimate_only")] == LEGACY


def test_quant_bytes_known_and_unknown():
    assert (mr.quant_bytes("bf16"), mr.quant_bytes("fp8"), mr.quant_bytes("int4")) == (2.0, 1.0, 0.56)
    with pytest.raises(KeyError, match="Unknown quantization"):
        mr.quant_bytes("int3")


# --- memory estimation -----------------------------------------------------------------------------

def test_memory_components_formula():
    m = mr.estimate_memory_components(8.03, 131072, 2.0, 8192, 8)
    assert m.weights_gb == pytest.approx(16.06)
    assert m.kv_cache_gb == pytest.approx(8192 * 8 * 131072 / 1e9)
    assert m.overhead_gb == pytest.approx(2 + 0.04 * 16.06)
    assert m.total_gb == pytest.approx(m.weights_gb + m.kv_cache_gb + m.overhead_gb)


def test_model_memory_uses_exact_params_and_resolves_variants():
    exact = mr.estimate_model_memory("qwen2.5-32b", "bf16", 8192)
    planning = mr.estimate_model_memory("qwen2.5-32b", "bf16", 8192, use_exact_params=False)
    assert exact.weights_gb == pytest.approx(32.763876352 * 2)
    assert planning.weights_gb == pytest.approx(32.5 * 2)
    assert exact.total_gb > planning.total_gb  # rounded planning value under-estimates
    awq = mr.estimate_model_memory("qwen2.5-32b", "awq", 8192)
    assert awq.weights_gb == pytest.approx(32.763876352 * 0.56)  # awq is estimated as int4
    assert mr.estimate_model_memory("qwen2.5-32b").weights_gb == pytest.approx(32.763876352 * 1.0)  # default fp8


def test_memory_grows_with_context_and_concurrency_not_just_weights():
    base = mr.estimate_model_memory("llama-3.1-8b", "bf16", 8192, 1)
    longer = mr.estimate_model_memory("llama-3.1-8b", "bf16", 32768, 1)
    busier = mr.estimate_model_memory("llama-3.1-8b", "bf16", 8192, 8)
    assert base.total_gb > base.weights_gb + 3  # KV + overhead are material
    assert longer.kv_cache_gb == pytest.approx(base.kv_cache_gb * 4)
    assert busier.kv_cache_gb == pytest.approx(base.kv_cache_gb * 8)
    assert longer.weights_gb == busier.weights_gb == base.weights_gb


def test_memory_estimate_rejects_bad_inputs():
    with pytest.raises(ValueError):
        mr.estimate_model_memory("qwen2.5-7b", "bf16", 0)
    with pytest.raises(KeyError):
        mr.estimate_model_memory("qwen2.5-7b", "int3")


# --- GPU compatibility -----------------------------------------------------------------------------

PLACEMENTS = [(m.key, p) for m in mr.get_registry().list(deployable_only=True) for p in m.recommended_placements]


@pytest.mark.parametrize("key, placement", PLACEMENTS, ids=[f"{k}-{p.gpu_count}x{p.gpu_class}-{p.quantization}" for k, p in PLACEMENTS])
def test_every_recommended_placement_fits_by_estimate(key, placement):
    fit = mr.check_fit_on_gpu_class(key, placement.gpu_class, placement.gpu_count,
                                    quantization=placement.quantization, max_model_len=placement.max_model_len)
    assert fit.fits, fit.reasons
    assert fit.max_concurrent_sequences >= 1


@pytest.mark.parametrize("key, gpu, count, quant", [
    ("qwen2.5-14b", "l4", 1, "bf16"),
    ("mistral-small-24b", "l40s", 1, "bf16"),
    ("qwen2.5-32b", "h100", 1, "bf16"),  # weights alone are ~65.5 GB; no room left for KV at 0.90
    ("qwen2.5-32b", "a100-40gb", 1, "fp8"),
])
def test_configurations_that_do_not_fit_are_rejected(key, gpu, count, quant):
    fit = mr.check_fit_on_gpu_class(key, gpu, count, quantization=quant)
    assert not fit.fits and "usable" in fit.reasons[0]


def test_fit_reports_kv_capacity():
    fit = mr.check_fit_on_gpu_class("llama-3.1-8b", "l4", quantization="bf16", max_model_len=8192)
    spare = 24 * 0.9 - fit.memory.weights_gb - fit.memory.overhead_gb
    assert fit.kv_token_capacity == int(spare * 1e9 // 131072)
    assert fit.max_concurrent_sequences == fit.kv_token_capacity // 8192 == 2


def test_fit_blocks_bad_configuration():
    assert "not available" in mr.check_fit("qwen2.5-7b", gpu_vram_gb=80, quantization="gguf").reasons[0]
    assert "exceeds the model limit" in mr.check_fit("mistral-small-24b", gpu_vram_gb=141, max_model_len=65536).reasons[0]
    assert "tensor-parallel" in mr.check_fit("qwen2.5-7b", gpu_vram_gb=80, gpu_count=3).reasons[0]
    with pytest.raises(ValueError):
        mr.check_fit("qwen2.5-7b", gpu_vram_gb=0)
    with pytest.raises(mr.UnknownModelError):
        mr.check_fit("gpt-5", gpu_vram_gb=80)
    with pytest.raises(KeyError):
        mr.check_fit_on_gpu_class("qwen2.5-7b", "tpu-v5")


def test_fit_warnings():
    def warnings(*args, **kwargs):
        return " ".join(mr.check_fit_on_gpu_class(*args, **kwargs).warnings)
    assert "native FP8" in warnings("mistral-small-24b", "a100-80gb", quantization="fp8")
    assert "third-party" in warnings("qwen2.5-32b", "h100", quantization="fp8")
    assert "Hugging Face token" in warnings("llama-3.1-8b", "l4", quantization="bf16")
    assert "rope scaling" in warnings("qwen2.5-7b", "h100", quantization="bf16", max_model_len=65536)
    tight = mr.check_fit_on_gpu_class("llama-3.1-8b", "l4", quantization="bf16", max_model_len=8192, concurrency=2)
    assert tight.fits and 0 < tight.headroom_gb < 1.0 and "headroom" in " ".join(tight.warnings)
    assert mr.check_fit_on_gpu_class("qwen2.5-7b", "l4", quantization="bf16").warnings == []


# --- parity with the existing recommendation code (no behaviour change) ------------------------------

def test_routing_tables_come_from_the_registry():
    reg = mr.get_registry()
    assert routing.MODELS == {m.key: (m.params_billion, m.kv_bytes_per_token) for m in reg.models}
    assert routing.QUANT_BYTES == {"fp16": 2.0, "fp8": 1.0, "int4": 0.56}
    assert routing_engine.QUANT_BYTES_MAP == reg.estimation_quant_bytes
    assert routing.UTIL == routing_engine.VLLM_USABLE_FRACTION == reg.defaults.gpu_memory_utilization
    assert list(routing_engine.REFERENCE_MODELS) == reg.keys()
    for m in reg.models:
        spec = routing_engine.REFERENCE_MODELS[m.key]
        assert (spec.family, spec.name, spec.params_billion, spec.kv_bytes_per_token, spec.architecture) == (
            m.family, m.display_name, m.params_billion, m.kv_bytes_per_token, m.architecture_label)


def test_legacy_planning_values_are_unchanged():
    # The values the recommendation APIs used before the registry existed; changing them changes results.
    assert routing.MODELS == {
        "qwen2.5-7b": (7.6, 57344), "llama-3.1-8b": (8.03, 131072), "mistral-7b": (7.25, 131072),
        "qwen2.5-14b": (14.8, 196608), "mistral-small-24b": (23.6, 163840), "qwen2.5-32b": (32.5, 262144),
        "llama-3.1-70b": (70.6, 327680),
    }


@pytest.mark.parametrize("key", list(routing.MODELS))
def test_both_memory_paths_agree_with_the_registry(key):
    for quant in ("fp16", "fp8", "int4"):
        legacy = routing.estimate_memory(key, quant, 8192, 4)
        engine = routing_engine.calculate_memory_demand(key, quant, 8192, 4)
        planning = mr.estimate_model_memory(key, quant, 8192, 4, use_exact_params=False)
        assert legacy["need_gb"] == engine.total_needed_gb == planning.total_gb


def test_routing_engine_keeps_unknown_model_fallback():
    assert routing_engine.calculate_memory_demand("unknown") == routing_engine.calculate_memory_demand("llama-3.1-8b")


def test_recommend_request_accepts_exactly_the_registry_models():
    allowed = typing.get_args(RecommendRequest.model_fields["model_id"].annotation)
    assert list(allowed) == mr.model_keys()
    quants = typing.get_args(RecommendRequest.model_fields["quant"].annotation)
    assert set(quants) == set(routing.QUANT_BYTES)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from inference.auth import verify_customer_api_key
    from inference.main import app
    from inference.supabase_telemetry import get_telemetry_repository

    repo = SimpleNamespace(record_routing_decision=lambda **kw: "decision-1")
    app.dependency_overrides[verify_customer_api_key] = lambda: SimpleNamespace(id=uuid.uuid4(), user_id="u", organization_id=None)
    app.dependency_overrides[get_telemetry_repository] = lambda: repo
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_recommendation_routes_serve_every_registry_model(client):
    catalogue = client.get("/api/v1/routing/catalogue").json()["models"]
    assert [(m["id"], m["name"]) for m in catalogue] == [(m.key, m.display_name) for m in mr.get_registry().models]
    for key in mr.model_keys():
        body = {"model_id": key, "quant": "fp16", "context": 4096, "concurrency": 1}
        assert client.post("/api/v1/recommend", json=body).status_code == 200, key
        assert client.post("/api/v1/routing/recommend", json={"model_id": key}).status_code == 200, key


# --- parity with the frontend catalogue (frontend/src/data/gpus.ts, frontend/src/lib/calc.ts) --------

def _frontend_file(rel: str) -> str:
    path = FRONTEND_SRC / rel
    if not path.exists():
        pytest.skip(f"frontend source not present: {rel}")
    return path.read_text(encoding="utf-8")


def test_frontend_models_match_registry():
    src = _frontend_file("data/gpus.ts")
    block = re.search(r"export const MODELS: LlmModel\[\] = \[(.*?)\n\]", src, re.S).group(1)
    row = re.compile(
        r"\{ id: '([^']+)', family: '([^']+)', name: '([^']+)', params: ([\d.]+), "
        r"kvBytesPerToken: (\d+), arch: '([^']+)' \}"
    )
    frontend = [(i, f, n, float(p), int(kv), a) for i, f, n, p, kv, a in row.findall(block)]
    assert len(frontend) == block.count("{ id:"), "a frontend model row did not match the expected shape"
    assert frontend == [
        (m.key, m.family, m.display_name, m.params_billion, m.kv_bytes_per_token, m.architecture_label)
        for m in mr.get_registry().models
    ]


def test_frontend_memory_constants_match_registry():
    gpus = _frontend_file("data/gpus.ts")
    calc = _frontend_file("lib/calc.ts")
    quants = dict((q, float(b)) for q, b in re.findall(r"\{ id: '(\w+)', label: '[^']*', bytes: ([\d.]+)", gpus))
    reg = mr.get_registry()
    assert quants == {q: reg.estimation_quant_bytes[q] for q in ("fp16", "fp8", "int4")}
    util = float(re.search(r"export const UTIL = ([\d.]+)", calc).group(1))
    assert util == reg.defaults.gpu_memory_utilization
    base, per_weight = re.search(r"overhead = ([\d.]+) \+ ([\d.]+) \* weights", calc).groups()
    assert (float(base), float(per_weight)) == (reg.defaults.overhead_base_gb, reg.defaults.overhead_per_weight_gb)
