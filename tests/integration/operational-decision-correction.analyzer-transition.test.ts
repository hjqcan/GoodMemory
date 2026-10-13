import { describe, expect, it } from "bun:test";
import { createEnglishLanguagePack, createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore, createLanguageService } from "../../src";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import { buildRecallProjectionBuildId } from "../../src/recall/projections/manifest";
import { PROJECTION_MANIFESTS_COLLECTION } from "../../src/recall/projections/contracts";
const oldVersion = "29-fact-observation-identity";
const newVersion = "30-nominal-uses-replacement";
const old = "Project decision: My novel uses first-person narration.";
const next = "Project decision: My novel now uses third-person narration instead of first-person narration.";
const scope = { userId: "nominal-version-public", workspaceId: "book" };
const now = () => new Date("2026-10-11T12:00:00Z");
function fixture() {
  const documentStore = createInMemoryDocumentStore();
  const make = (pack: ReturnType<typeof createEnglishLanguagePack>) => createGoodMemory({ storage: { provider: "memory" }, adapters: { documentStore, sessionStore: createInMemorySessionStore() }, language: { packs: [pack] }, testing: { now } });
  const priorPack = { ...createEnglishLanguagePack(), analyzerVersion: oldVersion, matchesExplicitFactReplacement: () => false };
  const write = (memory: ReturnType<typeof createGoodMemory>, content: string, id: string, day: number) => memory.remember({ scope, locale: "en", extractionStrategy: "rules-only", messages: [{ role: "user", id, content, observedAt: `2026-10-0${day}T00:00:00Z` }] });
  return { documentStore, make, priorPack, write };
}
describe("nominal correction analyzer-version boundary", () => {
  it("stamps the new semantic version while retaining historical source provenance", async () => {
    const f = fixture();
    await f.write(f.make(f.priorPack), old, "old", 1);
    const before = (await f.documentStore.query<any>("facts"))[0]!;
    expect(before.source.languagePackVersion).toBe(oldVersion);
    const currentPack = createEnglishLanguagePack();
    expect(currentPack.analyzerVersion).toBe(newVersion);
    const result = await f.write(f.make(currentPack), next, "next", 3);
    expect(result.accepted).toBe(1);
    const facts = await f.documentStore.query<any>("facts");
    expect(facts.find(x => x.id === before.id)).toMatchObject({ lifecycle: "superseded", source: { languagePackVersion: oldVersion } });
    expect(facts.find(x => x.content === next)).toMatchObject({ lifecycle: "active", source: { languagePackVersion: newVersion } });
    expect(await f.documentStore.query<any>("evidence")).toContainEqual(expect.objectContaining({ kind: "correction_context", source: expect.objectContaining({ languagePackVersion: newVersion }) }));
  });
  it("revalidates old author bytes with the current pack instead of trusting the old analyzer stamp", async () => {
    const f = fixture();
    await f.write(f.make(f.priorPack), old, "old", 1);
    const base = createEnglishLanguagePack();
    let oldSourceChecks = 0;
    const current = { ...base, extractCandidates: (input: Parameters<typeof base.extractCandidates>[0]) => {
        if (input.messages.some(m => m.content === old)) {
          oldSourceChecks++;
          return [];
        }
        return base.extractCandidates(input);
      } };
    const result = await f.write(f.make(current), next, "next", 3);
    expect(oldSourceChecks).toBeGreaterThan(0);
    expect(result.accepted).toBe(0);
    expect(result.events).toContainEqual(expect.objectContaining({ reason: "unverified_fact_correction_target", outcome: "rejected" }));
    expect((await f.documentStore.query<any>("facts")).map(x => [x.content, x.lifecycle])).toEqual([[old, "active"]]);
  });
  it("does not reuse a sealed projection proof from the old analyzer identity", async () => {
    const f = fixture();
    await f.write(f.make(f.priorPack), old, "old", 1);
    const original = (await f.documentStore.query<any>("facts"))[0]!;
    const oldLanguage = createLanguageService({ packs: [f.priorPack] });
    const oldBuildId = buildRecallProjectionBuildId(oldLanguage)!;
    const prior = createRecallProjectionRuntime({ documentStore: f.documentStore, language: oldLanguage, now: () => now().toISOString(), persistentScopeProof: { buildId: oldBuildId } });
    await prior.ensureScopeIndexed(scope);
    const language = createLanguageService({ packs: [createEnglishLanguagePack()] });
    const buildId = buildRecallProjectionBuildId(language)!;
    expect(buildId).not.toBe(oldBuildId);
    const current = createRecallProjectionRuntime({ documentStore: f.documentStore, language, now: () => now().toISOString(), persistentScopeProof: { buildId } });
    expect(await current.ensureScopeIndexed(scope)).toMatchObject({ complete: true, skipped: false });
    expect(await f.documentStore.query<any>(PROJECTION_MANIFESTS_COLLECTION)).toContainEqual(expect.objectContaining({ projectionBuildId: buildId }));
    const docs = await current.queryDocuments(scope);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every(d => d.searchAnalyzerVersion === newVersion)).toBe(true);
    expect(await f.documentStore.get("facts", original.id)).toEqual(original);
    const fresh = createRecallProjectionRuntime({ documentStore: f.documentStore, language, now: () => now().toISOString(), persistentScopeProof: { buildId } });
    expect(await fresh.ensureScopeIndexed(scope)).toMatchObject({ complete: true, skipped: true });
  });
});
