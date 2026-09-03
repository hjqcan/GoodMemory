import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { createMemorySource } from "../domain/provenance";
import {
  createNoteMemory,
  isNoteBodyWithinLimit,
  NOTE_MAX_BYTES,
} from "../domain/records";
import type {
  EpisodeMemory,
  FactMemory,
  NoteMemory,
  ReferenceMemory,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../domain/evolutionRecords";
import type { EmbeddingAdapter } from "../embedding/contracts";
import {
  buildEpisodeEmbeddingWrite,
  buildFactEmbeddingWrite,
  buildNoteEmbeddingWrite,
  buildReferenceEmbeddingWrite,
  prepareMemoryEmbeddingWrites,
  upsertPreparedMemoryEmbeddings,
} from "../embedding/vectorWrites";
import type { MemoryEmbeddingWrite } from "../embedding/vectorWrites";
import {
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
} from "../evidence/contracts";
import {
  computePagesSha256,
  derivePageNoteId,
  normalizePageTitle,
  parsePageFile,
  splitPage,
} from "../interchange/pages";
import type { PageChunk, ParsedPage } from "../interchange/pages";
import { describeInvalidDurable } from "../interchange/durableEnvelope";
import type { LanguageService } from "../language";
import type { GoodMemoryPolicyHooks, PolicyContext } from "../policy/hooks";
import type { DocumentStore } from "../storage/contracts";
import type { RememberVectorPort } from "../storage/ports";
import type {
  ExportMemoryResult,
  ImportMemoryInput,
  ImportMemoryPageResult,
  ImportMemoryResult,
} from "./contracts";
import { recordMatchesScope } from "./memoryAdminOps";

export interface ImportMemoryDeps {
  documentStore: DocumentStore;
  embedding?: EmbeddingAdapter;
  language: LanguageService;
  now: () => Date;
  policy?: Pick<GoodMemoryPolicyHooks, "shouldRemember">;
  vectorIndex?: RememberVectorPort | null;
}

type Counts = ImportMemoryResult["counts"];
type Undo = () => Promise<void>;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function emptyCounts(): Counts {
  return { conflicts: 0, imported: 0, rejected: 0, split: 0, superseded: 0, unchanged: 0 };
}

export { computePagesSha256 } from "../interchange/pages";

export function computeDurableSha256(durable: ExportMemoryResult["durable"]): string {
  return sha256(JSON.stringify(durable));
}

function parseableTimestamp(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

// Best effort, newest first; the caller rethrows the original failure.
async function rollback(undo: Undo[]): Promise<void> {
  for (const step of undo.reverse()) {
    try {
      await step();
    } catch {
      // The original error is what the caller reports.
    }
  }
}

async function shouldRememberPage(
  deps: ImportMemoryDeps,
  scope: MemoryScope,
  chunk: PageChunk,
): Promise<boolean> {
  if (!deps.policy?.shouldRemember) {
    return true;
  }
  const resolved = deps.language.resolveFromText({ text: chunk.body });
  const context: PolicyContext = {
    locale: resolved.locale,
    localeSource: resolved.localeSource,
    phase: "remember",
    scope,
  };
  return deps.policy.shouldRemember(
    {
      content: chunk.body,
      explicitness: "explicit",
      id: `import-${sha256(chunk.body).slice(0, 16)}`,
      kindHint: "note",
      metadata: { noteTitle: chunk.title },
      sourceMessageIndex: 0,
      sourceRole: "user",
    },
    context,
  );
}

async function writeEmbeddings(
  deps: ImportMemoryDeps,
  writes: MemoryEmbeddingWrite[],
): Promise<void> {
  if (!deps.embedding || !deps.vectorIndex || writes.length === 0) {
    return;
  }
  await upsertPreparedMemoryEmbeddings(
    await prepareMemoryEmbeddingWrites(writes, deps.embedding),
    deps.vectorIndex,
  );
}

function rejectedPage(
  path: string,
  contentSha256: string,
  reason: NonNullable<ImportMemoryPageResult["reason"]>,
  title?: string,
): ImportMemoryPageResult {
  return { contentSha256, outcome: "rejected", path, reason, ...(title ? { title } : {}) };
}

async function importPages(
  deps: ImportMemoryDeps,
  input: ImportMemoryInput & { source: { kind: "pages" } },
  inputSha256: string,
): Promise<ImportMemoryResult> {
  const counts = emptyCounts();
  const pages: ImportMemoryPageResult[] = [];
  const dryRun = input.dryRun === true;
  const timestamp = deps.now().toISOString();
  const existingNotes = (
    await deps.documentStore.query<NoteMemory>("notes", { userId: input.scope.userId })
  ).filter((note) => recordMatchesScope(note, input.scope));
  const notesById = new Map(existingNotes.map((note) => [note.id, note] as const));
  const activeByTitle = new Map<string, NoteMemory>();
  for (const note of existingNotes) {
    if (note.lifecycle === "active") {
      activeByTitle.set(normalizePageTitle(note.title), note);
    }
  }
  const pendingEmbeddings: MemoryEmbeddingWrite[] = [];
  // Superseded notes lose their vectors only after every record and every
  // new embedding landed; until then a failure can still be rolled back.
  const retiredVectorIds: string[] = [];
  const undo: Undo[] = [];

  const importChunk = async (
    page: ParsedPage,
    chunk: PageChunk,
    identity: { title: string; uuid?: string },
    splitInfo?: { index: number; total: number },
  ): Promise<{ memoryId: string; outcome: "imported" | "superseded" | "unchanged"; supersededMemoryId?: string }> => {
    const headId = derivePageNoteId(input.scope, identity);
    const memoryId = `${headId}_${sha256(chunk.body).slice(0, 8)}`;
    if (notesById.has(memoryId)) {
      return { memoryId, outcome: "unchanged" };
    }
    const previous = activeByTitle.get(normalizePageTitle(chunk.title));
    if (previous && previous.body.trimEnd() === chunk.body.trimEnd()) {
      // Same title and body under a different id (for example a page exported
      // from a note the host wrote itself): nothing to change.
      return { memoryId: previous.id, outcome: "unchanged" };
    }
    const resolved = deps.language.resolveFromText({
      ...(input.locale ? { locale: input.locale } : {}),
      text: chunk.body,
    });
    const note = createNoteMemory({
      id: memoryId,
      userId: input.scope.userId,
      tenantId: input.scope.tenantId,
      workspaceId: input.scope.workspaceId,
      agentId: input.scope.agentId,
      sessionId: input.scope.sessionId,
      title: chunk.title,
      body: chunk.body,
      format: "markdown",
      source: createMemorySource({
        method: "import",
        extractedAt: timestamp,
        locale: resolved.locale,
        localeSource: resolved.localeSource,
        languagePackId: resolved.languagePackId,
        languagePackVersion: resolved.languagePackVersion,
      }),
      tags: page.frontmatter.tags,
      attributes: {
        path: page.path,
        ...(page.frontmatter.summary ? { summary: page.frontmatter.summary } : {}),
        ...(page.frontmatter.uuid ? { uuid: page.frontmatter.uuid } : {}),
        ...(splitInfo ? { splitIndex: splitInfo.index, splitOf: headId, splitTotal: splitInfo.total } : {}),
      },
      observedAt: parseableTimestamp(page.frontmatter.updated) ??
        parseableTimestamp(page.frontmatter.created),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (!dryRun) {
      if (previous) {
        undo.push(() => deps.documentStore.set("notes", previous.id, previous));
        await deps.documentStore.set("notes", previous.id, createNoteMemory({
          ...previous,
          lifecycle: "superseded",
          supersededBy: note.id,
          updatedAt: timestamp,
        }));
        retiredVectorIds.push(previous.id);
      }
      undo.push(async () => {
        await deps.documentStore.delete("notes", note.id);
        await deps.vectorIndex?.deleteNoteEmbedding(note.id);
      });
      await deps.documentStore.set("notes", note.id, note);
      pendingEmbeddings.push(buildNoteEmbeddingWrite(note));
    }
    notesById.set(note.id, note);
    activeByTitle.set(normalizePageTitle(note.title), note);
    return previous
      ? { memoryId: note.id, outcome: "superseded", supersededMemoryId: previous.id }
      : { memoryId: note.id, outcome: "imported" };
  };

  const importPage = async (rawPage: { path: string; content: string }): Promise<void> => {
    const contentSha256 = sha256(rawPage.content);
    const parsed = parsePageFile(rawPage);
    if (!parsed.ok) {
      counts.rejected += 1;
      pages.push(rejectedPage(rawPage.path, contentSha256, parsed.reason));
      return;
    }
    const page = parsed.page;
    const whole: PageChunk = { body: page.body, title: page.title };
    // The cap is checked on what would actually be written: the whole page,
    // or every chunk the splitter produced (never assumed to fit).
    const chunks = isNoteBodyWithinLimit(page.body)
      ? [whole]
      : input.oversize === "split"
        ? splitPage(whole, NOTE_MAX_BYTES)
        : null;
    if (!chunks || !chunks.every((chunk) => isNoteBodyWithinLimit(chunk.body))) {
      counts.rejected += 1;
      pages.push(rejectedPage(page.path, contentSha256, "note_too_large", page.title));
      return;
    }
    if (!(await shouldRememberPage(deps, input.scope, whole))) {
      counts.rejected += 1;
      pages.push(rejectedPage(page.path, contentSha256, "policy_should_remember_blocked", page.title));
      return;
    }
    if (chunks.length > 1) {
      const memoryIds: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const written = await importChunk(
          page,
          chunk,
          {
            title: chunk.title,
            ...(page.frontmatter.uuid ? { uuid: `${page.frontmatter.uuid}#${index}` } : {}),
          },
          { index, total: chunks.length },
        );
        memoryIds.push(written.memoryId);
      }
      counts.split += 1;
      pages.push({ contentSha256, memoryIds, outcome: "split", path: page.path, title: page.title });
      return;
    }
    const written = await importChunk(page, whole, {
      title: page.title,
      ...(page.frontmatter.uuid ? { uuid: page.frontmatter.uuid } : {}),
    });
    counts[written.outcome] += 1;
    pages.push({
      contentSha256,
      memoryId: written.memoryId,
      outcome: written.outcome,
      path: page.path,
      ...(written.supersededMemoryId ? { supersededMemoryId: written.supersededMemoryId } : {}),
      title: page.title,
    });
  };

  try {
    for (const rawPage of input.source.pages) {
      await importPage(rawPage);
    }
    if (!dryRun) {
      await writeEmbeddings(deps, pendingEmbeddings);
      for (const id of retiredVectorIds) {
        await deps.vectorIndex?.deleteNoteEmbedding(id);
      }
    }
  } catch (error) {
    await rollback(undo);
    throw error;
  }
  return {
    counts,
    inputSha256,
    outcome: dryRun ? "dry_run" : "imported",
    pages,
  };
}

interface DurableCollectionEntry {
  collection: string;
  embed?: (record: never) => MemoryEmbeddingWrite;
  records: ReadonlyArray<{ id: string; userId: string }>;
  unembed?: (index: RememberVectorPort, id: string) => Promise<void>;
}

async function importDurable(
  deps: ImportMemoryDeps,
  input: ImportMemoryInput & { source: { kind: "durable" } },
  inputSha256: string,
): Promise<ImportMemoryResult> {
  const durable = input.source.durable;
  const counts = emptyCounts();
  const dryRun = input.dryRun === true;
  const entries: DurableCollectionEntry[] = [
    { collection: "preferences", records: durable.preferences },
    {
      collection: "references",
      embed: (record) => buildReferenceEmbeddingWrite(record as ReferenceMemory),
      records: durable.references,
      unembed: (index, id) => index.deleteReferenceEmbedding(id),
    },
    {
      collection: "notes",
      embed: (record) => buildNoteEmbeddingWrite(record as NoteMemory),
      records: durable.notes ?? [],
      unembed: (index, id) => index.deleteNoteEmbedding(id),
    },
    {
      collection: "facts",
      embed: (record) => buildFactEmbeddingWrite(record as FactMemory),
      records: durable.facts,
      unembed: (index, id) => index.deleteFactEmbedding(id),
    },
    { collection: "feedback", records: durable.feedback },
    {
      collection: "episodes",
      embed: (record) => buildEpisodeEmbeddingWrite(record as EpisodeMemory),
      records: durable.episodes,
      unembed: (index, id) => index.deleteEpisodeEmbedding(id),
    },
    { collection: SESSION_ARCHIVES_COLLECTION, records: durable.archives },
    { collection: EVIDENCE_COLLECTION, records: durable.evidence },
    { collection: SOURCE_MESSAGES_COLLECTION, records: durable.sourceMessages ?? [] },
    { collection: EXPERIENCES_COLLECTION, records: durable.experiences },
    { collection: LEARNING_PROPOSALS_COLLECTION, records: durable.proposals },
    { collection: PROMOTION_RECORDS_COLLECTION, records: durable.promotions },
  ];
  const scoped = entries.every(({ records }) =>
    records.every((record) => recordMatchesScope(record, input.scope))
  ) && (durable.profile === null || durable.profile.userId === input.scope.userId);
  if (!scoped) {
    return {
      counts,
      inputSha256,
      outcome: "rejected",
      pages: [],
      reason: "scope_mismatch",
    };
  }
  const pendingEmbeddings: MemoryEmbeddingWrite[] = [];
  const undo: Undo[] = [];
  const importRecord = async (
    collection: string,
    id: string,
    record: object,
    entry?: Pick<DurableCollectionEntry, "embed" | "unembed">,
  ): Promise<void> => {
    const existing = await deps.documentStore.get<object>(collection, id);
    if (existing) {
      if (isDeepStrictEqual(existing, record)) {
        counts.unchanged += 1;
      } else {
        counts.conflicts += 1;
      }
      return;
    }
    if (!dryRun) {
      undo.push(async () => {
        await deps.documentStore.delete(collection, id);
        if (entry?.unembed && deps.vectorIndex) {
          await entry.unembed(deps.vectorIndex, id);
        }
      });
      await deps.documentStore.set(collection, id, record);
      if (entry?.embed) {
        pendingEmbeddings.push(entry.embed(record as never));
      }
    }
    counts.imported += 1;
  };
  try {
    if (durable.profile) {
      await importRecord("profiles", durable.profile.userId, durable.profile);
    }
    for (const entry of entries) {
      for (const record of entry.records) {
        await importRecord(entry.collection, record.id, record, entry);
      }
    }
    if (!dryRun) {
      await writeEmbeddings(deps, pendingEmbeddings);
    }
  } catch (error) {
    await rollback(undo);
    throw error;
  }
  return {
    counts,
    inputSha256,
    outcome: dryRun ? "dry_run" : "imported",
    pages: [],
  };
}

export async function importMemoryOperation(
  deps: ImportMemoryDeps,
  input: ImportMemoryInput,
): Promise<ImportMemoryResult> {
  assertStorageSafeExternalValue(input.scope, "scope");
  if (input.source.kind === "durable") {
    const problem = describeInvalidDurable(input.source.durable);
    if (problem) {
      throw new Error(`invalid_durable: ${problem}`);
    }
  }
  // Fail closed before any write: text the canonical store cannot hold (NUL
  // bytes, lone surrogates) is refused for the whole input.
  assertStorageSafeExternalValue(input.source, "source");
  const inputSha256 = input.source.kind === "pages"
    ? computePagesSha256(input.source.pages)
    : computeDurableSha256(input.source.durable);
  if (input.expectedSha256 !== undefined && input.expectedSha256.toLowerCase() !== inputSha256) {
    throw new Error(
      `import_hash_mismatch: expected ${input.expectedSha256} but the input hashes to ${inputSha256}`,
    );
  }
  return input.source.kind === "pages"
    ? importPages(deps, input as ImportMemoryInput & { source: { kind: "pages" } }, inputSha256)
    : importDurable(deps, input as ImportMemoryInput & { source: { kind: "durable" } }, inputSha256);
}
