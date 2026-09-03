from __future__ import annotations

import json
import os
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import tempfile
import unittest


memory_package = ModuleType("memory_modules")
memory_package.__path__ = []  # type: ignore[attr-defined]
memory_module = ModuleType("memory_modules.memory")
memory_registry: dict[str, type[object]] = {}


class Memory:
    memory_type = ""

    def __init__(self, memory_params: dict[str, object]) -> None:
        self.memory_params = dict(memory_params)
        self._query_context = {"query_invocation_id": "opaque-run-id"}

    def get_query_context(self) -> dict[str, str]:
        return dict(self._query_context)


def register_memory(memory_class: type[object]) -> type[object]:
    memory_registry[str(getattr(memory_class, "memory_type"))] = memory_class
    return memory_class


memory_module.Memory = Memory  # type: ignore[attr-defined]
memory_module.MemoryContextItem = dict[str, str]  # type: ignore[attr-defined]
memory_module.register_memory = register_memory  # type: ignore[attr-defined]
sys.modules.setdefault("memory_modules", memory_package)
sys.modules.setdefault("memory_modules.memory", memory_module)

import goodmemory_backend  # noqa: E402
import run_goodmemory  # noqa: E402


class FakeClient:
    instances: list["FakeClient"] = []

    def __init__(self, base_url: str, **kwargs: object) -> None:
        self.base_url = base_url
        self.kwargs = kwargs
        self.remember_calls: list[dict[str, object]] = []
        self.recall_calls: list[dict[str, object]] = []
        self.recall_result = SimpleNamespace(
            context_text="",
            has_context=False,
            items=[],
            raw={"routing": {}},
        )
        self.instances.append(self)

    def remember(self, messages: list[dict[str, str]], **kwargs: object) -> dict[str, object]:
        self.remember_calls.append({"messages": messages, **kwargs})
        return {
            "result": {
                "accepted": len(messages),
                "events": [
                    {
                        "annotation": {"remember": "always"},
                        "candidateId": f"annotation-source-{index + 1}",
                        "outcome": "written",
                    }
                    for index in range(len(messages))
                ],
                "rejected": len(messages),
            }
        }

    def recall_context(self, query: str, **kwargs: object) -> SimpleNamespace:
        self.recall_calls.append({"query": query, **kwargs})
        return self.recall_result


class GoodMemoryBackendTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeClient.instances.clear()
        goodmemory_backend.GoodMemoryClient = FakeClient
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_root = Path(self.temp_dir.name)
        self.screenshot = self.data_root / "screenshots" / "trajectory-1" / "0.png"
        self.screenshot.parent.mkdir(parents=True)
        self.screenshot.write_bytes(b"png")
        os.environ["GOODMEMORY_TEST_BRIDGE_TOKEN"] = "secret-token"
        self.backend = goodmemory_backend.GoodMemoryBackend(
            {
                "agent_id": "longmemeval-v2",
                "accessibility_chunk_bytes": 24,
                "base_url": "http://127.0.0.1:8739",
                "batch_size": 8,
                "data_root": str(self.data_root),
                "max_screenshots": 2,
                "max_tokens": 4096,
                "retrieval_profile": "general_chat",
                "strategy": "hybrid",
                "token_env": "GOODMEMORY_TEST_BRIDGE_TOKEN",
                "user_id": "lme-v2-web",
                "workspace_id": "small-web",
            }
        )
        self.client = FakeClient.instances[-1]

    def tearDown(self) -> None:
        self.temp_dir.cleanup()
        os.environ.pop("GOODMEMORY_TEST_BRIDGE_TOKEN", None)

    def test_backend_registers_with_the_official_memory_registry(self) -> None:
        self.assertIs(memory_registry["goodmemory"], goodmemory_backend.GoodMemoryBackend)

    def test_sync_import_uses_one_long_lived_http_attempt(self) -> None:
        self.assertEqual(self.client.kwargs["timeout_seconds"], 600.0)
        self.assertEqual(self.client.kwargs["max_attempts"], 1)

    def test_accessibility_chunks_preserve_utf8_text_with_a_hard_byte_limit(self) -> None:
        text = "button Reply\nlink Café comments\n"
        chunks = goodmemory_backend.chunk_utf8_text(text, 12)

        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk.encode("utf-8")) <= 12 for chunk in chunks))

    def test_runtime_workspace_partitions_the_remote_scope(self) -> None:
        first = goodmemory_backend.GoodMemoryBackend(
            {
                "base_url": "http://127.0.0.1:8739",
                "data_root": str(self.data_root),
                "user_id": "lme-v2-web",
                "workspace_dir": str(self.data_root / "runtime" / "opaque-1"),
                "workspace_id": "small-web",
            }
        )
        second = goodmemory_backend.GoodMemoryBackend(
            {
                "base_url": "http://127.0.0.1:8739",
                "data_root": str(self.data_root),
                "user_id": "lme-v2-web",
                "workspace_dir": str(self.data_root / "runtime" / "opaque-2"),
                "workspace_id": "small-web",
            }
        )

        self.assertNotEqual(first.scope.workspace_id, second.scope.workspace_id)
        self.assertTrue(first.scope.workspace_id.startswith("small-web:"))
        self.assertNotIn("opaque-1", first.scope.workspace_id)

    def test_insert_persists_only_trajectory_fields_as_verified_exact_facts(self) -> None:
        self.backend.insert(
            {
                "id": "trajectory-1",
                "domain": "web",
                "environment": "forum",
                "goal": "Reply to a nested comment.",
                "outcome": "success",
                "start_url": "FORUM_ROOT/thread/1",
                "answer": "must-not-enter-memory",
                "question_type": "must-not-enter-memory",
                "states": [
                    {
                        "state_index": 0,
                        "step": 0,
                        "url": "FORUM_ROOT/thread/1",
                        "action": "click reply",
                        "thought": "The nested reply control is visible.",
                        "accessibility_tree": "button Reply\nlink View all comments",
                        "screenshot": "screenshots/trajectory-1/0.png",
                    }
                ],
            }
        )

        self.assertEqual(len(self.client.remember_calls), 1)
        call = self.client.remember_calls[0]
        messages = call["messages"]
        annotations = call["annotations"]
        self.assertIsInstance(messages, list)
        self.assertIsInstance(annotations, list)
        self.assertEqual(call["extraction_strategy"], "rules-only")
        self.assertEqual(call["mode"], "sync")
        self.assertGreater(len(messages), 2)
        self.assertEqual(len(annotations), len(messages))
        self.assertEqual(call["scope"].session_id, "trajectory-1")
        self.assertEqual(len({message["id"] for message in messages}), len(messages))

        rendered = "\n".join(message["content"] for message in messages)
        self.assertIn("Goal: Reply to a nested comment.", rendered)
        self.assertIn("Outcome: success", rendered)
        self.assertIn("link View all comments", rendered)
        self.assertIn(f"Screenshot: {self.screenshot.resolve()}", rendered)
        self.assertNotIn("must-not-enter-memory", rendered)
        for annotation in annotations:
            self.assertEqual(annotation["remember"], "always")
            self.assertEqual(annotation["kindHint"], "fact")
            self.assertTrue(annotation["confirmed"])
            self.assertTrue(annotation["verified"])

    def test_query_returns_text_and_only_existing_recalled_screenshots(self) -> None:
        missing = self.data_root / "screenshots" / "missing.png"
        self.client.recall_result = SimpleNamespace(
            context_text="Relevant trajectory state",
            has_context=True,
            items=[
                {"content": f"State 0\nScreenshot: {self.screenshot.resolve()}"},
                {"content": f"State duplicate\nScreenshot: {self.screenshot.resolve()}"},
                {"content": f"Missing\nScreenshot: {missing}"},
            ],
            raw={"routing": {"warnings": ["semantic_recall_inactive"]}},
        )

        context = self.backend.query(
            "What does the banner link say?",
            query_image="/private/question.png",
        )

        self.assertEqual(
            context,
            [
                {"type": "text", "value": "Relevant trajectory state"},
                {"type": "image", "value": str(self.screenshot.resolve())},
            ],
        )
        self.assertEqual(
            self.client.recall_calls,
            [
                {
                    "query": "What does the banner link say?",
                    "max_tokens": 4096,
                    "output": "markdown",
                    "retrieval_profile": "general_chat",
                    "strategy": "hybrid",
                }
            ],
        )

    def test_runner_registers_method_and_injects_locked_data_root(self) -> None:
        upstream_root = self.data_root / "upstream"
        (upstream_root / "evaluation").mkdir(parents=True)
        (upstream_root / "evaluation" / "run_eval.py").write_text("# fixture\n", encoding="utf-8")
        config_path = self.data_root / "memory-config.json"
        config_path.write_text(
            json.dumps(
                {
                    "memory_type": "goodmemory",
                    "memory_params": {
                        "base_url": "http://127.0.0.1:8739",
                        "user_id": "lme-v2",
                        "workspace_id": "fresh-scope",
                    },
                }
            ),
            encoding="utf-8",
        )

        captured: dict[str, object] = {}
        evaluation_package = ModuleType("evaluation")
        evaluation_package.__path__ = []  # type: ignore[attr-defined]
        fake_run_eval = ModuleType("evaluation.run_eval")
        fake_harness = ModuleType("evaluation.harness")
        fake_run_eval.METHODS = {"no_retrieval"}  # type: ignore[attr-defined]

        def original_inject(
            memory_config: dict[str, object],
            **_kwargs: object,
        ) -> dict[str, object]:
            return memory_config

        fake_harness.inject_runtime_memory_params = original_inject  # type: ignore[attr-defined]

        def original_harness_main() -> None:
            captured["harness_argv"] = list(sys.argv)

        fake_harness.main = original_harness_main  # type: ignore[attr-defined]

        def original_build(args: SimpleNamespace, data_root: Path) -> dict[str, object]:
            return {"memory_type": str(args.method), "memory_params": {"data_root": str(data_root)}}

        def fake_main() -> None:
            captured["argv"] = list(sys.argv)
            captured["config"] = fake_run_eval.build_memory_config(  # type: ignore[attr-defined]
                SimpleNamespace(method="goodmemory"),
                self.data_root / "locked-data",
            )
            captured["runtime_config"] = fake_harness.inject_runtime_memory_params(  # type: ignore[attr-defined]
                captured["config"],
                workspace_dir=self.data_root / "runtime" / "opaque-run",
                trajectories_path=str(self.data_root / "locked-data" / "trajectories.jsonl"),
            )
            fake_harness.main()  # type: ignore[attr-defined]

        fake_run_eval.build_memory_config = original_build  # type: ignore[attr-defined]
        fake_run_eval.main = fake_main  # type: ignore[attr-defined]
        evaluation_package.run_eval = fake_run_eval  # type: ignore[attr-defined]

        previous_argv = list(sys.argv)
        previous_evaluation = sys.modules.get("evaluation")
        previous_run_eval = sys.modules.get("evaluation.run_eval")
        previous_harness = sys.modules.get("evaluation.harness")
        sys.modules["evaluation"] = evaluation_package
        sys.modules["evaluation.run_eval"] = fake_run_eval
        sys.modules["evaluation.harness"] = fake_harness
        evaluation_package.harness = fake_harness  # type: ignore[attr-defined]
        try:
            sys.argv = [
                "run_goodmemory.py",
                "--upstream-root",
                str(upstream_root),
                "--goodmemory-config",
                str(config_path),
                "--evaluator-base-url",
                "https://judge.example/v1",
                "--method",
                "goodmemory",
                "--domain",
                "web",
            ]
            run_goodmemory.main()
        finally:
            sys.argv = previous_argv
            if previous_evaluation is None:
                sys.modules.pop("evaluation", None)
            else:
                sys.modules["evaluation"] = previous_evaluation
            if previous_run_eval is None:
                sys.modules.pop("evaluation.run_eval", None)
            else:
                sys.modules["evaluation.run_eval"] = previous_run_eval
            if previous_harness is None:
                sys.modules.pop("evaluation.harness", None)
            else:
                sys.modules["evaluation.harness"] = previous_harness

        self.assertIn("goodmemory", fake_run_eval.METHODS)  # type: ignore[attr-defined]
        self.assertEqual(
            captured["argv"],
            [
                str(upstream_root.resolve() / "evaluation" / "run_eval.py"),
                "--method",
                "goodmemory",
                "--domain",
                "web",
            ],
        )
        self.assertEqual(
            captured["harness_argv"],
            [
                str(upstream_root.resolve() / "evaluation" / "run_eval.py"),
                "--method",
                "goodmemory",
                "--domain",
                "web",
                "--evaluator-base-url",
                "https://judge.example/v1",
            ],
        )
        self.assertEqual(
            captured["config"],
            {
                "memory_type": "goodmemory",
                "memory_params": {
                    "base_url": "http://127.0.0.1:8739",
                    "data_root": str((self.data_root / "locked-data").resolve()),
                    "user_id": "lme-v2",
                    "workspace_id": "fresh-scope",
                },
            },
        )
        self.assertEqual(
            captured["runtime_config"],
            {
                "memory_type": "goodmemory",
                "memory_params": {
                    "base_url": "http://127.0.0.1:8739",
                    "data_root": str((self.data_root / "locked-data").resolve()),
                    "trajectories_root_dir": str((self.data_root / "locked-data").resolve()),
                    "user_id": "lme-v2",
                    "workspace_dir": str((self.data_root / "runtime" / "opaque-run").resolve()),
                    "workspace_id": "fresh-scope",
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
