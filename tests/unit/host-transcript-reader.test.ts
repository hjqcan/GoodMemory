import { describe, expect, it } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readClaudeTranscriptDelta,
  readCodexRolloutDelta,
} from "../../src/install/hostTranscriptReader";

// The Stop/SessionEnd hook payloads carry transcript_path (a Claude Code
// session JSONL file), not inline messages. The reader turns that file into
// the bounded role-tagged message window the writeback pipeline already
// consumes. Fixtures mirror the verified on-disk format: one JSON object per
// line, `type` user|assistant plus non-conversational bookkeeping lines.

async function createTranscript(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gm-transcript-"));
  const path = join(dir, "session.jsonl");
  await writeFile(
    path,
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") +
      "\n",
    "utf8",
  );
  return path;
}

function userLine(content: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    cwd: "/tmp/project",
    message: { content, role: "user" },
    sessionId: "session-1",
    timestamp: "2026-07-05T10:00:00.000Z",
    type: "user",
    uuid: "uuid-user",
    ...extra,
  };
}

function assistantLine(
  content: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    cwd: "/tmp/project",
    message: { content, model: "claude-fable-5", role: "assistant" },
    sessionId: "session-1",
    timestamp: "2026-07-05T10:00:01.000Z",
    type: "assistant",
    uuid: "uuid-assistant",
    ...extra,
  };
}

describe("readClaudeTranscriptDelta", () => {
  it("parses user strings and assistant text blocks into ordered role-tagged messages", async () => {
    const path = await createTranscript([
      { sessionId: "session-1", type: "ai-title" },
      userLine("I prefer bun test over npm test for this repo."),
      assistantLine([
        { signature: "sig", thinking: "internal reasoning", type: "thinking" },
        { text: "Noted. The deploy is blocked on the smoke suite.", type: "text" },
        { id: "tool-1", input: {}, name: "Bash", type: "tool_use" },
        { text: "I will rerun it after the fix.", type: "text" },
      ]),
      { type: "queue-operation" },
    ]);

    const result = await readClaudeTranscriptDelta({ transcriptPath: path });

    expect(result.status).toBe("ok");
    expect(result.truncatedHead).toBe(false);
    expect(result.messages).toEqual([
      { content: "I prefer bun test over npm test for this repo.", role: "user" },
      {
        content:
          "Noted. The deploy is blocked on the smoke suite.\nI will rerun it after the fix.",
        role: "assistant",
      },
    ]);
    expect(result.nextOffset).toBeGreaterThan(0);
  });

  it("skips tool_result users, meta, sidechain, and non-conversational lines", async () => {
    const path = await createTranscript([
      userLine([{ content: "tool output", tool_use_id: "tool-1", type: "tool_result" }]),
      userLine("Meta caveat content that should not leak.", { isMeta: true }),
      userLine("Subagent traffic should stay invisible.", { isSidechain: true }),
      assistantLine([{ text: "Sidechain answer.", type: "text" }], { isSidechain: true }),
      { snapshot: {}, type: "file-history-snapshot" },
      userLine("The release owner is the platform team."),
    ]);

    const result = await readClaudeTranscriptDelta({ transcriptPath: path });

    expect(result.messages).toEqual([
      { content: "The release owner is the platform team.", role: "user" },
    ]);
  });

  it("drops host wrappers while preserving short non-empty user content", async () => {
    const path = await createTranscript([
      userLine("<command-name>/compact</command-name>"),
      userLine("<local-command-stdout>ok</local-command-stdout>"),
      userLine("<local-command-caveat>Caveat: local commands</local-command-caveat>"),
      userLine("<system-reminder>reminder</system-reminder>"),
      userLine("ok"),
      userLine("請用繁體"),
      userLine("日本語で"),
      userLine("Ship the fix tomorrow."),
    ]);

    const result = await readClaudeTranscriptDelta({ transcriptPath: path });

    expect(result.messages).toEqual([
      { content: "ok", role: "user" },
      { content: "請用繁體", role: "user" },
      { content: "日本語で", role: "user" },
      { content: "Ship the fix tomorrow.", role: "user" },
    ]);
  });

  it("bounds reads to a tail window and marks the truncation", async () => {
    const filler = "x".repeat(200);
    const lines: unknown[] = [];
    for (let index = 0; index < 40; index += 1) {
      lines.push(userLine(`Early message ${index} ${filler}`));
    }
    lines.push(userLine("The final decision is to use sqlite."));
    const path = await createTranscript(lines);

    const result = await readClaudeTranscriptDelta({
      maxBytes: 600,
      transcriptPath: path,
    });

    expect(result.status).toBe("ok");
    expect(result.truncatedHead).toBe(true);
    // A mid-line window start must skip to the next full line, never emit a
    // partially parsed message.
    expect(
      result.messages.every((message) => message.content.startsWith("Early message") ||
        message.content === "The final decision is to use sqlite."),
    ).toBe(true);
    expect(result.messages.at(-1)).toEqual({
      content: "The final decision is to use sqlite.",
      role: "user",
    });
  });

  it("resumes from a cursor offset and reports a stable nextOffset", async () => {
    const path = await createTranscript([userLine("First turn user statement here.")]);

    const first = await readClaudeTranscriptDelta({ transcriptPath: path });
    expect(first.messages).toHaveLength(1);

    const noGrowth = await readClaudeTranscriptDelta({
      fromOffset: first.nextOffset,
      transcriptPath: path,
    });
    expect(noGrowth.messages).toEqual([]);
    expect(noGrowth.nextOffset).toBe(first.nextOffset);

    const appended = JSON.stringify(userLine("Second turn adds the rollout date.")) + "\n";
    await writeFile(path, appended, { flag: "a" });

    const delta = await readClaudeTranscriptDelta({
      fromOffset: first.nextOffset,
      transcriptPath: path,
    });
    expect(delta.messages).toEqual([
      { content: "Second turn adds the rollout date.", role: "user" },
    ]);
    expect(delta.nextOffset).toBeGreaterThan(first.nextOffset);
  });

  it("leaves an unterminated final line unread until the host completes it", async () => {
    const path = await createTranscript([userLine("Complete line before the append.")]);
    const completedOffset = (await stat(path)).size;
    await writeFile(
      path,
      JSON.stringify(userLine("Line that is still being written.")),
      { flag: "a" },
    );

    const partial = await readClaudeTranscriptDelta({ transcriptPath: path });
    expect(partial.messages).toEqual([
      { content: "Complete line before the append.", role: "user" },
    ]);
    expect(partial.nextOffset).toBe(completedOffset);

    await writeFile(path, "\n", { flag: "a" });
    const completed = await readClaudeTranscriptDelta({
      fromOffset: partial.nextOffset,
      transcriptPath: path,
    });
    expect(completed.messages).toEqual([
      { content: "Line that is still being written.", role: "user" },
    ]);
    expect(completed.nextOffset).toBe((await stat(path)).size);
  });

  it("resets to the tail window when the cursor is beyond the file size", async () => {
    const path = await createTranscript([userLine("Rewritten session content stands alone.")]);

    const result = await readClaudeTranscriptDelta({
      fromOffset: 999_999,
      transcriptPath: path,
    });

    expect(result.status).toBe("ok");
    expect(result.messages).toEqual([
      { content: "Rewritten session content stands alone.", role: "user" },
    ]);
  });

  it("reports missing files and relative paths without throwing", async () => {
    const missing = await readClaudeTranscriptDelta({
      transcriptPath: join(tmpdir(), "gm-transcript-missing", "absent.jsonl"),
    });
    expect(missing.status).toBe("missing_file");
    expect(missing.messages).toEqual([]);

    const relative = await readClaudeTranscriptDelta({
      transcriptPath: "relative/session.jsonl",
    });
    expect(relative.status).toBe("not_absolute");
    expect(relative.messages).toEqual([]);
  });

  it("skips malformed lines and clamps oversized messages", async () => {
    const path = await createTranscript([
      "{not json at all",
      userLine(`Long preference statement: ${"y".repeat(5000)}`),
      userLine("Trailing valid line survives."),
    ]);

    const result = await readClaudeTranscriptDelta({ transcriptPath: path });

    expect(result.status).toBe("ok");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content.length).toBeLessThanOrEqual(4000);
    expect(result.messages[1]).toEqual({
      content: "Trailing valid line survives.",
      role: "user",
    });
  });

  it("caps the number of returned messages keeping the oldest unread chunk", async () => {
    const lines: unknown[] = [];
    for (let index = 0; index < 60; index += 1) {
      lines.push(userLine(`Numbered statement ${index} about the project.`));
    }
    const path = await createTranscript(lines);

    const result = await readClaudeTranscriptDelta({
      maxMessages: 5,
      transcriptPath: path,
    });

    expect(result.messages).toHaveLength(5);
    expect(result.messages.at(-1)?.content).toBe("Numbered statement 4 about the project.");
    expect(result.messages[0]?.content).toBe("Numbered statement 0 about the project.");
  });

  it("returns bounded messages oldest-first and leaves the unread suffix for the next cursor", async () => {
    const path = await createTranscript([
      userLine("Next step is the durable instruction at the head."),
      ...Array.from({ length: 12 }, () => userLine("sounds good")),
    ]);

    const first = await readClaudeTranscriptDelta({
      maxMessages: 12,
      transcriptPath: path,
    });

    expect(first.messages).toHaveLength(12);
    expect(first.messages[0]?.content).toBe(
      "Next step is the durable instruction at the head.",
    );
    expect(first.nextOffset).toBeLessThan((await stat(path)).size);

    const remaining = await readClaudeTranscriptDelta({
      fromOffset: first.nextOffset,
      maxMessages: 12,
      transcriptPath: path,
    });
    expect(remaining.messages).toEqual([{ content: "sounds good", role: "user" }]);
    expect(remaining.nextOffset).toBe((await stat(path)).size);
  });

  it("leaves messages beyond the oldest bounded content budget for the next cursor", async () => {
    const path = await createTranscript([
      userLine("Durable head instruction."),
      userLine("This later message would exceed the bounded content budget."),
    ]);

    const first = await readClaudeTranscriptDelta({
      maxContentChars: 30,
      transcriptPath: path,
    });
    expect(first.messages).toEqual([
      { content: "Durable head instruction.", role: "user" },
    ]);
    expect(first.nextOffset).toBeLessThan((await stat(path)).size);

    const second = await readClaudeTranscriptDelta({
      fromOffset: first.nextOffset,
      maxContentChars: 30,
      transcriptPath: path,
    });
    expect(second.messages).toEqual([
      {
        content: "This later message would exceed the bounded content budget.",
        role: "user",
      },
    ]);
    expect(second.nextOffset).toBe((await stat(path)).size);
  });
});
// Codex rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) carry
// {timestamp, type, payload} lines; conversation lives in response_item
// messages with input_text/output_text content blocks.
describe("readCodexRolloutDelta", () => {
  function rolloutLine(
    role: string,
    text: string,
    type = "response_item",
  ): unknown {
    return {
      payload: {
        content: [
          { text, type: role === "assistant" ? "output_text" : "input_text" },
        ],
        role,
        type: "message",
      },
      timestamp: "2026-07-05T10:00:00.000Z",
      type,
    };
  }

  it("parses user and assistant rollout messages and skips bookkeeping", async () => {
    const path = await createTranscript([
      { payload: { id: "s" }, timestamp: "t", type: "session_meta" },
      rolloutLine("user", "We use pnpm for this repository."),
      rolloutLine("developer", "developer scaffolding text"),
      rolloutLine("assistant", "Understood, noting the package manager."),
      { payload: {}, timestamp: "t", type: "turn_context" },
      { payload: {}, timestamp: "t", type: "compacted" },
      rolloutLine(
        "user",
        "<recommended_plugins>registry suggestions</recommended_plugins>",
      ),
      rolloutLine("user", "<environment_context>cwd=/tmp</environment_context>"),
      rolloutLine("user", "<user_instructions>be terse</user_instructions>"),
      rolloutLine("user", "ok"),
      rolloutLine("user", "請用繁體"),
      rolloutLine("user", "日本語で"),
    ]);

    const result = await readCodexRolloutDelta({ transcriptPath: path });

    expect(result.status).toBe("ok");
    expect(result.messages).toEqual([
      { content: "We use pnpm for this repository.", role: "user" },
      { content: "Understood, noting the package manager.", role: "assistant" },
      { content: "ok", role: "user" },
      { content: "請用繁體", role: "user" },
      { content: "日本語で", role: "user" },
    ]);
  });

  it("resumes from a byte cursor like the claude reader", async () => {
    const path = await createTranscript([
      rolloutLine("user", "First rollout statement for the cursor."),
    ]);
    const first = await readCodexRolloutDelta({ transcriptPath: path });
    expect(first.messages).toHaveLength(1);

    const noGrowth = await readCodexRolloutDelta({
      fromOffset: first.nextOffset,
      transcriptPath: path,
    });
    expect(noGrowth.messages).toEqual([]);
  });

  it("reports missing rollout files without throwing", async () => {
    const missing = await readCodexRolloutDelta({
      transcriptPath: join(tmpdir(), "gm-rollout-missing", "absent.jsonl"),
    });
    expect(missing.status).toBe("missing_file");
  });

  it("reports Codex conversation schema drift without consuming the invalid line", async () => {
    const path = await createTranscript([
      rolloutLine("user", "Valid statement before the drift."),
      {
        payload: {
          content: "changed wire shape",
          role: "assistant",
          type: "message",
        },
        timestamp: "2026-07-15T10:00:00.000Z",
        type: "response_item",
      },
      rolloutLine("user", "This line must remain unread for a retry."),
    ]);

    const result = await readCodexRolloutDelta({ transcriptPath: path });

    expect(result.status).toBe("format_drift");
    expect(result.messages).toEqual([]);
    expect(result.formatDrift).toEqual({
      byteOffset: expect.any(Number),
      reason: "response_item message content must be an array",
    });
    if (!result.formatDrift) {
      throw new Error("expected Codex transcript format drift evidence");
    }
    expect(result.nextOffset).toBe(result.formatDrift.byteOffset);
  });
});
