from __future__ import annotations

from contextlib import redirect_stderr
from io import StringIO
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

import goodmemory_backend
import run_goodmemory


class FakeClient:
    instances: list["FakeClient"] = []

    def __init__(self, base_url: str, **kwargs: object) -> None:
        self.base_url = base_url
        self.kwargs = kwargs
        self.remember_calls: list[dict[str, object]] = []
        self.remember_result: dict[str, object] | None = None
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
        if self.remember_result is not None:
            return self.remember_result
        return {
            "result": {
                "events": [
                    {
                        "annotation": {"remember": "always"},
                        "outcome": "written",
                    }
                    for _ in messages
                ],
                "metadata": {
                    "requestedExtractionStrategy": kwargs.get("extraction_strategy"),
                    "resolvedExtractionStrategy": kwargs.get("extraction_strategy"),
                },
                "warnings": [],
            }
        }

    def recall_context(self, query: str, **kwargs: object) -> SimpleNamespace:
        self.recall_calls.append({"query": query, **kwargs})
        return self.recall_result


def app_log(log_id: str, timestamp: str, *, query: str) -> dict[str, object]:
    return {
        "app_log_id": log_id,
        "timestamp": timestamp,
        "app_name": "shopping",
        "api_name": "search_products",
        "request": {"query": query},
        "response": {"items": [{"name": f"result for {query}"}]},
    }


class GoodMemoryBackendTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeClient.instances.clear()
        goodmemory_backend.GoodMemoryClient = FakeClient
        os.environ["GOODMEMORY_TEST_BRIDGE_TOKEN"] = "secret-token"
        self.backend = goodmemory_backend.GoodMemoryDynamicMemBackend(
            {
                "agent_id": "dynamicmem",
                "base_url": "http://127.0.0.1:8739",
                "batch_size": 2,
                "extraction_strategy": "llm-assisted",
                "max_tokens": 4096,
                "retrieval_profile": "general_chat",
                "strategy": "hybrid",
                "token_env": "GOODMEMORY_TEST_BRIDGE_TOKEN",
                "user_id": "dynamicmem",
                "workspace_id": "user-001",
            }
        )
        self.client = FakeClient.instances[-1]

    def tearDown(self) -> None:
        os.environ.pop("GOODMEMORY_TEST_BRIDGE_TOKEN", None)

    def test_checkpoint_ingest_is_incremental_lossless_and_exactly_annotated(self) -> None:
        first = app_log("log-1", "2025-01-02 10:00:00", query="trail shoes")
        second = app_log("log-2", "2025-01-03 10:00:00", query="quiet gym")
        third = app_log("log-3", "2025-04-01 10:00:00", query="home weights")

        self.backend.prepare_checkpoint("c1", "2025-03-31T23:59:59Z", [first, second])
        self.backend.prepare_checkpoint("c2", "2025-06-30T23:59:59Z", [first, second, third])

        self.assertEqual(len(self.client.remember_calls), 2)
        self.assertEqual(
            [message["id"] for call in self.client.remember_calls for message in call["messages"]],
            ["dynamicmem:log-1", "dynamicmem:log-2", "dynamicmem:log-3"],
        )
        for call in self.client.remember_calls:
            self.assertEqual(call["extraction_strategy"], "llm-assisted")
            self.assertEqual(call["mode"], "sync")
            self.assertEqual(len(call["messages"]), len(call["annotations"]))
            for message, annotation in zip(call["messages"], call["annotations"]):
                payload = json.loads(message["content"].split("Payload: ", 1)[1])
                self.assertEqual(payload["app_log_id"], message["id"].removeprefix("dynamicmem:"))
                self.assertEqual(
                    message["observedAt"],
                    payload["timestamp"].replace(" ", "T") + "Z",
                )
                self.assertEqual(annotation["remember"], "always")
                self.assertTrue(annotation["confirmed"])
                self.assertTrue(annotation["verified"])
                self.assertIn(
                    f"dynamicmem-app-log-id:{payload['app_log_id']}",
                    annotation["metadataPatch"]["tags"],
                )
                self.assertEqual(
                    annotation["metadataPatch"]["attributes"]["appLogId"],
                    payload["app_log_id"],
                )
                self.assertNotIn("scopeKind", annotation["metadataPatch"])

    def test_checkpoint_ingest_rejects_non_prefix_reordering(self) -> None:
        first = app_log("log-1", "2025-01-02T10:00:00Z", query="trail shoes")
        second = app_log("log-2", "2025-01-03T10:00:00Z", query="quiet gym")
        self.backend.prepare_checkpoint("c1", "2025-03-31T23:59:59Z", [first, second])

        with self.assertRaisesRegex(RuntimeError, "prefix"):
            self.backend.prepare_checkpoint("c2", "2025-06-30T23:59:59Z", [second, first])

    def test_checkpoint_ingest_logs_each_batch_without_payload_content(self) -> None:
        logs = [
            app_log("log-1", "2025-01-02 10:00:00", query="private query one"),
            app_log("log-2", "2025-01-03 10:00:00", query="private query two"),
            app_log("log-3", "2025-01-04 10:00:00", query="private query three"),
        ]
        stderr = StringIO()

        with redirect_stderr(stderr):
            self.backend.prepare_checkpoint("c1", "2025-03-31 23:59:59", logs)

        events = [
            json.loads(line.split("] ", 1)[1])
            for line in stderr.getvalue().splitlines()
        ]
        self.assertEqual(
            [event["event"] for event in events],
            [
                "checkpoint_batch_started",
                "checkpoint_batch_committed",
                "checkpoint_batch_started",
                "checkpoint_batch_committed",
                "checkpoint_prepared",
            ],
        )
        self.assertEqual(events[0]["batch_index"], 1)
        self.assertEqual(events[0]["batch_message_count"], 2)
        self.assertEqual(events[0]["first_app_log_id"], "log-1")
        self.assertEqual(events[1]["committed_message_count"], 2)
        self.assertIsInstance(events[1]["elapsed_ms"], float)
        self.assertEqual(events[2]["batch_index"], 2)
        self.assertEqual(events[2]["batch_message_count"], 1)
        self.assertNotIn("private query", stderr.getvalue())

    def test_llm_assisted_ingest_fails_closed_on_provider_fallback(self) -> None:
        self.client.remember_result = {
            "result": {
                "events": [
                    {
                        "annotation": {"remember": "always"},
                        "outcome": "written",
                    }
                ],
                "metadata": {
                    "requestedExtractionStrategy": "llm-assisted",
                    "resolvedExtractionStrategy": "rules-only",
                },
                "warnings": ["assisted_extraction_failed"],
            }
        }

        with self.assertRaisesRegex(RuntimeError, "assisted extraction degraded"):
            self.backend.prepare_checkpoint(
                "c1",
                "2025-03-31 23:59:59",
                [app_log("log-1", "2025-01-02 10:00:00", query="private query")],
            )

        self.assertEqual(self.backend._visible_log_ids, [])

    def test_query_uses_checkpoint_time_without_private_task_metadata(self) -> None:
        self.client.recall_result = SimpleNamespace(
            context_text="remembered current profile",
            has_context=True,
            items=[{"id": "fact-1"}],
            raw={"routing": {"warnings": []}},
        )

        result = self.backend.query(
            "Infer the user's current workout routine.",
            reference_time="2025-06-30 23:59:59",
        )

        self.assertEqual(result.context_text, "remembered current profile")
        self.assertEqual(
            self.client.recall_calls,
            [
                {
                    "query": "Infer the user's current workout routine.",
                    "max_tokens": 4096,
                    "output": "markdown",
                    "reference_time": "2025-06-30T23:59:59Z",
                    "retrieval_profile": "general_chat",
                    "strategy": "hybrid",
                }
            ],
        )

    def test_locked_naive_timestamp_is_mapped_to_a_stable_rfc3339_coordinate(self) -> None:
        self.assertEqual(
            goodmemory_backend.normalize_dynamicmem_timestamp(
                "2023-12-31 19:30:00",
                label="checkpoint",
            ),
            "2023-12-31T19:30:00Z",
        )
        with self.assertRaisesRegex(RuntimeError, "YYYY-MM-DD HH:MM:SS"):
            goodmemory_backend.normalize_dynamicmem_timestamp(
                "December 31, 2023",
                label="checkpoint",
            )

    def test_backend_rejects_non_contract_extraction_strategy_locally(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "auto, rules-only, or llm-assisted"):
            goodmemory_backend.GoodMemoryDynamicMemBackend(
                {
                    "base_url": "http://127.0.0.1:8739",
                    "extraction_strategy": "assisted",
                    "user_id": "dynamicmem",
                    "workspace_id": "user-001",
                }
            )

    def test_runner_sanitizes_gold_bearing_checkpoint_before_backend_use(self) -> None:
        checkpoint = {
            "checkpoint_id": "c2",
            "as_of": {
                "timestamp": "2025-06-30T23:59:59Z",
                "app_log_id": "log-3",
            },
            "validated_snapshot_state": {"preferences_state:fitness": "gold-secret"},
            "state_completion_pack": {
                "keys": {
                    "preferences_state:fitness": {
                        "scoring_points": ["gold-secret"],
                    }
                }
            },
            "rq3_apply_service_qa": {"reference_answer": "gold-secret"},
        }

        sanitized = run_goodmemory.sanitize_checkpoint(checkpoint)

        self.assertEqual(
            sanitized,
            {
                "checkpoint_id": "c2",
                "as_of": {
                    "timestamp": "2025-06-30T23:59:59Z",
                    "app_log_id": "log-3",
                },
            },
        )
        self.assertNotIn("gold-secret", json.dumps(sanitized))

    def test_workspace_partition_is_opaque_and_run_specific(self) -> None:
        first = goodmemory_backend.GoodMemoryDynamicMemBackend(
            {
                "base_url": "http://127.0.0.1:8739",
                "user_id": "dynamicmem",
                "workspace_dir": "/tmp/dynamicmem/run-one/user-001",
                "workspace_id": "user-001",
            }
        )
        second = goodmemory_backend.GoodMemoryDynamicMemBackend(
            {
                "base_url": "http://127.0.0.1:8739",
                "user_id": "dynamicmem",
                "workspace_dir": "/tmp/dynamicmem/run-two/user-001",
                "workspace_id": "user-001",
            }
        )

        self.assertNotEqual(first.scope.workspace_id, second.scope.workspace_id)
        self.assertTrue(first.scope.workspace_id.startswith("user-001:"))
        self.assertNotIn("run-one", first.scope.workspace_id)

    def test_runner_recovers_official_retrieval_ids_from_exact_app_log_items(self) -> None:
        items = [
            {
                "category": "dynamicmem_app_log",
                "content": "An assisted fact without the raw app-log header.",
                "memoryId": "memory-1",
                "tags": ["dynamicmem", "dynamicmem-app-log-id:log_00051"],
            },
            {
                "category": "dynamicmem_app_log",
                "content": "Another assisted fact.",
                "memoryId": "memory-duplicate",
                "tags": ["dynamicmem-app-log-id:log_00051"],
            },
            {
                "category": "other",
                "content": "App log id: gold-secret",
                "memoryId": "memory-other",
                "tags": ["dynamicmem-app-log-id:gold-secret"],
            },
        ]

        self.assertEqual(
            run_goodmemory.retrieved_dynamicmem_app_log_ids(items),
            ["log_00051"],
        )


class GoodMemoryConfigTest(unittest.TestCase):
    def test_config_requires_memory_params(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "config.json"
            path.write_text('{"memory_type":"goodmemory"}', encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "memory_params"):
                run_goodmemory.load_goodmemory_config(path)


if __name__ == "__main__":
    unittest.main()
