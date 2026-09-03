"""Official Python client for the GoodMemory HTTP bridge.

Wire contract: phase-39.http-memory.v1 (see
docs/GoodMemory-Python-HTTP-Integration-Bridge.md in the goodmemory package).
Stdlib only — urllib is the transport; no third-party dependencies.

Design rules mirrored from the bridge:
- Caller identity travels in x-goodmemory-* headers and must agree with the
  body scope; the client derives both from one Scope object.
- The same caller and bearer auth are mirrored in body/fallback headers for
  hosted proxies that strip Authorization or custom caller headers.
- Idempotency keys are required per endpoint the way the server requires them:
  always for feedback/revise, only for async remember.
- HTTP-status errors are never retried (a 409 idempotency conflict must
  surface); only connection-level errors retry.
- Enum validation (strategy/profile/output) is left to the server so the
  client cannot drift from the contract.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

__all__ = [
    "GoodMemoryBridgeError",
    "GoodMemoryClient",
    "GoodMemoryClientError",
    "GoodMemoryConnectionError",
    "RecallContextResult",
    "RecallRouting",
    "Scope",
]


@dataclass(frozen=True)
class Scope:
    """The memory scope; user_id is required by the bridge."""

    user_id: str
    tenant_id: Optional[str] = None
    workspace_id: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None

    def to_payload(self) -> Dict[str, str]:
        payload = {
            "userId": self.user_id,
            "tenantId": self.tenant_id,
            "workspaceId": self.workspace_id,
            "agentId": self.agent_id,
            "sessionId": self.session_id,
        }
        return {key: value for key, value in payload.items() if value is not None}


class GoodMemoryClientError(Exception):
    """Base class for all client errors."""


class GoodMemoryBridgeError(GoodMemoryClientError):
    """The bridge answered with an error (HTTP status or ok!=true body)."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        body: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(f"{code} (HTTP {status}): {message}")
        self.code = code
        self.message = message
        self.status = status
        self.body = body


class GoodMemoryConnectionError(GoodMemoryClientError):
    """Connection-level failure after exhausting retries."""


@dataclass(frozen=True)
class RecallRouting:
    requested_strategy: str
    resolved_strategy: str
    llm_refinement: bool = False
    semantic_tie_breaking: bool = False
    fallback_reason: Optional[str] = None
    provider_fallback: Optional[Dict[str, Any]] = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RecallRouting":
        return cls(
            requested_strategy=str(payload.get("requestedStrategy", "")),
            resolved_strategy=str(payload.get("resolvedStrategy", "")),
            llm_refinement=bool(payload.get("llmRefinement", False)),
            semantic_tie_breaking=bool(payload.get("semanticTieBreaking", False)),
            fallback_reason=payload.get("fallbackReason"),
            provider_fallback=payload.get("providerFallback"),
        )


@dataclass(frozen=True)
class RecallContextResult:
    context_text: str
    has_context: bool
    item_count: int
    items: List[Dict[str, Any]]
    # Always surfaced: hybrid silently downgrades to rules-only without an
    # embedding provider, and routing is the only place that shows it.
    routing: RecallRouting
    contract_version: str
    trace_id: Optional[str]
    raw: Dict[str, Any] = field(repr=False)


class GoodMemoryClient:
    def __init__(
        self,
        base_url: str,
        *,
        scope: Scope,
        token: Optional[str] = None,
        operations: Union[str, Sequence[str]] = "*",
        timeout_seconds: float = 10.0,
        max_attempts: int = 3,
        retry_delay_seconds: float = 0.25,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.scope = scope
        self.token = token
        self.operations = operations
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max(1, max_attempts)
        self.retry_delay_seconds = retry_delay_seconds

    # -- public operations -------------------------------------------------

    def health(self) -> Dict[str, Any]:
        """GET /healthz — auth-free liveness; single attempt, no retries."""
        request = Request(f"{self.base_url}/healthz", method="GET")
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return self._parse_body(response.read(), getattr(response, "status", 200))
        except HTTPError as error:
            raise self._bridge_error(error) from error
        except (TimeoutError, URLError) as error:
            raise GoodMemoryConnectionError(str(error)) from error

    def wait_until_ready(
        self,
        *,
        timeout_seconds: float = 15.0,
        poll_interval_seconds: float = 0.25,
    ) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        last_error: Optional[Exception] = None
        while time.monotonic() < deadline:
            try:
                payload = self.health()
                if payload.get("ok") is True:
                    return payload
            except GoodMemoryClientError as error:
                last_error = error
            time.sleep(poll_interval_seconds)
        raise GoodMemoryConnectionError(
            f"bridge not ready within {timeout_seconds}s: {last_error}"
        )

    def recall_context(
        self,
        query: str,
        *,
        retrieval_profile: Optional[str] = None,
        strategy: Optional[str] = None,
        output: Optional[str] = None,
        max_tokens: Optional[int] = None,
        reference_time: Optional[str] = None,
        timezone: Optional[str] = None,
        scope: Optional[Scope] = None,
    ) -> RecallContextResult:
        body: Dict[str, Any] = {"query": query}
        if retrieval_profile is not None:
            body["retrievalProfile"] = retrieval_profile
        if strategy is not None:
            body["strategy"] = strategy
        if output is not None:
            body["output"] = output
        if max_tokens is not None:
            body["maxTokens"] = max_tokens
        if reference_time is not None:
            body["referenceTime"] = reference_time
        if timezone is not None:
            body["timezone"] = timezone
        payload = self._post("/memory/recall-context", body, scope=scope)
        return RecallContextResult(
            context_text=str(payload.get("contextText", "")),
            has_context=bool(payload.get("hasContext", False)),
            item_count=int(payload.get("itemCount", 0)),
            items=list(payload.get("items", [])),
            routing=RecallRouting.from_payload(payload.get("routing", {})),
            contract_version=str(payload.get("contractVersion", "")),
            trace_id=payload.get("traceId"),
            raw=payload,
        )

    def remember(
        self,
        messages: Sequence[Mapping[str, str]],
        *,
        mode: str = "sync",
        idempotency_key: Optional[str] = None,
        annotations: Optional[Sequence[Mapping[str, Any]]] = None,
        extraction_strategy: Optional[str] = None,
        locale: Optional[str] = None,
        observed_at: Optional[str] = None,
        timezone: Optional[str] = None,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        if mode == "async" and idempotency_key is None:
            raise ValueError(
                "remember(mode='async') requires idempotency_key — the bridge "
                "rejects async writes without one."
            )
        normalized_messages = [dict(message) for message in messages]
        if observed_at is not None and normalized_messages:
            normalized_messages[-1].setdefault("observedAt", observed_at)
        body: Dict[str, Any] = {"messages": normalized_messages, "mode": mode}
        if idempotency_key is not None:
            body["idempotencyKey"] = idempotency_key
        if annotations is not None:
            body["annotations"] = list(annotations)
        if extraction_strategy is not None:
            body["extractionStrategy"] = extraction_strategy
        if locale is not None:
            body["locale"] = locale
        if timezone is not None:
            body["timezone"] = timezone
        return self._post("/memory/remember", body, scope=scope)

    def feedback(
        self,
        signal: str,
        *,
        idempotency_key: str,
        source: Optional[Mapping[str, str]] = None,
        locale: Optional[str] = None,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"signal": signal, "idempotencyKey": idempotency_key}
        if source is not None:
            # Provenance echo only: the bridge records it in the response, it
            # does not influence the stored memory.
            body["source"] = dict(source)
        if locale is not None:
            body["locale"] = locale
        return self._post("/memory/feedback", body, scope=scope)

    def forget(self, memory_id: str, *, scope: Optional[Scope] = None) -> Dict[str, Any]:
        return self._post("/memory/forget", {"memoryId": memory_id}, scope=scope)

    def export(
        self,
        *,
        include_runtime: bool = False,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        return self._post(
            "/memory/export", {"includeRuntime": include_runtime}, scope=scope
        )

    def revise(
        self,
        *,
        memory_id: str,
        content: str,
        reason: str,
        idempotency_key: str,
        evidence: Optional[Mapping[str, Any]] = None,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        # Query-targeted revision is not offered: the bridge only accepts
        # target.memoryId (target_memory_id_required otherwise).
        body: Dict[str, Any] = {
            "target": {"memoryId": memory_id},
            "revision": {"content": content},
            "reason": reason,
            "idempotencyKey": idempotency_key,
        }
        if evidence is not None:
            body["evidence"] = dict(evidence)
        return self._post("/memory/revise", body, scope=scope)

    def import_memory(
        self,
        *,
        pages: Optional[Sequence[Mapping[str, str]]] = None,
        durable: Optional[Mapping[str, Any]] = None,
        dry_run: bool = False,
        oversize: Optional[str] = None,
        expected_sha256: Optional[str] = None,
        locale: Optional[str] = None,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        """Import memoryfield pages (as notes) or an export envelope's durable
        section (by id). Pass exactly one of ``pages`` or ``durable``."""
        if (pages is None) == (durable is None):
            raise ValueError("import_memory expects exactly one of pages or durable")
        source: Dict[str, Any]
        if pages is not None:
            source = {
                "kind": "pages",
                "pages": [
                    {"path": page["path"], "content": page["content"]} for page in pages
                ],
            }
        else:
            source = {"kind": "durable", "durable": dict(durable or {})}
        body: Dict[str, Any] = {"source": source}
        if dry_run:
            body["dryRun"] = True
        if oversize is not None:
            body["oversize"] = oversize
        if expected_sha256 is not None:
            body["expectedSha256"] = expected_sha256
        if locale is not None:
            body["locale"] = locale
        return self._post("/memory/import", body, scope=scope)

    # -- transport ----------------------------------------------------------

    def _headers(self, scope: Scope) -> Dict[str, str]:
        operations = (
            self.operations
            if isinstance(self.operations, str)
            else ",".join(self.operations)
        )
        headers = {
            "content-type": "application/json",
            "x-goodmemory-user-id": scope.user_id,
            "x-goodmemory-operations": operations,
        }
        # The bridge authorizes tenant/workspace in both directions; only send
        # what the scope actually carries.
        if scope.tenant_id is not None:
            headers["x-goodmemory-tenant-id"] = scope.tenant_id
        if scope.workspace_id is not None:
            headers["x-goodmemory-workspace-id"] = scope.workspace_id
        if self.token is not None:
            headers["authorization"] = f"Bearer {self.token}"
            headers["x-goodmemory-bridge-auth"] = f"Bearer {self.token}"
        return headers

    def _caller_payload(self, scope: Scope) -> Dict[str, Any]:
        operations: Union[str, List[str]]
        if isinstance(self.operations, str):
            operations = self.operations
        else:
            operations = list(self.operations)

        payload: Dict[str, Any] = {
            "authorizedOperations": operations,
            "userId": scope.user_id,
        }
        if scope.tenant_id is not None:
            payload["tenantId"] = scope.tenant_id
        if scope.workspace_id is not None:
            payload["workspaceId"] = scope.workspace_id
        return payload

    def _post(
        self,
        path: str,
        body: Dict[str, Any],
        *,
        scope: Optional[Scope] = None,
    ) -> Dict[str, Any]:
        effective_scope = scope or self.scope
        payload = dict(body)
        payload["caller"] = self._caller_payload(effective_scope)
        payload["scope"] = effective_scope.to_payload()
        if self.token is not None:
            payload["bridgeAuth"] = f"Bearer {self.token}"
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(effective_scope),
            method="POST",
        )

        last_error: Optional[Exception] = None
        for attempt in range(self.max_attempts):
            try:
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    return self._parse_body(
                        response.read(), getattr(response, "status", 200)
                    )
            except HTTPError as error:
                # HTTP-status errors are terminal: retrying a 409/403/400
                # would hide real contract violations.
                raise self._bridge_error(error) from error
            except (TimeoutError, URLError) as error:
                last_error = error
                if attempt + 1 < self.max_attempts:
                    time.sleep(self.retry_delay_seconds)
        raise GoodMemoryConnectionError(str(last_error)) from last_error

    def _parse_body(self, raw: bytes, status: int) -> Dict[str, Any]:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GoodMemoryBridgeError(
                "invalid_response", f"non-JSON bridge response: {error}", status
            ) from error
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise GoodMemoryBridgeError(
                "unexpected_response",
                "bridge answered without ok:true",
                status,
                payload if isinstance(payload, dict) else None,
            )
        return payload

    def _bridge_error(self, error: HTTPError) -> GoodMemoryBridgeError:
        body: Optional[Dict[str, Any]] = None
        code = "http_error"
        message = str(error)
        try:
            parsed = json.loads(error.read().decode("utf-8"))
            if isinstance(parsed, dict):
                body = parsed
                detail = parsed.get("error")
                if isinstance(detail, dict):
                    code = str(detail.get("code", code))
                    message = str(detail.get("message", message))
        except (UnicodeDecodeError, json.JSONDecodeError, OSError):
            pass
        return GoodMemoryBridgeError(code, message, error.code, body)
