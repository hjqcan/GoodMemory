#!/usr/bin/env python3
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]


def parse_wrapper_args() -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--upstream-root", required=True)
    parser.add_argument("--goodmemory-config", required=True)
    parser.add_argument("--evaluator-base-url")
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


def main() -> None:
    wrapper_args, upstream_args = parse_wrapper_args()
    upstream_root = Path(wrapper_args.upstream_root).expanduser().resolve()
    config_path = Path(wrapper_args.goodmemory_config).expanduser().resolve()
    if not (upstream_root / "evaluation" / "run_eval.py").is_file():
        raise RuntimeError(f"Not a LongMemEval-V2 source root: {upstream_root}")
    config = load_goodmemory_config(config_path)

    sys.path.insert(0, str(REPO_ROOT / "clients" / "python"))
    sys.path.insert(0, str(upstream_root))
    sys.path.insert(0, str(SCRIPT_DIR))

    import goodmemory_backend  # noqa: F401
    from evaluation import harness
    from evaluation import run_eval

    original_build_memory_config = run_eval.build_memory_config
    original_harness_main = harness.main
    original_inject_runtime_memory_params = harness.inject_runtime_memory_params
    run_eval.METHODS.add("goodmemory")

    def build_memory_config(args: argparse.Namespace, data_root: Path) -> dict[str, object]:
        if args.method != "goodmemory":
            return original_build_memory_config(args, data_root)
        resolved = deepcopy(config)
        memory_params = resolved["memory_params"]
        assert isinstance(memory_params, dict)
        memory_params.setdefault("data_root", str(data_root.resolve()))
        return resolved

    def inject_runtime_memory_params(
        memory_config: dict[str, object],
        *,
        workspace_dir: Path,
        trajectories_path: str,
        **kwargs: object,
    ) -> dict[str, object]:
        if memory_config.get("memory_type") != "goodmemory":
            return original_inject_runtime_memory_params(
                memory_config,
                workspace_dir=workspace_dir,
                trajectories_path=trajectories_path,
                **kwargs,
            )
        runtime_config = deepcopy(memory_config)
        memory_params = runtime_config["memory_params"]
        assert isinstance(memory_params, dict)
        memory_params["workspace_dir"] = str(workspace_dir.resolve())
        memory_params["trajectories_root_dir"] = str(
            Path(trajectories_path).resolve().parent
        )
        return runtime_config

    run_eval.build_memory_config = build_memory_config
    harness.inject_runtime_memory_params = inject_runtime_memory_params
    if wrapper_args.evaluator_base_url:
        def harness_main() -> None:
            previous_argv = sys.argv
            try:
                sys.argv = [
                    *previous_argv,
                    "--evaluator-base-url",
                    wrapper_args.evaluator_base_url,
                ]
                original_harness_main()
            finally:
                sys.argv = previous_argv

        harness.main = harness_main
    sys.argv = [str(upstream_root / "evaluation" / "run_eval.py"), *upstream_args]
    run_eval.main()


if __name__ == "__main__":
    main()
