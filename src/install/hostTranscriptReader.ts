import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

// Native Codex and Claude Code Stop payloads reference the session transcript
// by path (transcript_path); nothing inline. This reader turns that JSONL file
// into the bounded, role-tagged message window the writeback pipeline consumes.
// It is the only module that understands the host transcript format, so
// format drift stays contained here. It never persists anything: callers
// receive in-memory messages and a byte cursor.

export interface HostTranscriptMessage {
  content: string;
  role: "assistant" | "user";
}

export type HostTranscriptReadStatus =
  | "format_drift"
  | "missing_file"
  | "not_absolute"
  | "ok"
  | "read_failed";

export interface HostTranscriptFormatDrift {
  byteOffset: number;
  reason: string;
}

export interface HostTranscriptReadResult {
  formatDrift?: HostTranscriptFormatDrift;
  messages: HostTranscriptMessage[];
  // Byte offset just past the last fully parsed line; feed back as
  // fromOffset to read only the delta on the next hook firing.
  nextOffset: number;
  status: HostTranscriptReadStatus;
  truncatedHead: boolean;
}

export interface ReadTranscriptDeltaInput {
  fromOffset?: number;
  maxBytes?: number;
  maxContentChars?: number;
  maxMessages?: number;
  transcriptPath: string;
}

// Tail window large enough for many turns while bounding pathological
// session files; the writeback config re-bounds messages/chars downstream.
const DEFAULT_MAX_BYTES = 262_144;
const DEFAULT_MAX_MESSAGES = 48;
// Defensive per-message clamp; MAX_WRITEBACK_MESSAGE_CHARS re-clamps later.
const MAX_MESSAGE_CHARS = 4_000;
// Host-injected wrappers that are not user-authored conversation.
const NON_CONVERSATIONAL_PREFIXES = [
  "<command-name>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<system-reminder>",
];
const LINE_FEED = 0x0a;

class TranscriptFormatDriftError extends Error {}

export async function readClaudeTranscriptDelta(
  input: ReadTranscriptDeltaInput,
): Promise<HostTranscriptReadResult> {
  return readTranscriptDeltaWithParser(input, parseTranscriptLine);
}

// Codex CLI rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl):
// {timestamp, type, payload} lines; conversation is response_item messages
// with input_text/output_text content blocks. Developer-role scaffolding and
// host-injected wrappers are not conversation.
export async function readCodexRolloutDelta(
  input: ReadTranscriptDeltaInput,
): Promise<HostTranscriptReadResult> {
  return readTranscriptDeltaWithParser(input, parseCodexRolloutLine);
}

async function readTranscriptDeltaWithParser(
  input: ReadTranscriptDeltaInput,
  parseLine: (line: string) => HostTranscriptMessage | null,
): Promise<HostTranscriptReadResult> {
  if (!isAbsolute(input.transcriptPath)) {
    return emptyResult(input.fromOffset ?? 0, "not_absolute");
  }

  let size: number;
  try {
    size = (await stat(input.transcriptPath)).size;
  } catch (error) {
    return emptyResult(
      input.fromOffset ?? 0,
      isMissingFileError(error) ? "missing_file" : "read_failed",
    );
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const windowStart = size > maxBytes ? size - maxBytes : 0;
  // A cursor beyond the file means the file was replaced (resume/clear
  // rewrites); fall back to the tail window instead of failing.
  const cursor =
    input.fromOffset !== undefined && input.fromOffset <= size
      ? input.fromOffset
      : undefined;
  const start = cursor !== undefined ? Math.max(cursor, windowStart) : windowStart;
  const truncatedHead = start > (cursor ?? 0) && start > 0;

  let buffer: Buffer;
  try {
    const handle = await open(input.transcriptPath, "r");
    try {
      const length = size - start;
      buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return emptyResult(
      input.fromOffset ?? 0,
      isMissingFileError(error) ? "missing_file" : "read_failed",
    );
  }

  // A window that opens mid-line must skip to the next full line. Offset 0
  // and a resumed cursor are always line-aligned (nextOffset only ever
  // advances past a terminating newline); anything else landed mid-content.
  const lineAligned = start === 0 || start === cursor;
  let position = 0;
  if (!lineAligned) {
    const firstLineFeed = buffer.indexOf(LINE_FEED);
    if (firstLineFeed === -1) {
      return { messages: [], nextOffset: start, status: "ok", truncatedHead };
    }
    position = firstLineFeed + 1;
  }

  const messages: HostTranscriptMessage[] = [];
  const maxContentChars = input.maxContentChars ?? Number.POSITIVE_INFINITY;
  const maxMessages = input.maxMessages ?? DEFAULT_MAX_MESSAGES;
  let contentChars = 0;
  let consumedEnd = start + position;
  while (position < buffer.length) {
    const lineStart = start + position;
    const lineFeed = buffer.indexOf(LINE_FEED, position);
    if (lineFeed === -1) {
      // Unterminated final line: likely mid-write; leave it for next time.
      break;
    }
    const line = buffer.subarray(position, lineFeed).toString("utf8");
    position = lineFeed + 1;
    consumedEnd = start + position;

    let message: HostTranscriptMessage | null;
    try {
      message = parseLine(line);
    } catch (error) {
      if (!(error instanceof TranscriptFormatDriftError)) {
        throw error;
      }
      return {
        formatDrift: { byteOffset: lineStart, reason: error.message },
        messages: [],
        nextOffset: lineStart,
        status: "format_drift",
        truncatedHead,
      };
    }
    if (message) {
      if (
        messages.length > 0 &&
        contentChars + message.content.length > maxContentChars
      ) {
        consumedEnd = lineStart;
        break;
      }
      messages.push(message);
      contentChars += message.content.length;
      if (messages.length >= maxMessages) {
        break;
      }
    }
  }

  return {
    messages,
    nextOffset: consumedEnd,
    status: "ok",
    truncatedHead,
  };
}

function parseTranscriptLine(line: string): HostTranscriptMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (parsed.isMeta === true || parsed.isSidechain === true) {
    return null;
  }
  if (parsed.type !== "user" && parsed.type !== "assistant") {
    return null;
  }
  const message = parsed.message;
  if (!isRecord(message)) {
    return null;
  }

  if (parsed.type === "user") {
    return parseUserContent(message.content);
  }
  return parseAssistantContent(message.content);
}

function parseUserContent(content: unknown): HostTranscriptMessage | null {
  // Array content is tool_result plumbing, not user-authored conversation.
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (NON_CONVERSATIONAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return null;
  }
  return { content: clampMessage(trimmed), role: "user" };
}

function parseAssistantContent(content: unknown): HostTranscriptMessage | null {
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .filter(
      (block): block is { text: string; type: "text" } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text.trim())
    .filter((blockText) => blockText.length > 0)
    .join("\n");
  if (text.length === 0) {
    return null;
  }
  return { content: clampMessage(text), role: "assistant" };
}

const CODEX_NON_CONVERSATIONAL_PREFIXES = [
  "<environment_context>",
  "<permissions",
  "<recommended_plugins>",
  "<user_instructions>",
];

function parseCodexRolloutLine(line: string): HostTranscriptMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TranscriptFormatDriftError("line is not valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new TranscriptFormatDriftError(
      "line must be an object with a string type",
    );
  }
  if (parsed.type !== "response_item") {
    return null;
  }
  const payload = parsed.payload;
  if (!isRecord(payload)) {
    throw new TranscriptFormatDriftError("response_item payload must be an object");
  }
  if (payload.type !== "message") {
    return null;
  }
  const role = payload.role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  if (!Array.isArray(payload.content)) {
    throw new TranscriptFormatDriftError(
      "response_item message content must be an array",
    );
  }

  const expectedBlockType = role === "user" ? "input_text" : "output_text";
  const textBlocks: string[] = [];
  for (const block of payload.content) {
    if (!isRecord(block) || typeof block.type !== "string") {
      throw new TranscriptFormatDriftError(
        "message content blocks must be objects with string types",
      );
    }
    if (block.type !== expectedBlockType) {
      continue;
    }
    if (typeof block.text !== "string") {
      throw new TranscriptFormatDriftError(
        `${expectedBlockType} text must be a string`,
      );
    }
    const blockText = block.text.trim();
    if (blockText.length > 0) {
      textBlocks.push(blockText);
    }
  }
  const text = textBlocks.join("\n");
  if (text.length === 0) {
    return null;
  }
  if (
    role === "user" &&
    CODEX_NON_CONVERSATIONAL_PREFIXES.some((prefix) => text.startsWith(prefix))
  ) {
    return null;
  }

  return { content: clampMessage(text), role };
}

function clampMessage(content: string): string {
  return content.length > MAX_MESSAGE_CHARS
    ? content.slice(0, MAX_MESSAGE_CHARS)
    : content;
}

function emptyResult(
  nextOffset: number,
  status: HostTranscriptReadStatus,
): HostTranscriptReadResult {
  return { messages: [], nextOffset, status, truncatedHead: false };
}

function isMissingFileError(error: unknown): boolean {
  return (
    isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
