import { createGoodMemory, createInMemorySessionStore } from "../src";
import { createSQLiteDocumentStore } from "../src/storage/sqlite";
import { createGoodMemoryRuntimeKit } from "../src/runtime-kit";
import type { FactMemory } from "../src/domain/records";
import type { SourceMessageRecord } from "../src/evidence/contracts";
const [database, phase, fault] = process.argv.slice(2);
const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";
const scope = { userId: "crash-consistency-public", workspaceId: "public", agentId: "chat" };
const inner = createSQLiteDocumentStore(database!);
const store = { ...inner, async writeBatchIfUnchanged(batch: Parameters<typeof inner.writeBatchIfUnchanged>[0]) {
  const source = batch.set.some(item => item.collection === "source_messages_v1" && (item.document as SourceMessageRecord).content === next);
  const correction = batch.set.some(item => item.collection === "facts" && (item.document as FactMemory).lifecycle === "superseded");
  if (phase === "correction" && ((fault === "before-source-commit" && source) || (fault === "before-correction-commit" && correction))) process.exit(86);
  const result = await inner.writeBatchIfUnchanged(batch);
  if (phase === "correction" && result && ((fault === "after-source-commit" && source) || (fault === "after-correction-commit" && correction))) process.exit(86);
  return result;
} };
const memory = createGoodMemory({ storage: { provider: "sqlite", url: database! }, adapters: { documentStore: store, sessionStore: createInMemorySessionStore() } });
const kit = createGoodMemoryRuntimeKit({ memory });
if (phase === "read") {
  const durable = (await memory.exportMemory({ scope })).durable;
  const before = await kit.beforeModelCall({ scope: { ...scope, sessionId: "fresh" }, messages: [{ role: "user", content: "How do we deploy CedarApp?" }] });
  const sourceIds = new Set(durable.sourceMessages?.map(source => source.id));
  console.log(JSON.stringify({ facts: durable.facts, evidence: durable.evidence, sources: durable.sourceMessages, context: before.context.content,
    danglingCorrectionSources: durable.evidence.filter(item => item.kind === "correction_context").flatMap(item => (item.sourceRecordIds ?? []).filter(id => !sourceIds.has(id))),
  }));
} else {
  const content = phase === "old" ? old : next;
  console.log(JSON.stringify(await kit.afterModelCall({ scope: { ...scope, sessionId: phase! }, messages: [{ id: phase!, role: "user", content }], assistantText: "Okay.",
    writeback: { mode: "selective", annotation: "durable_candidate", policy: "allow" } })));
}
