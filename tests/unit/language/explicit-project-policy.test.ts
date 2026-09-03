import { describe, expect, it } from "bun:test";

import { createEnglishLanguagePack } from "../../../src/language";
import type { MemoryCandidate } from "../../../src/domain/memoryCandidate";

const pack = createEnglishLanguagePack();

function extract(content: string): MemoryCandidate[] {
  let counter = 0;
  return pack.extractCandidates({
    locale: "en",
    messages: [
      {
        analysis: pack.analyzeContent(content),
        content,
        role: "user",
        sourceMessageIndex: 0,
      },
    ],
    nextId: () => `policy-${++counter}`,
  });
}

function confirmedDecisions(content: string): MemoryCandidate[] {
  return extract(content).filter(
    (candidate) =>
      candidate.metadata?.attributes?.languageDurableSignal ===
        "confirmed_decision",
  );
}

// Explicit declaration markers followed by a substantive rule body. The body
// vocabulary is deliberately varied: admission must not depend on which verb
// the user happened to choose.
const SUBSTANTIVE_DECLARATIONS = [
  "Establish and implement the field-boundary policy for this repository. Project policy: only double quotes protect a delimiter; grouping double quotes are removed; two consecutive double quotes inside a protected field produce one literal double quote; single quotes are ordinary characters. Preserve the existing return shape.",
  "Establish and implement the delimiter-boundary policy for this repository using splitAssignment. Project policy: split at the last occurrence of the assignment delimiter, preserve the complete head before that boundary, use the content after it as the second item, and return null when the delimiter is absent. Keep the exported signature stable.",
  "Establish and implement the duration-boundary policy for this repository. Project policy: each unqualified configuration duration value represents one 250 millisecond project quantum; multiply it by 250 exactly once; fields whose names end in Ms are already measured values and pass through unchanged.",
  "Establish and implement the endpoint-display policy for this repository. Project policy: for endpoint display text, wrap a host containing a colon in one pair of parentheses unless it is already wrapped; leave other hosts unchanged.",
  "Project policy: single quotes are ordinary characters and never protect a delimiter.",
  "Repository policy = commits are squashed before they land on main.",
  "The repo policy mandates that every migration ships with a rollback script.",
  "Project policy is that we squash commits before merge.",
  "Project policy is to pin every third-party action to a commit SHA.",
] as const;

// Questions, negations, and placeholders are never decisions.
const NON_DECISIONS = [
  "What is the project policy for deleting production data?",
  "There is no repository policy for deleting production data.",
  "Project policy is not defined.",
  "Project policy is what?",
  "Repository policy is under discussion.",
  "Project policy is unknown.",
  "Project policy is TBD.",
  "Repository policy is not finalized.",
  "Repository policy is being discussed.",
  "Project policy: TBD",
  "Project policy: requires clarification",
  "Project policy is to be determined.",
  "Project policy is that we have not decided.",
  "Project policy: ?",
  "Project policy: none",
  "Project policy: still open, we haven't decided yet",
  "Project policy: what should it be?",
] as const;

describe("explicit project policy declarations", () => {
  for (const content of SUBSTANTIVE_DECLARATIONS) {
    it(`admits a substantive declaration regardless of its verb: ${content.slice(0, 48)}`, () => {
      const decisions = confirmedDecisions(content);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        explicitness: "explicit",
        kindHint: "fact",
        sourceRole: "user",
      });
      expect(decisions[0]!.content.toLowerCase()).toContain("policy");
    });
  }

  for (const content of NON_DECISIONS) {
    it(`rejects a question, negation, or placeholder: ${content}`, () => {
      expect(confirmedDecisions(content)).toEqual([]);
    });
  }

  it("keeps the same admission for every C4 controlled-pilot policy prompt", async () => {
    const root =
      "fixtures/codex-coding-effect/c4-controlled-pilot/prompts";
    const prompts = [
      "field-boundary-policy-parse-csv-fields.md",
      "delimiter-boundary-policy-split-assignment.md",
      "duration-configuration-policy-resolve-timeout-config.md",
      "endpoint-open-loop-render-host-display.md",
    ];
    for (const name of prompts) {
      const content = await Bun.file(`${root}/${name}`).text();
      expect(confirmedDecisions(content).length, name).toBe(1);
    }
  });
});
