// Deterministic current-value / conflict resolution.
//
// Retrieving facts that changed over time (e.g. "uses React" then "uses Vue")
// leaves the *current* value ambiguous unless something picks the latest. The
// strongest reproducible evidence in the agent-memory literature (arXiv
// 2606.01435, "Don't Ask the LLM to Track Freshness") is that the winning recipe
// for memory conflict resolution is NOT a bi-temporal knowledge graph and NOT an
// LLM asked to track freshness, but **structured candidate extraction followed
// by deterministic aggregation** (pick the latest by serial/timestamp). On the
// only deterministic, hard-to-game competency (MemoryAgentBench FactConsolidation)
// that embedding-free recipe beats every published graph/vector system.
//
// This module is the deterministic-aggregation primitive. It is pure (no LLM, no
// embedding, no I/O), so its behaviour is fully unit-tested rather than judged.
// It complements, and is distinct from, two existing mechanisms:
//   - storage-level supersession (`FactMemory.supersededBy` / `lifecycle`),
//     which records a decided supersession at write time, and
//   - eval-only protocol framing (`src/eval/protocol-reader`), which may ask a
//     benchmark reader to resolve the current value in prose.
// `resolveCurrentValue` resolves the current value deterministically over a set
// of already-grouped candidate entries about one fact, with no model in the loop.

/**
 * A single candidate entry about ONE fact/attribute, as retrieved. Group your
 * candidates by subject/attribute before calling {@link resolveCurrentValue}
 * (or use {@link resolveCurrentValuesByGroup} to group and resolve at once).
 *
 * Entries are compared by `orderKey` (source order; a higher value is later),
 * with an optional `timeAnchor` timestamp as a deterministic tie-break.
 */
export interface CurrentValueEntry {
  content: string;
  /** LanguagePack-derived polarity. The answer domain never parses language. */
  polarity: "negative" | "positive" | "unknown";
  /** Source order. Higher = later. May be a chat index, chunk ordinal, or write sequence. */
  orderKey: number;
  /** Optional ISO timestamp (or any parseable/comparable string) used only to break `orderKey` ties. */
  timeAnchor?: string;
  /** Optional identifier carried through to the resolution for citation. */
  sourceId?: number | string;
}

export type CurrentValueReason = "empty" | "single" | "update" | "contradiction";

export interface CurrentValueResolution {
  /** The latest supported value: the entry with the greatest (orderKey, timeAnchor). `null` only when there are no entries. */
  current: CurrentValueEntry | null;
  /** Entries the current value supersedes, in source order (earliest first). */
  history: CurrentValueEntry[];
  /**
   * Conservative, deterministic signal that the entries should NOT be silently
   * collapsed into a simple update: true when the latest entry is a
   * denial/negation while an earlier entry is a (non-denial) affirmative — i.e.
   * the most recent statement retracts rather than replaces. Callers should
   * surface both sides / ask for clarification rather than report the negation
   * as the value. A clean replacement (e.g. "uses React" -> "uses Vue", where
   * the latest entry is affirmative) is NOT flagged.
   */
  contradiction: boolean;
  reason: CurrentValueReason;
}

function compareTimeAnchors(left?: string, right?: string): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  const leftValid = !Number.isNaN(leftTime);
  const rightValid = !Number.isNaN(rightTime);
  if (leftValid && rightValid) {
    return leftTime - rightTime;
  }
  if (leftValid !== rightValid) {
    // A parseable timestamp orders after an unparseable tag, so a real date wins.
    return leftValid ? 1 : -1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Deterministically resolve the current value of one fact from its candidate
 * entries. Pure: same input always yields the same output, with no LLM or
 * embedding involved. Ordering is by `orderKey`, then `timeAnchor`, then a
 * stable fall-back to input order, so ties never resolve randomly.
 */
export function resolveCurrentValue(
  entries: readonly CurrentValueEntry[],
): CurrentValueResolution {
  if (entries.length === 0) {
    return { current: null, history: [], contradiction: false, reason: "empty" };
  }
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.orderKey !== right.entry.orderKey) {
        return left.entry.orderKey - right.entry.orderKey;
      }
      const byTime = compareTimeAnchors(left.entry.timeAnchor, right.entry.timeAnchor);
      if (byTime !== 0) {
        return byTime;
      }
      return left.index - right.index;
    })
    .map((wrapped) => wrapped.entry);

  const current = ordered[ordered.length - 1];
  const history = ordered.slice(0, -1);

  if (ordered.length === 1) {
    return { current, history, contradiction: false, reason: "single" };
  }

  const contradiction =
    current.polarity === "negative" &&
    history.some(
      (entry) =>
        entry.polarity === "positive" && entry.content.trim().length > 0,
    );

  return {
    current,
    history,
    contradiction,
    reason: contradiction ? "contradiction" : "update",
  };
}

/**
 * Group mixed candidate entries by a caller-supplied key (e.g. fact subject or
 * normalized attribute) and resolve the current value within each group. This
 * is the "structured candidate extraction -> deterministic aggregation" shape:
 * the caller extracts candidates and assigns a grouping key; this function does
 * the deterministic per-group aggregation. Group order follows first appearance
 * in `entries`, so the result is deterministic.
 */
export function resolveCurrentValuesByGroup<TEntry extends CurrentValueEntry>(
  entries: readonly TEntry[],
  keyOf: (entry: TEntry) => string,
): Map<string, CurrentValueResolution> {
  const groups = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  const resolved = new Map<string, CurrentValueResolution>();
  for (const [key, bucket] of groups) {
    resolved.set(key, resolveCurrentValue(bucket));
  }
  return resolved;
}
