#!/usr/bin/env python3
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]


def parse_wrapper_args() -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--upstream-root", required=True)
    parser.add_argument("--goodmemory-config", required=True)
    return parser.parse_known_args()


def load_goodmemory_config(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("GoodMemory memory config must be a JSON object")
    if payload.get("memory_type") != "goodmemory":
        raise RuntimeError("GoodMemory memory config must set memory_type=goodmemory")
    if not isinstance(payload.get("memory_params"), dict):
        raise RuntimeError("GoodMemory memory config must contain memory_params")
    return payload


def sanitize_checkpoint(checkpoint: dict[str, Any]) -> dict[str, object]:
    as_of = checkpoint.get("as_of")
    as_of = as_of if isinstance(as_of, dict) else {}
    return {
        "checkpoint_id": str(checkpoint.get("checkpoint_id") or ""),
        "as_of": {
            "timestamp": str(as_of.get("timestamp") or ""),
            "app_log_id": str(as_of.get("app_log_id") or ""),
        },
    }


def retrieved_dynamicmem_app_log_ids(items: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item.get("category") != "dynamicmem_app_log":
            continue
        tags = item.get("tags")
        if not isinstance(tags, list):
            continue
        for raw_tag in tags:
            tag = str(raw_tag)
            if not tag.startswith("dynamicmem-app-log-id:"):
                continue
            log_id = tag.removeprefix("dynamicmem-app-log-id:").strip()
            if log_id and log_id not in seen:
                seen.add(log_id)
                ids.append(log_id)
            break
    return ids


def run_adapter(args: Any, config: dict[str, object]) -> dict[str, Any]:
    from baseline_prediction.common.llm_client import LLMClient
    from tce_core.orchestrator_protocol import CheckpointHandle, RetrievalResult
    from tce_core.pipeline import run_pipeline

    from goodmemory_backend import GoodMemoryDynamicMemBackend

    if args.resume:
        raise RuntimeError(
            "DynamicMem GoodMemory runs must start fresh; resume is not supported because "
            "the remote memory snapshot cannot be proven from the prediction artifact."
        )
    if args.max_visible_logs is not None and int(args.max_visible_logs) > 0:
        raise RuntimeError(
            "DynamicMem GoodMemory requires the full checkpoint prefix; max_visible_logs is unsupported."
        )

    resolved = deepcopy(config)
    memory_params = resolved["memory_params"]
    assert isinstance(memory_params, dict)
    base_workspace_id = str(memory_params.get("workspace_id") or "dynamicmem").strip()
    if not base_workspace_id:
        raise RuntimeError("goodmemory workspace_id must be a non-empty string")
    user_id = str(args.user_id or "unknown-user").strip()
    memory_params["workspace_id"] = f"{base_workspace_id}:{user_id}"
    memory_params["workspace_dir"] = str(Path(args.output).expanduser().resolve().parent)
    backend = GoodMemoryDynamicMemBackend(memory_params)

    answer_client = LLMClient(
        provider=args.llm_provider,
        model_name=args.llm_model,
        max_workers=args.llm_max_workers,
        temperature=args.llm_temperature,
        top_p=args.llm_top_p,
        top_k=args.llm_top_k,
    )

    def ask_json(prompt: str) -> Any:
        return answer_client.ask(prompt, response_type="json")

    def ask_structured(prompt: str, text_format: Any) -> Any:
        return answer_client.ask_structured(prompt, text_format=text_format)

    def close() -> None:
        answer_client.close()

    def prepare_checkpoint_state(
        checkpoint: dict[str, Any],
        memory_pool: list[dict[str, Any]],
    ) -> CheckpointHandle:
        public_checkpoint = sanitize_checkpoint(checkpoint)
        public_as_of = public_checkpoint["as_of"]
        assert isinstance(public_as_of, dict)
        checkpoint_id = str(public_checkpoint["checkpoint_id"])
        checkpoint_timestamp = str(public_as_of["timestamp"])
        backend.prepare_checkpoint(checkpoint_id, checkpoint_timestamp, memory_pool)
        return CheckpointHandle(
            checkpoint_id=checkpoint_id,
            state_kind="goodmemory_checkpoint_prefix",
            state_ref=public_checkpoint,
            metadata={
                "checkpoint_timestamp": checkpoint_timestamp,
                "checkpoint_app_log_id": str(public_as_of["app_log_id"]),
                "memory_pool_size": len(memory_pool),
            },
        )

    def retrieve_context_for_query(
        checkpoint_handle: CheckpointHandle,
        query_spec: Any,
        _retrieval_options: Any,
        _memory_pool: list[dict[str, Any]],
    ) -> RetrievalResult:
        query = str(query_spec.retrieval_query_text or "").strip()
        reference_time = str(
            checkpoint_handle.metadata.get("checkpoint_timestamp") or ""
        ).strip()
        recalled = backend.query(query, reference_time=reference_time)
        recalled_items = [
            item for item in recalled.items if isinstance(item, dict)
        ]
        return RetrievalResult(
            mode="inline_memory",
            inline_memory_blocks=(
                [recalled.context_text]
                if recalled.context_text.strip()
                else []
            ),
            debug_metadata={
                "checkpoint_state_kind": checkpoint_handle.state_kind,
                "goodmemory_contract_version": recalled.contract_version,
                "goodmemory_item_count": recalled.item_count,
                "goodmemory_trace_id": recalled.trace_id,
                "retrieval_query": query,
                "retrieved_memory_ids": [
                    str(item.get("id") or item.get("memoryId") or "")
                    for item in recalled_items
                ],
                "retrieved_app_log_ids": retrieved_dynamicmem_app_log_ids(
                    recalled_items
                ),
                "routing": {
                    "requested_strategy": recalled.routing.requested_strategy,
                    "resolved_strategy": recalled.routing.resolved_strategy,
                    "fallback_reason": recalled.routing.fallback_reason,
                },
            },
        )

    task_selection = str(
        args.extras.get("__task_selection__", "all")
    ).strip().lower() or "all"
    return run_pipeline(
        benchmark_path=args.benchmark,
        app_logs_path=args.app_logs_path,
        output_path=args.output,
        max_visible_logs=None,
        ask_json=ask_json,
        ask_structured=ask_structured,
        use_structured_response=answer_client.supports_structured_response(),
        close=close,
        prepare_checkpoint_state=prepare_checkpoint_state,
        retrieve_context_for_query=retrieve_context_for_query,
        baseline_name="goodmemory",
        memory_prompt_mode="inline_memory",
        resume=False,
        max_checkpoints=args.max_checkpoints,
        debug=args.debug,
        debug_dir=args.debug_dir,
        save_prompt_and_raw=args.save_prompt_and_raw,
        enable_change_reasoning=args.enable_change_reasoning,
        enable_rq3_apply_service_qa=args.enable_rq3_apply_service_qa,
        rq3_apply_save_prompt_and_raw=args.rq3_apply_save_prompt_and_raw,
        rq3_apply_retrieval_top_k=args.rq3_apply_retrieval_top_k,
        checkpoint_workers=1,
        within_checkpoint_workers=args.within_checkpoint_workers,
        save_every_generation_keys=args.save_every_generation_keys,
        enable_final_qa=args.enable_final_qa,
        final_qa_path=args.final_qa_path,
        final_qa_output_path=args.final_qa_output_path,
        final_qa_retrieval_top_k=args.final_qa_retrieval_top_k,
        final_qa_save_prompt_and_raw=args.final_qa_save_prompt_and_raw,
        task_selection=task_selection,
    )


def main() -> None:
    wrapper_args, upstream_args = parse_wrapper_args()
    upstream_root = Path(wrapper_args.upstream_root).expanduser().resolve()
    config_path = Path(wrapper_args.goodmemory_config).expanduser().resolve()
    if not (upstream_root / "tce_core" / "pipeline.py").is_file():
        raise RuntimeError(f"Not a DynamicMem source root: {upstream_root}")
    config = load_goodmemory_config(config_path)

    sys.path.insert(0, str(REPO_ROOT / "clients" / "python"))
    sys.path.insert(0, str(upstream_root))
    sys.path.insert(0, str(SCRIPT_DIR))

    from baseline_prediction.adapters import registry

    registry._ADAPTERS["goodmemory"] = lambda args: run_adapter(args, config)
    from baseline_prediction import run_tce

    sys.argv = [str(upstream_root / "baseline_prediction" / "run_tce.py"), *upstream_args]
    run_tce.main()


if __name__ == "__main__":
    main()
