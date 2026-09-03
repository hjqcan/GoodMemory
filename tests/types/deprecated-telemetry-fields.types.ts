// v0.8 removes the retrieval-exposure telemetry fields that 0.7.3 froze and
// deprecated. Retrieval exposure is not reinforcement: nothing records or ranks
// access counts, and evidence quality flows through `evidenceScore` only.

// @ts-expect-error FactMemory.accessCount was removed in v0.8.
type FactAccessCount = import("../../src").FactMemory["accessCount"];

// @ts-expect-error FactMemory.lastAccessedAt was removed in v0.8.
type FactLastAccessedAt = import("../../src").FactMemory["lastAccessedAt"];

// @ts-expect-error FeedbackMemory.lastUsedAt was removed in v0.8.
type FeedbackLastUsedAt = import("../../src").FeedbackMemory["lastUsedAt"];

// @ts-expect-error RecallCandidateTrace.usageScore was removed in v0.8.
type TraceUsageScore = import("../../src").RecallCandidateTrace["usageScore"];

// @ts-expect-error RecallCandidateTrace.outcomeScore was removed in v0.8; use evidenceScore.
type TraceOutcomeScore = import("../../src").RecallCandidateTrace["outcomeScore"];

type Metrics = import("../../src/domain/evolutionRecords").ExperienceMetrics;

// @ts-expect-error ExperienceMetrics.touchedFactCount was removed in v0.8.
type MetricsTouchedFactCount = Metrics["touchedFactCount"];

// @ts-expect-error ExperienceMetrics.reinforcedFeedbackCount was removed in v0.8.
type MetricsReinforcedFeedbackCount = Metrics["reinforcedFeedbackCount"];

// The replacement stays: evidence support is the only quality signal on a trace.
type TraceEvidenceScore = import("../../src").RecallCandidateTrace["evidenceScore"];
const evidenceScore: TraceEvidenceScore = 0.5;
void evidenceScore;

export type {
  FactAccessCount,
  FactLastAccessedAt,
  FeedbackLastUsedAt,
  MetricsReinforcedFeedbackCount,
  MetricsTouchedFactCount,
  TraceOutcomeScore,
  TraceUsageScore,
};
