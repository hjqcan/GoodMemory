import type { EvidenceLedgerEntry } from "../recall/evidenceLedger";
import type { ClaimProjection } from "../recall/projections/contracts";
import {
  createLanguageService,
  type LanguageService,
  type ResolvedLanguageContext,
} from "../language";

export type EvidenceLedgerFormat =
  | "prose"
  | "chronology"
  | "compact_json"
  | "json_locale_note";

interface RenderedClaim {
  modality: ClaimProjection["modality"];
  object: string;
  objectEntityId?: string;
  observedAt: string;
  polarity: ClaimProjection["polarity"];
  predicate: string;
  subject: string;
  validFrom?: string;
  validUntil?: string;
}

interface RenderedEvidenceLedgerEntry {
  actor?: string;
  claim?: RenderedClaim;
  evidenceId: string;
  excerpt: string;
  memoryId: string;
  relation: EvidenceLedgerEntry["relation"];
  status: EvidenceLedgerEntry["temporalStatus"];
}

function renderClaim(
  claim: NonNullable<EvidenceLedgerEntry["claim"]>,
): RenderedClaim {
  return {
    modality: claim.modality,
    object: claim.objectText,
    ...(claim.objectEntityId ? { objectEntityId: claim.objectEntityId } : {}),
    observedAt: claim.observedAt,
    polarity: claim.polarity,
    predicate: claim.predicateKey,
    subject: claim.subjectEntityId,
    ...(claim.validFrom ? { validFrom: claim.validFrom } : {}),
    ...(claim.validUntil ? { validUntil: claim.validUntil } : {}),
  };
}

function renderEntry(
  entry: EvidenceLedgerEntry,
): RenderedEvidenceLedgerEntry {
  return {
    evidenceId: entry.evidenceId,
    memoryId: entry.sourceMemoryId,
    status: entry.temporalStatus,
    relation: entry.relation,
    excerpt: entry.excerpt,
    ...(entry.actor ? { actor: entry.actor } : {}),
    ...(entry.claim ? { claim: renderClaim(entry.claim) } : {}),
  };
}

function renderProseEntry(
  entry: RenderedEvidenceLedgerEntry,
  language: LanguageService,
  context: ResolvedLanguageContext,
): string {
  return [
    language.render({
      key: "evidence_entry",
      values: {
        evidenceId: JSON.stringify(entry.evidenceId),
        memoryId: JSON.stringify(entry.memoryId),
      },
    }, context),
    `${language.render({ key: "temporal_status" }, context)}: ${entry.status}.`,
    `${language.render({ key: "relation_label" }, context)}: ${entry.relation}.`,
    entry.actor
      ? `${language.render({ key: "actor" }, context)}: ${JSON.stringify(entry.actor)}.`
      : undefined,
    entry.claim
      ? `${language.render({ key: "claim" }, context)}: ${JSON.stringify(entry.claim)}.`
      : undefined,
    `${language.render({ key: "excerpt" }, context)}: ${JSON.stringify(entry.excerpt)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function chronologicalEntries(
  entries: readonly EvidenceLedgerEntry[],
): EvidenceLedgerEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftTime = left.entry.claim?.validFrom ??
        left.entry.claim?.observedAt ??
        "\uffff";
      const rightTime = right.entry.claim?.validFrom ??
        right.entry.claim?.observedAt ??
        "\uffff";
      return leftTime.localeCompare(rightTime) ||
        left.entry.evidenceId.localeCompare(right.entry.evidenceId) ||
        left.entry.sourceMemoryId.localeCompare(right.entry.sourceMemoryId) ||
        left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function renderEvidenceLedgerContext(
  entries: readonly EvidenceLedgerEntry[],
  format: EvidenceLedgerFormat,
  locale = "en",
  language: LanguageService = createLanguageService(),
): string {
  const context = language.resolveFromText({ locale, text: "" });
  const ordered = format === "chronology"
    ? chronologicalEntries(entries)
    : entries;
  const rendered = ordered.map(renderEntry);

  if (format === "compact_json") {
    return JSON.stringify(rendered);
  }
  if (format === "json_locale_note") {
    return JSON.stringify({
      locale,
      note: language.render({ key: "evidence_note" }, context),
      evidence: rendered,
    });
  }
  return rendered
    .map((entry) => renderProseEntry(entry, language, context))
    .join("\n");
}
