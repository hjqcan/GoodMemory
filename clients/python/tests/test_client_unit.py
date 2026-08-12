"""Unit tests for the official GoodMemory bridge client (stdlib only).

Run standalone:
    python3 -m unittest discover -s clients/python/tests -t clients/python
"""

from __future__ import annotations

import io
import json
import unittest
from typing import Any, Dict, List, Optional
from unittest import mock
from urllib.error import HTTPError, URLError

from goodmemory_client import (
    GoodMemoryBridgeError,
    GoodMemoryClient,
    GoodMemoryConnectionError,
    Scope,
)


def ok_response(payload: Dict[str, Any]) -> mock.MagicMock:
    response = mock.MagicMock()
    response.read.return_value = json.dumps(payload).encode("utf-8")
    response.status = 200
    response.__enter__.return_value = response
    response.__exit__.return_value = False
    return response


def http_error(status: int, payload: Dict[str, Any]) -> HTTPError:
    return HTTPError(
        "http://bridge/memory/forget",
        status,
        "error",
        None,  # type: ignore[arg-type]
        io.BytesIO(json.dumps(payload).encode("utf-8")),
    )


def build_client(**overrides: Any) -> GoodMemoryClient:
    kwargs: Dict[str, Any] = {
        "scope": Scope(user_id="u-1", workspace_id="workspace-a"),
        "retry_delay_seconds": 0.0,
    }
    kwargs.update(overrides)
    return GoodMemoryClient("http://bridge:8739", **kwargs)


class ScopeTests(unittest.TestCase):
    def test_payload_uses_camel_case_and_omits_none(self) -> None:
        scope = Scope(user_id="u-1", workspace_id="workspace-a", session_id="s-1")
        self.assertEqual(
            scope.to_payload(),
            {"userId": "u-1", "workspaceId": "workspace-a", "sessionId": "s-1"},
        )


class HeaderDerivationTests(unittest.TestCase):
    def request_headers(self, client: GoodMemoryClient) -> Dict[str, str]:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": True, "result": {}, "operation": "forget"}),
        ) as spy:
            client.forget("m-1")
        request = spy.call_args[0][0]
        return {key.lower(): value for key, value in request.header_items()}

    def test_headers_derive_from_scope(self) -> None:
        headers = self.request_headers(build_client())
        self.assertEqual(headers["x-goodmemory-user-id"], "u-1")
        self.assertEqual(headers["x-goodmemory-workspace-id"], "workspace-a")
        self.assertEqual(headers["x-goodmemory-operations"], "*")
        self.assertNotIn("x-goodmemory-tenant-id", headers)
        self.assertNotIn("authorization", headers)

    def test_bearer_token_and_operations_list(self) -> None:
        headers = self.request_headers(
            build_client(token="secret", operations=["recall-context", "forget"]),
        )
        self.assertEqual(headers["authorization"], "Bearer secret")
        self.assertEqual(headers["x-goodmemory-bridge-auth"], "Bearer secret")
        self.assertEqual(
            headers["x-goodmemory-operations"], "recall-context,forget"
        )

    def test_per_call_scope_rederives_headers(self) -> None:
        client = build_client()
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": True, "result": {}, "operation": "forget"}),
        ) as spy:
            client.forget(
                "m-1",
                scope=Scope(user_id="u-2", tenant_id="tenant-b"),
            )
        request = spy.call_args[0][0]
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(headers["x-goodmemory-user-id"], "u-2")
        self.assertEqual(headers["x-goodmemory-tenant-id"], "tenant-b")
        self.assertNotIn("x-goodmemory-workspace-id", headers)
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["scope"], {"userId": "u-2", "tenantId": "tenant-b"})
        self.assertEqual(
            body["caller"],
            {
                "authorizedOperations": "*",
                "tenantId": "tenant-b",
                "userId": "u-2",
            },
        )

    def test_bearer_token_is_mirrored_for_header_stripping_proxies(self) -> None:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": True, "result": {}, "operation": "forget"}),
        ) as spy:
            build_client(token="secret").forget("m-1")

        body = json.loads(spy.call_args[0][0].data.decode("utf-8"))
        self.assertEqual(body["bridgeAuth"], "Bearer secret")


class IdempotencyRuleTests(unittest.TestCase):
    def test_feedback_requires_idempotency_key_keyword(self) -> None:
        with self.assertRaises(TypeError):
            build_client().feedback("keep summaries short")  # type: ignore[call-arg]

    def test_revise_requires_idempotency_key_keyword(self) -> None:
        with self.assertRaises(TypeError):
            build_client().revise(  # type: ignore[call-arg]
                memory_id="m-1",
                content="new",
                reason="fix",
            )

    def test_async_remember_requires_idempotency_key(self) -> None:
        with self.assertRaises(ValueError):
            build_client().remember(
                [{"role": "user", "content": "note"}],
                mode="async",
            )


class ErrorMappingTests(unittest.TestCase):
    def test_bridge_error_carries_code_and_status(self) -> None:
        error_payload = {
            "ok": False,
            "error": {"code": "operation_not_authorized", "message": "denied"},
        }
        with mock.patch(
            "goodmemory_client.client.urlopen",
            side_effect=http_error(403, error_payload),
        ):
            with self.assertRaises(GoodMemoryBridgeError) as caught:
                build_client().export()
        self.assertEqual(caught.exception.code, "operation_not_authorized")
        self.assertEqual(caught.exception.status, 403)

    def test_http_errors_never_retry(self) -> None:
        conflict = {
            "ok": False,
            "error": {"code": "idempotency_conflict", "message": "conflict"},
        }
        with mock.patch(
            "goodmemory_client.client.urlopen",
            side_effect=http_error(409, conflict),
        ) as spy:
            with self.assertRaises(GoodMemoryBridgeError) as caught:
                build_client().remember(
                    [{"role": "user", "content": "note"}],
                    idempotency_key="turn-1",
                    mode="async",
                )
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(spy.call_count, 1)

    def test_ok_false_body_on_200_raises(self) -> None:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": False}),
        ):
            with self.assertRaises(GoodMemoryBridgeError) as caught:
                build_client().export()
        self.assertEqual(caught.exception.code, "unexpected_response")

    def test_connection_errors_retry_then_succeed(self) -> None:
        responses: List[Any] = [
            URLError("refused"),
            ok_response({"ok": True, "result": {}, "operation": "forget"}),
        ]
        with mock.patch(
            "goodmemory_client.client.urlopen",
            side_effect=responses,
        ) as spy:
            build_client().forget("m-1")
        self.assertEqual(spy.call_count, 2)

    def test_connection_errors_exhaust_to_connection_error(self) -> None:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            side_effect=URLError("refused"),
        ) as spy:
            with self.assertRaises(GoodMemoryConnectionError):
                build_client(max_attempts=2).forget("m-1")
        self.assertEqual(spy.call_count, 2)


class RecallRoutingTests(unittest.TestCase):
    def test_temporal_context_uses_snake_case_public_arguments(self) -> None:
        payload = {
            "ok": True,
            "operation": "recall-context",
            "contractVersion": "phase-39.http-memory.v1",
            "contextText": "",
            "hasContext": False,
            "itemCount": 0,
            "items": [],
            "routing": {},
        }
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response(payload),
        ) as spy:
            build_client().recall_context(
                "what happened yesterday?",
                reference_time="2026-11-01T05:30:00.000Z",
                timezone="America/New_York",
            )

        body = json.loads(spy.call_args[0][0].data.decode("utf-8"))
        self.assertEqual(body["referenceTime"], "2026-11-01T05:30:00.000Z")
        self.assertEqual(body["timezone"], "America/New_York")

    def test_remember_maps_current_message_observation_and_timezone(self) -> None:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": True, "operation": "remember"}),
        ) as spy:
            build_client().remember(
                [
                    {"role": "user", "content": "Earlier turn"},
                    {
                        "role": "user",
                        "content": "Current turn",
                        "timezone": "Europe/Paris",
                    },
                ],
                observed_at="2026-11-01T05:29:00.000Z",
                timezone="America/New_York",
            )

        body = json.loads(spy.call_args[0][0].data.decode("utf-8"))
        self.assertNotIn("observedAt", body["messages"][0])
        self.assertEqual(
            body["messages"][1]["observedAt"],
            "2026-11-01T05:29:00.000Z",
        )
        self.assertEqual(body["messages"][1]["timezone"], "Europe/Paris")
        self.assertEqual(body["timezone"], "America/New_York")

    def test_recall_result_exposes_routing(self) -> None:
        payload = {
            "ok": True,
            "operation": "recall-context",
            "contractVersion": "phase-39.http-memory.v1",
            "contextText": "memory context",
            "hasContext": True,
            "itemCount": 1,
            "items": [
                {
                    "memoryId": "m-1",
                    "type": "fact",
                    "content": "x",
                    "occurrence": {
                        "start": "2026-08-10T16:00:00.000Z",
                        "endExclusive": "2026-08-11T16:00:00.000Z",
                        "precision": "day",
                        "timezone": "Asia/Shanghai",
                    },
                }
            ],
            "routing": {
                "requestedStrategy": "hybrid",
                "resolvedStrategy": "rules-only",
                "llmRefinement": False,
                "semanticTieBreaking": False,
                "fallbackReason": "semantic_search_unavailable",
                "providerFallback": {
                    "reason": "provider_error",
                    "recoveredStrategy": "rules-only",
                },
            },
        }
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response(payload),
        ):
            result = build_client().recall_context("what is my focus?")

        self.assertEqual(result.context_text, "memory context")
        self.assertTrue(result.has_context)
        self.assertEqual(result.item_count, 1)
        self.assertEqual(
            result.items[0]["occurrence"],
            {
                "start": "2026-08-10T16:00:00.000Z",
                "endExclusive": "2026-08-11T16:00:00.000Z",
                "precision": "day",
                "timezone": "Asia/Shanghai",
            },
        )
        # The routing block must surface so callers can see hybrid silently
        # downgrading to rules-only.
        self.assertEqual(result.routing.requested_strategy, "hybrid")
        self.assertEqual(result.routing.resolved_strategy, "rules-only")
        self.assertEqual(
            result.routing.fallback_reason, "semantic_search_unavailable"
        )
        self.assertEqual(
            result.routing.provider_fallback,
            {"reason": "provider_error", "recoveredStrategy": "rules-only"},
        )
        self.assertEqual(result.contract_version, "phase-39.http-memory.v1")
        self.assertIs(result.raw["ok"], True)

    def test_revise_flattens_target_and_revision(self) -> None:
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response({"ok": True, "result": {}, "operation": "revise"}),
        ) as spy:
            build_client().revise(
                memory_id="m-1",
                content="corrected",
                reason="user fix",
                idempotency_key="rev-1",
            )
        body = json.loads(spy.call_args[0][0].data.decode("utf-8"))
        self.assertEqual(body["target"], {"memoryId": "m-1"})
        self.assertEqual(body["revision"], {"content": "corrected"})
        self.assertEqual(body["reason"], "user fix")
        self.assertEqual(body["idempotencyKey"], "rev-1")


class HealthTests(unittest.TestCase):
    def test_health_uses_get_without_auth(self) -> None:
        client = build_client(token="secret")
        with mock.patch(
            "goodmemory_client.client.urlopen",
            return_value=ok_response(
                {"ok": True, "status": "ok", "contractVersion": "phase-39.http-memory.v1"},
            ),
        ) as spy:
            payload = client.health()

        request = spy.call_args[0][0]
        self.assertEqual(request.get_method(), "GET")
        self.assertTrue(request.full_url.endswith("/healthz"))
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertNotIn("authorization", headers)
        self.assertNotIn("x-goodmemory-user-id", headers)
        self.assertEqual(payload["status"], "ok")


if __name__ == "__main__":
    unittest.main()
