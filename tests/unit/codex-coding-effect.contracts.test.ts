import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  CODEX_CODING_EFFECT_EVIDENCE_CLASSES,
  evaluateCodexCodingEffectClaim,
} from "../../scripts/codex-coding-effect/contracts";

describe("Codex coding-effect evidence contracts", () => {
  it("keeps historical C0/C2 runners direct and off the package script API", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    )) as { scripts?: Record<string, string> };

    expect(
      Object.keys(packageJson.scripts ?? {}).filter((name) =>
        name.includes("codex-coding-effect")
      ),
    ).toEqual([]);
    expect(
      await Bun.file(
        new URL("../../scripts/run-codex-coding-effect.ts", import.meta.url),
      ).exists(),
    ).toBe(true);
    expect(
      await Bun.file(
        new URL(
          "../../scripts/project-codex-coding-effect-c2-evidence.ts",
          import.meta.url,
        ),
      ).exists(),
    ).toBe(true);
  });

  it("freezes the evidence classes without treating pilots as public proof", () => {
    expect(CODEX_CODING_EFFECT_EVIDENCE_CLASSES).toEqual([
      "host-canary",
      "deterministic-smoke",
      "frozen-prehistory-pilot",
      "native-longitudinal-pilot",
      "codex-coding-effect-candidate",
      "codex-coding-effect-accepted",
    ]);

    for (const evidenceClass of CODEX_CODING_EFFECT_EVIDENCE_CLASSES.slice(0, -1)) {
      expect(evaluateCodexCodingEffectClaim({
        evidenceClass,
        evidenceKind: "host-native-patch",
        fullGateAccepted: false,
        host: "codex",
      }).claimable).toBe(false);
    }
  });

  it("accepts only an accepted Codex host-native patch gate", () => {
    expect(evaluateCodexCodingEffectClaim({
      evidenceClass: "codex-coding-effect-accepted",
      evidenceKind: "host-native-patch",
      fullGateAccepted: true,
      host: "codex",
    })).toEqual({
      claimable: true,
      excludedHosts: ["claude-code"],
      failures: [],
      host: "codex",
      primaryMetric: "hidden-test-resolve-at-1",
    });
  });

  it("does not promote a candidate before the accepted gate transition", () => {
    const result = evaluateCodexCodingEffectClaim({
      evidenceClass: "codex-coding-effect-candidate",
      evidenceKind: "host-native-patch",
      fullGateAccepted: true,
      host: "codex",
    });

    expect(result.claimable).toBe(false);
    expect(result.failures).toContain(
      "public coding-effect claims require codex-coding-effect-accepted evidence",
    );
  });

  it("rejects a Claude claim from the Codex-first evidence lane", () => {
    const result = evaluateCodexCodingEffectClaim({
      evidenceClass: "codex-coding-effect-accepted",
      evidenceKind: "host-native-patch",
      fullGateAccepted: true,
      host: "claude-code",
    });

    expect(result.claimable).toBe(false);
    expect(result.failures).toContain(
      "the first coding-effect claim is scoped to Codex only",
    );
  });

  it("rejects MemGym, memory QA, and retrieval diagnostics as patch evidence", () => {
    for (const evidenceKind of [
      "memgym-codeqa",
      "memory-qa",
      "retrieval-diagnostic",
    ] as const) {
      const result = evaluateCodexCodingEffectClaim({
        evidenceClass: "codex-coding-effect-accepted",
        evidenceKind,
        fullGateAccepted: true,
        host: "codex",
      });

      expect(result.claimable).toBe(false);
      expect(result.failures).toContain(
        "public coding-effect claims require executable host-native patch evidence",
      );
    }
  });

  it("rejects an accepted label whose full gate has not passed", () => {
    const result = evaluateCodexCodingEffectClaim({
      evidenceClass: "codex-coding-effect-accepted",
      evidenceKind: "host-native-patch",
      fullGateAccepted: false,
      host: "codex",
    });

    expect(result.claimable).toBe(false);
    expect(result.failures).toContain(
      "codex-coding-effect-accepted evidence requires an accepted full gate",
    );
  });
});
