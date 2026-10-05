import { describe, expect, it } from "bun:test";

import { createEnglishLanguagePack } from "../../../src/language";

const pack = createEnglishLanguagePack();
const sqliteDecision = "Project decision: When SQLite reports SQLITE_BUSY_SNAPSHOT, roll back the transaction, begin again and recompute from a fresh read before writing.";

function decisions(content: string) {
  let id = 0;
  return pack.extractCandidates({
    locale: "en",
    messages: [{ content, role: "user", sourceMessageIndex: 0 }],
    nextId: () => `decision-${++id}`,
  }).filter(candidate => candidate.metadata?.attributes?.languageDurableSignal === "confirmed_decision");
}

describe("explicit project decision declarations", () => {
  it.each([
    sqliteDecision,
    "Repository decision = deployments require a passing smoke test.",
    "The repo decision is to use a single queue for writes.",
    "Project decision is that retries use a fresh transaction.",
    "Project policy: When the cache expires, fetch a fresh copy before serving it.",
    "Project decision: If validation fails, reject the import without partial writes.",
  ])("admits the full explicit declaration: %s", (content) => {
    expect(decisions(content)).toEqual([
      expect.objectContaining({ content, kindHint: "fact", explicitness: "explicit", sourceRole: "user" }),
    ]);
  });

  it.each([
    "Project decision: TBD",
    "Project decision: requires clarification",
    "Project decision: we have not decided yet",
    "Project decision: none",
    "Project decision: when to retry",
    "Project policy: when should retries run",
    "Project decision: When validation fails, what should we do?",
    "Project decision: When validation fails, should we retry",
    "Project decision: What should we use?",
    "There is no project decision: retries are undecided.",
    "What is the project decision: use retries?",
    'Example: "Project decision: use a single queue for writes."',
    'The document says "Project decision: use a single queue for writes."',
    '"Project decision: use a single queue for writes."',
  ])("does not promote a question, placeholder or reported declaration: %s", (content) => {
    expect(decisions(content)).toEqual([]);
  });
});
