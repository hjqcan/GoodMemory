import { createHash } from "node:crypto";
import type { GoodMemory } from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import type { MemoryScope } from "../domain/scope";
import { createLanguageService } from "../language";
import { computeBm25Scores } from "../recall/bm25";

// Structural mirror of LangGraph JS BaseStore (@langchain/langgraph-checkpoint
// store/base.ts): batch/get/put/delete/search/listNamespaces/start/stop with
// the Item/SearchItem/Operation shapes. No dependency on LangGraph — the shape
// is mirrored so this module adds zero packages; when a LangGraph API types
// against the abstract class nominally, cast (`as unknown as BaseStore`) — the
// runtime contract is what LangGraph's concrete methods exercise.
//
// Mapping: items live under the configured GoodMemory scope; the LangGraph
// namespace is a logical label carried in fact attributes, so get/put/delete
// round-trip exact values by key while search rides GoodMemory recall over the
// item's content field.

export interface GoodMemoryLangGraphItem {
  createdAt: Date;
  key: string;
  namespace: string[];
  updatedAt: Date;
  value: Record<string, unknown>;
}

export interface GoodMemoryLangGraphSearchItem extends GoodMemoryLangGraphItem {
  score?: number;
}

export interface GoodMemoryLangGraphGetOperation {
  key: string;
  namespace: string[];
  value?: undefined;
}

export interface GoodMemoryLangGraphPutOperation {
  index?: false | string[];
  key: string;
  namespace: string[];
  value: Record<string, unknown> | null;
}

export interface GoodMemoryLangGraphSearchOperation {
  filter?: Record<string, unknown>;
  limit?: number;
  namespacePrefix: string[];
  offset?: number;
  query?: string;
}

export interface GoodMemoryLangGraphListNamespacesOperation {
  limit: number;
  matchConditions?: Array<{
    matchType: "prefix" | "suffix";
    path: string[];
  }>;
  maxDepth?: number;
  offset: number;
}

export type GoodMemoryLangGraphOperation =
  | GoodMemoryLangGraphGetOperation
  | GoodMemoryLangGraphListNamespacesOperation
  | GoodMemoryLangGraphPutOperation
  | GoodMemoryLangGraphSearchOperation;

export interface GoodMemoryLangGraphStore {
  batch(operations: GoodMemoryLangGraphOperation[]): Promise<unknown[]>;
  delete(namespace: string[], key: string): Promise<void>;
  get(namespace: string[], key: string): Promise<GoodMemoryLangGraphItem | null>;
  listNamespaces(options?: {
    limit?: number;
    maxDepth?: number;
    offset?: number;
    prefix?: string[];
    suffix?: string[];
  }): Promise<string[][]>;
  put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
  ): Promise<void>;
  search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
      query?: string;
    },
  ): Promise<GoodMemoryLangGraphSearchItem[]>;
  start(): void;
  stop(): void;
}

// Unit separator (U+001F): cannot collide with printable namespace segments.
const NAMESPACE_SEPARATOR = "";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_NAMESPACE_LIMIT = 100;
const QUERY_FALLBACK_SCORE_FLOOR = 0.2;

interface StoredLangGraphFact {
  content: string;
  createdAt: string;
  id: string;
  indexed: boolean;
  key: string;
  namespace: string[];
  updatedAt: string;
  value: Record<string, unknown>;
  valueJson: string;
}

export function createGoodMemoryLangGraphStore(input: {
  memory: GoodMemory;
  scope: MemoryScope;
}): GoodMemoryLangGraphStore {
  const { memory, scope } = input;
  const language = readGoodMemoryIntegrationSupport(memory)?.language ??
    createLanguageService();

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function parseStoredValue(
    rawValue: unknown,
    fallbackContent: string,
  ): { value: Record<string, unknown>; valueJson: string } {
    if (typeof rawValue !== "string") {
      const value = { content: fallbackContent };
      return { value, valueJson: JSON.stringify(value) };
    }

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (isRecord(parsed)) {
        return { value: parsed, valueJson: rawValue };
      }
    } catch {
      // Fall back below: older/corrupt values should not break namespace scans.
    }

    const value = { content: fallbackContent };
    return { value, valueJson: JSON.stringify(value) };
  }

  function indexedContentOf(
    value: Record<string, unknown>,
    index: false | string[] | undefined,
  ): string {
    if (index === false) {
      return "";
    }

    if (Array.isArray(index) && index.length > 0) {
      const selected = index
        .map((field) => value[field])
        .filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0,
        );
      if (selected.length > 0) {
        return selected.join("\n");
      }
    }

    for (const field of ["content", "text", "memory"]) {
      const candidate = value[field];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
    return JSON.stringify(value);
  }

  function contentOf(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index: false | string[] | undefined,
  ): string {
    const indexedContent = indexedContentOf(value, index);
    if (indexedContent.length > 0) {
      return indexedContent;
    }

    const locator = createHash("sha256")
      .update(JSON.stringify({ key, namespace }))
      .digest("hex")
      .slice(0, 16);
    return `LangGraph store item ${locator} (not indexed)`;
  }

  async function listStoredFacts(): Promise<StoredLangGraphFact[]> {
    const exported = await memory.exportMemory({ scope });
    const stored: StoredLangGraphFact[] = [];
    for (const fact of exported.durable.facts) {
      const attributes = (fact as { attributes?: Record<string, unknown> })
        .attributes;
      const key = attributes?.langgraphKey;
      const namespace = attributes?.langgraphNamespace;
      const rawValue = attributes?.langgraphValue;
      if (typeof key !== "string" || typeof namespace !== "string") {
        continue;
      }
      const { value, valueJson } = parseStoredValue(rawValue, fact.content);
      stored.push({
        content: fact.content,
        createdAt: fact.createdAt,
        id: fact.id,
        indexed: attributes?.langgraphIndexed !== false,
        key,
        namespace: namespace.split(NAMESPACE_SEPARATOR),
        updatedAt: fact.updatedAt,
        value,
        valueJson,
      });
    }
    return stored;
  }

  function toItem(entry: StoredLangGraphFact): GoodMemoryLangGraphItem {
    return {
      createdAt: new Date(entry.createdAt),
      key: entry.key,
      namespace: entry.namespace,
      updatedAt: new Date(entry.updatedAt),
      value: entry.value,
    };
  }

  function underPrefix(namespace: string[], prefix: string[]): boolean {
    return (
      prefix.length <= namespace.length &&
      prefix.every((segment, index) => namespace[index] === segment)
    );
  }

  function matchesFilter(
    value: Record<string, unknown>,
    filter: Record<string, unknown> | undefined,
  ): boolean {
    if (!filter) {
      return true;
    }
    return Object.entries(filter).every(
      ([field, expected]) => value[field] === expected,
    );
  }

  async function listStoredByKey(
    namespace: string[],
    key: string,
  ): Promise<StoredLangGraphFact[]> {
    const joined = namespace.join(NAMESPACE_SEPARATOR);
    const stored = await listStoredFacts();
    return stored.filter(
      (entry) =>
        entry.key === key &&
        entry.namespace.join(NAMESPACE_SEPARATOR) === joined,
    );
  }

  async function findStored(
    namespace: string[],
    key: string,
  ): Promise<StoredLangGraphFact | null> {
    return (await listStoredByKey(namespace, key))[0] ?? null;
  }

  async function put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
  ): Promise<void> {
    const before = await listStoredByKey(namespace, key);
    const indexed = index !== false;
    const valueJson = JSON.stringify(value);
    const content = contentOf(namespace, key, value, index);
    const result = await memory.remember({
      annotations: [
        {
          kindHint: "fact",
          messageIndex: 0,
          metadataPatch: {
            attributes: {
              langgraphKey: key,
              langgraphIndexed: indexed,
              langgraphNamespace: namespace.join(NAMESPACE_SEPARATOR),
              langgraphValue: valueJson,
            },
            tags: ["langgraph_store"],
          },
          reason: "langgraph_store_put",
          remember: "always",
        },
      ],
      extractionStrategy: "rules-only",
      messages: [{ content, role: "user" }],
      scope,
    });
    if (result.accepted <= 0) {
      const reasons = result.events
        .map((event) => event.reason)
        .filter((reason): reason is string => typeof reason === "string");
      const detail = reasons.length > 0 ? `: ${reasons.join(", ")}` : ".";
      throw new Error(
        `GoodMemory LangGraph put was rejected${detail}`,
      );
    }

    const retainedMemoryIds = new Set(
      result.events
        .map((event) => event.memoryId)
        .filter((memoryId): memoryId is string => memoryId !== undefined),
    );
    for (const entry of before) {
      if (!retainedMemoryIds.has(entry.id)) {
        await memory.forget({ memoryId: entry.id, scope });
      }
    }

    const persisted = (await listStoredByKey(namespace, key)).find(
      (entry) => entry.valueJson === valueJson && entry.indexed === indexed,
    );
    if (!persisted) {
      throw new Error("GoodMemory LangGraph put did not persist a readable item.");
    }
  }

  async function deleteItem(namespace: string[], key: string): Promise<void> {
    const existing = await findStored(namespace, key);
    if (existing) {
      await memory.forget({ memoryId: existing.id, scope });
    }
  }

  async function get(
    namespace: string[],
    key: string,
  ): Promise<GoodMemoryLangGraphItem | null> {
    const existing = await findStored(namespace, key);
    return existing ? toItem(existing) : null;
  }

  async function search(
    namespacePrefix: string[],
    options: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
      query?: string;
    } = {},
  ): Promise<GoodMemoryLangGraphSearchItem[]> {
    const stored = await listStoredFacts();
    const inPrefix = stored.filter(
      (entry) =>
        underPrefix(entry.namespace, namespacePrefix) &&
        matchesFilter(entry.value, options.filter),
    );

    let ordered = inPrefix;
    if (options.query) {
      // Global GoodMemory recall cannot express a LangGraph namespace prefix.
      // Keep its in-prefix ordering, then recover prefix-local lexical matches
      // that global competition may have suppressed.
      const recall = await memory.recall({ query: options.query, scope });
      const byId = new Map(
        inPrefix
          .filter((entry) => entry.indexed)
          .map((entry) => [entry.id, entry]),
      );
      const recalled = recall.facts
        .map((fact) => byId.get(fact.id))
        .filter((entry): entry is StoredLangGraphFact => entry !== undefined);
      const recalledIds = new Set(recalled.map((entry) => entry.id));
      const queryLanguage = language.resolveFromText({ text: options.query });
      const fallbackScores = computeBm25Scores(
        options.query,
        [...byId.values()].map((entry) => ({
          id: entry.id,
          text: entry.content,
        })),
        {
          tokenize: (text) => language.tokenize(text, queryLanguage),
        },
      );
      const fallback = [...byId.values()]
        .filter(
          (entry) =>
            !recalledIds.has(entry.id) &&
            (fallbackScores.get(entry.id) ?? 0) >= QUERY_FALLBACK_SCORE_FLOOR,
        )
        .sort((left, right) => {
          const scoreDelta =
            (fallbackScores.get(right.id) ?? 0) -
            (fallbackScores.get(left.id) ?? 0);
          return scoreDelta || right.updatedAt.localeCompare(left.updatedAt) ||
            left.id.localeCompare(right.id);
        });
      ordered = [...recalled, ...fallback];
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    return ordered.slice(offset, offset + limit).map((entry) => toItem(entry));
  }

  async function listNamespaces(
    options: {
      limit?: number;
      maxDepth?: number;
      offset?: number;
      prefix?: string[];
      suffix?: string[];
    } = {},
  ): Promise<string[][]> {
    const stored = await listStoredFacts();
    const seen = new Set<string>();
    const namespaces: string[][] = [];
    for (const entry of stored) {
      let namespace = entry.namespace;
      if (options.prefix && !underPrefix(namespace, options.prefix)) {
        continue;
      }
      if (
        options.suffix &&
        !underPrefix(
          [...namespace].reverse(),
          [...options.suffix].reverse(),
        )
      ) {
        continue;
      }
      if (options.maxDepth !== undefined) {
        namespace = namespace.slice(0, options.maxDepth);
      }
      const joined = namespace.join(NAMESPACE_SEPARATOR);
      if (!seen.has(joined)) {
        seen.add(joined);
        namespaces.push(namespace);
      }
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? DEFAULT_NAMESPACE_LIMIT;
    return namespaces.slice(offset, offset + limit);
  }

  async function batch(
    operations: GoodMemoryLangGraphOperation[],
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const operation of operations) {
      if ("namespacePrefix" in operation) {
        results.push(
          await search(operation.namespacePrefix, {
            filter: operation.filter,
            limit: operation.limit,
            offset: operation.offset,
            query: operation.query,
          }),
        );
        continue;
      }
      if ("key" in operation && "namespace" in operation) {
        if ("value" in operation && operation.value !== undefined) {
          if (operation.value === null) {
            await deleteItem(operation.namespace, operation.key);
          } else {
            await put(
              operation.namespace,
              operation.key,
              operation.value,
              operation.index,
            );
          }
          results.push(undefined);
        } else {
          results.push(await get(operation.namespace, operation.key));
        }
        continue;
      }
      const matchConditions =
        "matchConditions" in operation ? operation.matchConditions : undefined;
      results.push(
        await listNamespaces({
          limit: operation.limit,
          maxDepth: "maxDepth" in operation ? operation.maxDepth : undefined,
          offset: operation.offset,
          prefix: matchConditions?.find(
            (condition) => condition.matchType === "prefix",
          )?.path,
          suffix: matchConditions?.find(
            (condition) => condition.matchType === "suffix",
          )?.path,
        }),
      );
    }
    return results;
  }

  return {
    batch,
    delete: deleteItem,
    get,
    listNamespaces,
    put,
    search,
    start() {},
    stop() {},
  };
}
