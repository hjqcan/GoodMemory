from __future__ import annotations

import json
from pathlib import Path
from types import ModuleType
import sys
import tempfile


memory_package = ModuleType("memory_modules")
memory_package.__path__ = []  # type: ignore[attr-defined]
memory_module = ModuleType("memory_modules.memory")


class Memory:
    def __init__(self, memory_params: dict[str, object]) -> None:
        self.memory_params = dict(memory_params)

    def get_query_context(self) -> dict[str, str]:
        return {"query_invocation_id": "live-smoke"}


def register_memory(memory_class: type[object]) -> type[object]:
    return memory_class


memory_module.Memory = Memory  # type: ignore[attr-defined]
memory_module.MemoryContextItem = dict[str, str]  # type: ignore[attr-defined]
memory_module.register_memory = register_memory  # type: ignore[attr-defined]
sys.modules["memory_modules"] = memory_package
sys.modules["memory_modules.memory"] = memory_module

import goodmemory_backend  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: live_bridge_smoke.py <bridge-url>")
    with tempfile.TemporaryDirectory() as temp_dir:
        data_root = Path(temp_dir)
        screenshot = data_root / "screenshots" / "trajectory-smoke" / "0.png"
        screenshot.parent.mkdir(parents=True)
        screenshot.write_bytes(b"png")
        backend = goodmemory_backend.GoodMemoryBackend(
            {
                "agent_id": "longmemeval-v2",
                "base_url": sys.argv[1],
                "data_root": str(data_root),
                "max_screenshots": 2,
                "max_tokens": 4096,
                "retrieval_profile": "general_chat",
                "strategy": "hybrid",
                "user_id": "longmemeval-v2-smoke",
                "workspace_id": "longmemeval-v2-smoke",
            }
        )
        backend.insert(
            {
                "id": "trajectory-smoke",
                "domain": "web",
                "environment": "forum",
                "goal": "Inspect the nested reply banner.",
                "outcome": "success",
                "start_url": "FORUM_ROOT/thread/1",
                "states": [
                    {
                        "state_index": 0,
                        "step": 0,
                        "url": "FORUM_ROOT/thread/1",
                        "action": "reply",
                        "thought": "Read the banner.",
                        "accessibility_tree": "The banner link says View all comments.",
                        "screenshot": "screenshots/trajectory-smoke/0.png",
                    }
                ],
            }
        )
        context = backend.query("What does the banner link say?")
        print(json.dumps({"context": context}, sort_keys=True))


if __name__ == "__main__":
    main()
