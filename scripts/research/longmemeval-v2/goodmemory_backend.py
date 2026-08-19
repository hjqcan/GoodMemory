from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

from goodmemory_client import GoodMemoryClient, Scope
from memory_modules.memory import Memory, MemoryContextItem, register_memory


SCREENSHOT_PATTERN = re.compile(r"^Screenshot:\s*(.+?)\s*$", re.MULTILINE)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def required_string(params: dict[str, object], name: str) -> str:
    value = params.get(name)
    require(isinstance(value, str) and bool(value.strip()), f"goodmemory {name} must be a non-empty string")
    return value.strip()


def optional_string(params: dict[str, object], name: str) -> str | None:
    value = params.get(name)
    if value is None:
        return None
    require(isinstance(value, str) and bool(value.strip()), f"goodmemory {name} must be null or a non-empty string")
    return value.strip()


def positive_int(params: dict[str, object], name: str, default: int) -> int:
    value = params.get(name, default)
    require(
        isinstance(value, int) and not isinstance(value, bool) and value > 0,
        f"goodmemory {name} must be a positive integer",
    )
    return value


@register_memory
class GoodMemoryBackend(Memory):
    """LongMemEval-V2 adapter for GoodMemory's public HTTP bridge."""

    memory_type = "goodmemory"

    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        self.data_root = Path(required_string(memory_params, "data_root")).expanduser().resolve()
        require(self.data_root.is_dir(), f"goodmemory data_root does not exist: {self.data_root}")
        self.batch_size = positive_int(memory_params, "batch_size", 8)
        self.max_screenshots = positive_int(memory_params, "max_screenshots", 8)
        self.max_tokens = positive_int(memory_params, "max_tokens", 200_000)
        self.retrieval_profile = str(memory_params.get("retrieval_profile", "general_chat"))
        self.strategy = str(memory_params.get("strategy", "hybrid"))
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
        token_env = str(memory_params.get("token_env", "GOODMEMORY_BRIDGE_TOKEN")).strip()
        require(token_env, "goodmemory token_env must be a non-empty string")
        token = os.getenv(token_env)
        self.client = GoodMemoryClient(
            required_string(memory_params, "base_url"),
            scope=self.scope,
            token=token,
            operations=["recall-context", "remember"],
            timeout_seconds=float(memory_params.get("timeout_seconds", 120.0)),
            max_attempts=positive_int(memory_params, "max_attempts", 3),
        )
        self._log(
            "initialized",
            data_root=str(self.data_root),
            retrieval_profile=self.retrieval_profile,
            strategy=self.strategy,
            workspace_id=self.scope.workspace_id,
        )

    def insert(self, trajectory: dict[str, object]) -> None:
        trajectory_id = trajectory.get("id")
        goal = trajectory.get("goal")
        states = trajectory.get("states")
        require(isinstance(trajectory_id, str) and bool(trajectory_id), "trajectory id must be a non-empty string")
        require(isinstance(goal, str), f"trajectory goal must be a string for {trajectory_id}")
        require(isinstance(states, list) and bool(states), f"trajectory states must be a non-empty list for {trajectory_id}")

        messages = [
            {
                "id": f"{trajectory_id}:summary",
                "role": "user",
                "content": self._trajectory_summary(trajectory),
            }
        ]
        for state_position, state in enumerate(states):
            require(isinstance(state, dict), f"trajectory {trajectory_id} state {state_position} must be an object")
            messages.append(
                {
                    "id": f"{trajectory_id}:state:{state_position}",
                    "role": "user",
                    "content": self._state_fact(trajectory_id, state_position, state),
                }
            )

        trajectory_scope = Scope(
            user_id=self.scope.user_id,
            tenant_id=self.scope.tenant_id,
            workspace_id=self.scope.workspace_id,
            agent_id=self.scope.agent_id,
            session_id=trajectory_id,
        )
        for offset in range(0, len(messages), self.batch_size):
            batch = messages[offset : offset + self.batch_size]
            annotations = [
                {
                    "messageIndex": index,
                    "remember": "always",
                    "kindHint": "fact",
                    "confirmed": True,
                    "verified": True,
                    "reason": "Exact observation from the locked LongMemEval-V2 trajectory corpus.",
                    "metadataPatch": {
                        "category": "agent_trajectory",
                        "scopeKind": "project",
                        "subject": trajectory_id,
                        "tags": ["longmemeval-v2", str(trajectory.get("domain", "unknown"))],
                        "attributes": {
                            "trajectoryId": trajectory_id,
                            "messageId": message["id"],
                        },
                    },
                }
                for index, message in enumerate(batch)
            ]
            response = self.client.remember(
                batch,
                annotations=annotations,
                extraction_strategy="rules-only",
                mode="sync",
                scope=trajectory_scope,
            )
            result = response.get("result", response)
            events = result.get("events", []) if isinstance(result, dict) else []
            successful_annotations = [
                event
                for event in events
                if isinstance(event, dict)
                and isinstance(event.get("annotation"), dict)
                and event["annotation"].get("remember") == "always"
                and event.get("outcome") in {"written", "merged", "superseded"}
            ]
            if len(successful_annotations) < len(batch):
                self._log(
                    "trajectory_insert_rejected",
                    events=events,
                    outcome=result.get("outcome") if isinstance(result, dict) else None,
                    rejected=result.get("rejected") if isinstance(result, dict) else None,
                    required_exact_facts=len(batch),
                    successful_exact_facts=len(successful_annotations),
                    trajectory_id=trajectory_id,
                    warnings=result.get("warnings", []) if isinstance(result, dict) else [],
                )
            require(
                len(successful_annotations) >= len(batch),
                f"GoodMemory did not persist every exact trajectory fact for {trajectory_id}",
            )

        self._log("trajectory_inserted", message_count=len(messages), trajectory_id=trajectory_id)

    def query(
        self,
        query: str,
        query_image: str | None = None,
    ) -> list[MemoryContextItem]:
        require(isinstance(query, str) and bool(query.strip()), "goodmemory query must be non-empty")
        recalled = self.client.recall_context(
            query,
            retrieval_profile=self.retrieval_profile,
            strategy=self.strategy,
            output="markdown",
            max_tokens=self.max_tokens,
        )
        context: list[MemoryContextItem] = []
        if recalled.context_text.strip():
            context.append({"type": "text", "value": recalled.context_text})
        screenshot_paths = self._recalled_screenshots(recalled.items)
        context.extend({"type": "image", "value": str(path)} for path in screenshot_paths)

        routing = recalled.raw.get("routing")
        warnings = routing.get("warnings", []) if isinstance(routing, dict) else []
        self._log(
            "query_completed",
            context_item_count=len(context),
            query_image_present=query_image is not None,
            query_invocation_id=self.get_query_context().get("query_invocation_id"),
            recalled_item_count=len(recalled.items),
            screenshot_count=len(screenshot_paths),
            warnings=warnings,
        )
        return context

    def _trajectory_summary(self, trajectory: dict[str, object]) -> str:
        return "\n".join(
            [
                "LongMemEval-V2 trajectory summary",
                f"Trajectory: {trajectory['id']}",
                f"Domain: {trajectory.get('domain', '')}",
                f"Environment: {trajectory.get('environment', '')}",
                f"Goal: {trajectory['goal']}",
                f"Outcome: {trajectory.get('outcome', '')}",
                f"Start URL: {trajectory.get('start_url', '')}",
            ]
        )

    def _state_fact(
        self,
        trajectory_id: str,
        state_position: int,
        state: dict[str, Any],
    ) -> str:
        screenshot_value = state.get("screenshot")
        require(
            isinstance(screenshot_value, str) and bool(screenshot_value.strip()),
            f"trajectory {trajectory_id} state {state_position} screenshot must be a non-empty string",
        )
        screenshot_path = Path(screenshot_value)
        if not screenshot_path.is_absolute():
            screenshot_path = self.data_root / screenshot_path
        screenshot_path = screenshot_path.resolve()
        require(screenshot_path.is_file(), f"missing trajectory screenshot: {screenshot_path}")
        accessibility_tree = state.get("accessibility_tree")
        require(
            isinstance(accessibility_tree, str),
            f"trajectory {trajectory_id} state {state_position} accessibility_tree must be a string",
        )
        return "\n".join(
            [
                "LongMemEval-V2 trajectory state",
                f"Trajectory: {trajectory_id}",
                f"State index: {state.get('state_index', state_position)}",
                f"Step: {state.get('step', state_position)}",
                f"URL: {state.get('url', '')}",
                f"Action: {state.get('action') or ''}",
                f"Thought: {state.get('thought') or ''}",
                "Accessibility tree:",
                accessibility_tree,
                f"Screenshot: {screenshot_path}",
            ]
        )

    def _recalled_screenshots(self, items: list[dict[str, Any]]) -> list[Path]:
        screenshots: list[Path] = []
        seen: set[Path] = set()
        for item in items:
            content = item.get("content")
            if not isinstance(content, str):
                continue
            for match in SCREENSHOT_PATTERN.finditer(content):
                path = Path(match.group(1)).expanduser().resolve()
                if (
                    path in seen
                    or not path.is_file()
                    or not path.is_relative_to(self.data_root)
                ):
                    continue
                seen.add(path)
                screenshots.append(path)
                if len(screenshots) >= self.max_screenshots:
                    return screenshots
        return screenshots

    def _log(self, event: str, **fields: object) -> None:
        print(
            "[goodmemory:longmemeval-v2] "
            + json.dumps({"event": event, **fields}, ensure_ascii=True, sort_keys=True),
            file=sys.stderr,
            flush=True,
        )
