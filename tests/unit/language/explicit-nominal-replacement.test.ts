import { describe, expect, it } from "bun:test";
import { createEnglishLanguagePack } from "../../../src";
const matches = createEnglishLanguagePack().matchesExplicitFactReplacement!;
const old = "Project decision: My novel uses first-person narration.";
const next = "Project decision: My novel now uses third-person narration instead of first-person narration.";
describe("source-exact nominal uses-relation replacement", () => {
  it.each([
    [old, next],
    ["Project decision: Our service uses weekly snapshots.", "Project decision: Our service now uses daily snapshots instead of weekly snapshots."],
    ["Repo policy: The renderer uses compact output.", "Repo policy: The renderer uses expanded output instead of compact output."],
    ["Project policy: This cluster uses encrypted backups.", "Project policy: This cluster now uses compressed backups instead of encrypted backups."],
    ["Project decision: My novel now uses first-person narration.", next],
    [next, "Project decision: My novel now uses second-person narration instead of third-person narration."],
  ])("proves the same authored subject, relation and explicit old value: %s", (before, after) => {
    expect(matches(before, after)).toBe(true);
  });
  it("retains the existing first-person correction grammar", () => {
    expect(matches("Project decision: We write Copper River in first-person narration.", "Project decision: We now write Copper River in third-person narration instead of first-person narration.")).toBe(true);
  });
  it.each([
    "Project decision: My novel now uses third-person narration.",
    "Project decision: Your novel now uses third-person narration instead of first-person narration.",
    "Project decision: My screenplay now uses third-person narration instead of first-person narration.",
    "Project decision: My novel now prefers third-person narration instead of first-person narration.",
    "Project decision: My novel might use third-person narration instead of first-person narration.",
    "Project decision: My novel never uses third-person narration instead of first-person narration.",
    "Project decision: My novel now uses third-person narration instead of second-person narration.",
    "Project decision: My novel now uses third-person narration instead of first-person scenes.",
    "Project decision: My novel now uses third-person narration instead of first-person narration instead of second-person narration.",
    "Project decision: My novel now uses third-person narration instead of first-person narration if the editor agrees.",
    "Project decision: My novel now uses third-person narration instead of first-person narration, according to the editor.",
    "Project decision: My novel now uses third-person narration instead of first-person narration?",
    "Project decision: The editor says my novel now uses third-person narration instead of first-person narration.",
    "Project decision: During the rehearsal, my novel used third-person narration instead of first-person narration.",
    "Project decision: \"My novel now uses third-person narration instead of first-person narration.\"",
    "Project decision: If approved, my novel now uses third-person narration instead of first-person narration.",
    "Project decision: My novel now uses first-person narration instead of first-person narration.",
    "Project decision: My novel now uses third-person prose instead of first-person narration.",
    "Repo policy: My novel now uses third-person narration instead of first-person narration.",
  ])("does not invent a matching target or direct current assertion: %s", after => expect(matches(old, after)).toBe(false));
  // The desired For-appendix correction remains an explicitly unsupported
  // coverage gap. Arbitrary For-context cannot establish currentness.
  it.each([
    ["Project decision: For the appendix, my novel uses first-person narration.", "Project decision: For the appendix, my novel now uses third-person narration instead of first-person narration."],
    ["Project decision: For chapter one, my novel uses first-person narration.", "Project decision: For chapter two, my novel now uses third-person narration instead of first-person narration."],
    ["Project decision: My novel previously used first-person narration.", next],
    ["Project decision: My novel uses first-person narration instead of third-person narration if the editor agrees.", next],
    ["Project decision: My novel uses first-person narration instead of third-person narration according to Nora.", next],
    ["Project decision: My novel uses first-person narration instead of third-person narration in the past.", next],
    ["Project decision: My novel uses first-person narration instead of third-person narration next year.", next],
    ["Project decision: A novel uses first-person narration.", "Project decision: A novel now uses third-person narration instead of first-person narration."],
    ["Project decision: It uses first-person narration.", "Project decision: It now uses third-person narration instead of first-person narration."],
    ["Project decision: My editor suggests first-person narration.", "Project decision: My editor now suggests third-person narration instead of first-person narration."],
    ["Project decision: My novel may use first-person narration.", next],
    ["Project decision: The draft says my novel uses first-person narration.", next],
  ])("fails closed for changed context or unsupported/reported predicates: %s", (before, after) => expect(matches(before, after)).toBe(false));
});
