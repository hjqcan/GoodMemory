from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
import sys
import time
from typing import Any

from goodmemory_client import GoodMemoryClient, RecallContextResult, Scope


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def required_string(params: dict[str, object], name: str) -> str:
    value = params.get(name)
    require(
        isinstance(value, str) and bool(value.strip()),
        f"goodmemory {name} must be a non-empty string",
    )
    return value.strip()


def optional_string(params: dict[str, object], name: str) -> str | None:
    value = params.get(name)
    if value is None:
        return None
    require(
        isinstance(value, str) and bool(value.strip()),
        f"goodmemory {name} must be null or a non-empty string",
    )
    return value.strip()


def positive_int(params: dict[str, object], name: str, default: int) -> int:
    value = params.get(name, default)
    require(
        isinstance(value, int) and not isinstance(value, bool) and value > 0,
        f"goodmemory {name} must be a positive integer",
    )
    return value


def normalize_dynamicmem_timestamp(value: str, *, label: str) -> str:
    timestamp = value.strip()
    try:
        datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as error:
            raise RuntimeError(
                f"DynamicMem {label} must use YYYY-MM-DD HH:MM:SS or RFC 3339"
            ) from error
        require(
            parsed.tzinfo is not None,
            f"DynamicMem {label} must use YYYY-MM-DD HH:MM:SS or RFC 3339",
        )
        return timestamp
    return timestamp.replace(" ", "T") + "Z"


class GoodMemoryDynamicMemBackend:
    """Checkpoint-bounded DynamicMem adapter for GoodMemory's HTTP bridge."""

    def __init__(self, memory_params: dict[str, object]) -> None:
        self.batch_size = positive_int(memory_params, "batch_size", 16)
        self.max_tokens = positive_int(memory_params, "max_tokens", 32_000)
        self.retrieval_profile = str(
            memory_params.get("retrieval_profile", "general_chat")
        ).strip()
        self.strategy = str(memory_params.get("strategy", "hybrid")).strip()
        self.extraction_strategy = str(
            memory_params.get("extraction_strategy", "llm-assisted")
        ).strip()
        require(self.retrieval_profile != "", "goodmemory retrieval_profile must be non-empty")
        require(self.strategy != "", "goodmemory strategy must be non-empty")
        require(
            self.extraction_strategy in {"auto", "rules-only", "llm-assisted"},
            "goodmemory extraction_strategy must be auto, rules-only, or llm-assisted",
        )

        workspace_id = required_string(memory_params, "workspace_id")
        workspace_dir = optional_string(memory_params, "workspace_dir")
        if workspace_dir is not None:
            workspace_digest = hashlib.sha256(
                str(Path(workspace_dir).expanduser().resolve()).encode("utf-8")
            ).hexdigest()[:16]
            workspace_id = f"{workspace_id}:{workspace_digest}"

        self.scope = Scope(
            user_id=required_string(memory_params, "user_id"),
            tenant_id=optional_string(memory_params, "tenant_id"),
            workspace_id=workspace_id,
            agent_id=optional_string(memory_params, "agent_id"),
        )
        token_env = str(
            memory_params.get("token_env", "GOODMEMORY_BRIDGE_TOKEN")
        ).strip()
        require(token_env != "", "goodmemory token_env must be non-empty")
        self.client = GoodMemoryClient(
            required_string(memory_params, "base_url"),
            scope=self.scope,
            token=os.getenv(token_env),
            operations=["recall-context", "remember"],
            timeout_seconds=float(memory_params.get("timeout_seconds", 600.0)),
            max_attempts=positive_int(memory_params, "max_attempts", 1),
        )
        self._visible_log_ids: list[str] = []
        self._log(
            "initialized",
            extraction_strategy=self.extraction_strategy,
            retrieval_profile=self.retrieval_profile,
            strategy=self.strategy,
            workspace_id=self.scope.workspace_id,
        )

    def prepare_checkpoint(
        self,
        checkpoint_id: str,
        checkpoint_timestamp: str,
        memory_pool: list[dict[str, Any]],
    ) -> None:
        require(bool(checkpoint_id.strip()), "DynamicMem checkpoint id must be non-empty")
        require(
            bool(checkpoint_timestamp.strip()),
            f"DynamicMem checkpoint {checkpoint_id} timestamp must be non-empty",
        )
        log_ids = [self._app_log_id(log, index) for index, log in enumerate(memory_pool)]
        require(
            len(set(log_ids)) == len(log_ids),
            f"DynamicMem checkpoint {checkpoint_id} contains duplicate app_log_id values",
        )
        require(
            log_ids[: len(self._visible_log_ids)] == self._visible_log_ids,
            f"DynamicMem checkpoint {checkpoint_id} is not a monotonic prefix of prior app logs",
        )
        new_logs = memory_pool[len(self._visible_log_ids) :]
        if not new_logs:
            self._log(
                "checkpoint_prepared",
                checkpoint_id=checkpoint_id,
                checkpoint_timestamp=checkpoint_timestamp,
                new_log_count=0,
                visible_log_count=len(memory_pool),
            )
            return

        checkpoint_scope = Scope(
            user_id=self.scope.user_id,
            tenant_id=self.scope.tenant_id,
            workspace_id=self.scope.workspace_id,
            agent_id=self.scope.agent_id,
            session_id=checkpoint_id,
        )
        batch_count = (len(new_logs) + self.batch_size - 1) // self.batch_size
        for offset in range(0, len(new_logs), self.batch_size):
            batch = new_logs[offset : offset + self.batch_size]
            batch_index = offset // self.batch_size + 1
            batch_log_ids = [
                self._app_log_id(log, offset + index)
                for index, log in enumerate(batch)
            ]
            messages = [self._message(log, offset + index) for index, log in enumerate(batch)]
            annotations = [
                self._annotation(log, index)
                for index, log in enumerate(batch)
            ]
            self._log(
                "checkpoint_batch_started",
                batch_count=batch_count,
                batch_index=batch_index,
                batch_message_count=len(batch),
                checkpoint_id=checkpoint_id,
                first_app_log_id=batch_log_ids[0],
                last_app_log_id=batch_log_ids[-1],
            )
            batch_started = time.perf_counter()
            response = self.client.remember(
                messages,
                annotations=annotations,
                extraction_strategy=self.extraction_strategy,
                mode="sync",
                scope=checkpoint_scope,
            )
            result = response.get("result", response)
            warnings = result.get("warnings", []) if isinstance(result, dict) else []
            metadata = result.get("metadata", {}) if isinstance(result, dict) else {}
            resolved_extraction_strategy = (
                metadata.get("resolvedExtractionStrategy")
                if isinstance(metadata, dict)
                else None
            )
            if self.extraction_strategy == "llm-assisted" and (
                "assisted_extraction_failed" in warnings
                or resolved_extraction_strategy != "llm-assisted"
            ):
                self._log(
                    "checkpoint_batch_degraded",
                    batch_count=batch_count,
                    batch_index=batch_index,
                    checkpoint_id=checkpoint_id,
                    resolved_extraction_strategy=resolved_extraction_strategy,
                    warnings=warnings,
                )
                raise RuntimeError(
                    f"GoodMemory assisted extraction degraded for {checkpoint_id}; "
                    "start the run again with a fresh database and workspace"
                )
            events = result.get("events", []) if isinstance(result, dict) else []
            successful_exact_facts = [
                event
                for event in events
                if isinstance(event, dict)
                and isinstance(event.get("annotation"), dict)
                and event["annotation"].get("remember") == "always"
                and event.get("outcome") in {"written", "merged", "superseded"}
            ]
            if len(successful_exact_facts) < len(batch):
                self._log(
                    "checkpoint_batch_rejected",
                    checkpoint_id=checkpoint_id,
                    events=events,
                    required_exact_facts=len(batch),
                    successful_exact_facts=len(successful_exact_facts),
                )
            require(
                len(successful_exact_facts) >= len(batch),
                f"GoodMemory did not persist every DynamicMem app log for {checkpoint_id}",
            )
            self._log(
                "checkpoint_batch_committed",
                batch_count=batch_count,
                batch_index=batch_index,
                checkpoint_id=checkpoint_id,
                committed_message_count=len(batch),
                elapsed_ms=round((time.perf_counter() - batch_started) * 1000, 3),
            )

        self._visible_log_ids = log_ids
        self._log(
            "checkpoint_prepared",
            checkpoint_id=checkpoint_id,
            checkpoint_timestamp=checkpoint_timestamp,
            new_log_count=len(new_logs),
            visible_log_count=len(memory_pool),
        )

    def query(self, query: str, *, reference_time: str) -> RecallContextResult:
        require(bool(query.strip()), "DynamicMem query must be non-empty")
        require(bool(reference_time.strip()), "DynamicMem reference time must be non-empty")
        normalized_reference_time = normalize_dynamicmem_timestamp(
            reference_time,
            label="checkpoint timestamp",
        )
        recalled = self.client.recall_context(
            query,
            retrieval_profile=self.retrieval_profile,
            strategy=self.strategy,
            output="markdown",
            max_tokens=self.max_tokens,
            reference_time=normalized_reference_time,
        )
        routing = recalled.raw.get("routing")
        warnings = routing.get("warnings", []) if isinstance(routing, dict) else []
        self._log(
            "query_completed",
            has_context=recalled.has_context,
            item_count=len(recalled.items),
            reference_time=normalized_reference_time,
            warnings=warnings,
        )
        return recalled

    def _app_log_id(self, log: dict[str, Any], position: int) -> str:
        require(
            isinstance(log, dict),
            f"DynamicMem app log {position} must be an object",
        )
        value = log.get("app_log_id")
        require(
            isinstance(value, str) and bool(value.strip()),
            f"DynamicMem app log {position} app_log_id must be a non-empty string",
        )
        return value.strip()

    def _message(self, log: dict[str, Any], position: int) -> dict[str, str]:
        log_id = self._app_log_id(log, position)
        timestamp = log.get("timestamp")
        require(
            isinstance(timestamp, str) and bool(timestamp.strip()),
            f"DynamicMem app log {log_id} timestamp must be a non-empty string",
        )
        payload = json.dumps(log, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {
            "id": f"dynamicmem:{log_id}",
            "role": "user",
            "observedAt": normalize_dynamicmem_timestamp(
                timestamp,
                label=f"app log {log_id} timestamp",
            ),
            "content": "\n".join(
                [
                    "DynamicMem app log",
                    f"App log id: {log_id}",
                    f"Timestamp: {timestamp.strip()}",
                    f"Payload: {payload}",
                ]
            ),
        }

    def _annotation(self, log: dict[str, Any], message_index: int) -> dict[str, Any]:
        log_id = self._app_log_id(log, message_index)
        attributes = {
            "appLogId": log_id,
            "timestamp": str(log.get("timestamp") or ""),
        }
        for source_key, target_key in [
            ("app_name", "appName"),
            ("app", "appName"),
            ("api_name", "apiName"),
            ("api", "apiName"),
        ]:
            value = log.get(source_key)
            if isinstance(value, str) and value.strip() and target_key not in attributes:
                attributes[target_key] = value.strip()
        return {
            "messageIndex": message_index,
            "remember": "always",
            "kindHint": "fact",
            "confirmed": True,
            "verified": True,
            "reason": "Exact observation from the locked DynamicMem app-log corpus.",
            "metadataPatch": {
                "category": "dynamicmem_app_log",
                "subject": self.scope.workspace_id,
                "tags": [
                    "dynamicmem",
                    "app-log",
                    f"dynamicmem-app-log-id:{log_id}",
                ],
                "attributes": attributes,
            },
        }

    def _log(self, event: str, **payload: object) -> None:
        print(
            "[goodmemory:dynamicmem] "
            + json.dumps({"event": event, **payload}, ensure_ascii=False, sort_keys=True),
            file=sys.stderr,
            flush=True,
        )
