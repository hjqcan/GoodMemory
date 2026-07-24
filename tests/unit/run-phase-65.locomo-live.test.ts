import { describe, expect, it } from "bun:test";
import {
  buildLocomoEvidencePackContext,
  buildLocomoSystemPrompt,
  runLocomoSmoke,
} from "../../scripts/run-phase-65-locomo-smoke";
import { buildLocomoSmokeCases } from "../../src/eval/locomo";

describe("LoCoMo live answer evidence-pack wiring", () => {
  it("builds a source-ordered evidence pack from the retrieved turns", () => {
    const testCase = buildLocomoSmokeCases()[0];
    const pack = buildLocomoEvidencePackContext({
      question: testCase.questions[0],
      retrievedTurnIds: testCase.turns.map((turn) => turn.diaId),
      testCase,
    });
    expect(pack).toContain("Evidence (source-ordered, earliest first):");
    expect(pack).toContain("latest entry is the current value");
    // Carries the actual dialog content and a per-turn session time anchor.
    expect(pack).toContain(testCase.turns[0].content);
    expect(pack).toContain("session ");
  });

  it("routes LoCoMo categories into the shared evidence-pack answer operations", () => {
    const cases = buildLocomoSmokeCases();
    const multiHopCase = cases.find((testCase) =>
      testCase.questions.some((question) => question.category === "multi_hop"),
    );
    const multiHopQuestion = multiHopCase?.questions.find(
      (question) => question.category === "multi_hop",
    );
    if (!multiHopCase || !multiHopQuestion) {
      throw new Error("missing synthetic multi_hop case");
    }
    const multiHopPack = buildLocomoEvidencePackContext({
      question: multiHopQuestion,
      retrievedTurnIds: multiHopCase.turns.map((turn) => turn.diaId),
      testCase: multiHopCase,
    });
    expect(multiHopPack).toContain("Multi-session reasoning");

    const adversarialCase = cases.find((testCase) =>
      testCase.questions.some((question) => question.category === "adversarial"),
    );
    const adversarialQuestion = adversarialCase?.questions.find(
      (question) => question.category === "adversarial",
    );
    if (!adversarialCase || !adversarialQuestion) {
      throw new Error("missing synthetic adversarial case");
    }
    const adversarialPack = buildLocomoEvidencePackContext({
      question: adversarialQuestion,
      retrievedTurnIds: adversarialCase.turns.map((turn) => turn.diaId),
      testCase: adversarialCase,
    });
    expect(adversarialPack).toContain("Abstention calibration");
  });

  it("adds a multi-hop answer-synthesis guard only for multi-hop questions", () => {
    const multiHopPrompt = buildLocomoSystemPrompt({
      questionCategory: "multi_hop",
    });
    expect(multiHopPrompt).toContain("For multi-hop questions");
    expect(multiHopPrompt).toContain(
      "do not stop at the first matching clue",
    );

    const singleHopPrompt = buildLocomoSystemPrompt({
      questionCategory: "single_hop",
    });
    expect(singleHopPrompt).not.toContain(
      "do not stop at the first matching clue",
    );
  });

  it("backfills retrieval cues through the shipped maintenance path when enabled", async () => {
    const seenInputs: Array<{ category: string; content: string }> = [];
    const report = await runLocomoSmoke(
      { retrievalCues: true },
      {
        mkdir: async () => undefined,
        retrievalCueGenerator: {
          generate: async (input) => {
            seenInputs.push({ category: input.category, content: input.content });
            return ["Where did that conversation topic come up?"];
          },
        },
        writeFile: async () => undefined,
      },
    );

    const totalTurns = buildLocomoSmokeCases().reduce(
      (sum, testCase) => sum + testCase.turns.length,
      0,
    );
    // Every stored fact gets exactly one cue generation (raw-turn facts plus
    // any facts the deterministic extractor derived), and every generated cue
    // is written back through the maintenance job (record==wire in the
    // report).
    expect(report.retrievalCues?.factsSeen).toBeGreaterThanOrEqual(totalTurns);
    expect(report.retrievalCues?.cuesApplied).toBe(
      report.retrievalCues?.factsSeen,
    );
    expect(seenInputs).toHaveLength(report.retrievalCues?.factsSeen ?? -1);
    expect(
      seenInputs.filter((input) => input.content.includes("[LOCOMO dia_id="))
        .length,
    ).toBe(totalTurns);
  });

  it("omits retrieval-cue stats when the flag is off", async () => {
    const report = await runLocomoSmoke(
      {},
      {
        mkdir: async () => undefined,
        writeFile: async () => undefined,
      },
    );
    expect(report.retrievalCues).toBeUndefined();
  });

  it("rejects retrieval cues with an injected memory factory", async () => {
    await expect(
      runLocomoSmoke(
        { retrievalCues: true },
        {
          createMemory: () => {
            throw new Error("unreachable");
          },
          mkdir: async () => undefined,
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "--retrieval-cues requires the built-in memory factory; it cannot be combined with an injected createMemory dependency.",
    );
  });

  it("permits the chain-of-note note pass only when the reading mode is on", () => {
    const chainOfNotePrompt = buildLocomoSystemPrompt({ chainOfNote: true });
    expect(chainOfNotePrompt).toContain("reading protocol");
    expect(chainOfNotePrompt).toContain('"Final answer:"');

    const defaultPrompt = buildLocomoSystemPrompt({});
    expect(defaultPrompt).not.toContain("reading protocol");
    expect(defaultPrompt).toContain("Output only the final answer");
  });

  it("routes the answer context through the pack when evidencePack is set", async () => {
    const capturedContexts: string[] = [];
    const report = await runLocomoSmoke(
      { evidencePack: true },
      {
        answerGenerator: async (input) => {
          capturedContexts.push(input.memoryContext);
          return "stub answer";
        },
        mkdir: async () => undefined,
        writeFile: async () => undefined,
      },
    );
    expect(report.mode).toBe("live-answer");
    expect(report.answerEvaluation).toBe("scored");
    expect(
      capturedContexts.some((context) =>
        context.includes("Evidence (source-ordered, earliest first):"),
      ),
    ).toBe(true);
    expect(
      capturedContexts.some((context) =>
        context.includes("Evidence for absence check:"),
      ),
    ).toBe(true);
  });

  it("uses the plain dialog context when evidencePack is not set", async () => {
    let capturedContext = "";
    await runLocomoSmoke(
      {},
      {
        answerGenerator: async (input) => {
          capturedContext = input.memoryContext;
          return "stub answer";
        },
        mkdir: async () => undefined,
        writeFile: async () => undefined,
      },
    );
    expect(capturedContext).not.toContain("Evidence (source-ordered");
  });
});
