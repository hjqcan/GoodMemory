import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createGoodMemory,
  rememberRules,
  type GoodMemory,
  type MemoryExtractionStrategy,
  type MemoryScope,
} from "../src";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase36EvalOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase36EvalDependencies {
  ensureDir?: (
    path: string,
    options?: {
      recursive?: boolean;
    },
  ) => Promise<void>;
  now?: () => string;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase36CaseResult {
  assertions: Array<{
    label: string;
    passed: boolean;
  }>;
  caseId:
    | "life-coach-domain-rules"
    | "assistant-confirmed-policy"
    | "never-annotation-masking"
    | "custom-assisted-composition"
    | "profile-preset-trace-completeness"
    | "domain-metadata-export";
  focus:
    | "rules_dsl"
    | "assistant_policy"
    | "annotation_privacy"
    | "extractor_composition"
    | "trace_completeness"
    | "metadata_audit";
  extractorIds: string[];
  passed: boolean;
}

export interface Phase36EvalReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  cases: Phase36CaseResult[];
  generatedAt: string;
  generatedBy: "scripts/run-phase-36-eval.ts";
  mode: "fallback";
  outputDir: string;
  phase: "phase-36";
  runDirectory: string;
  runId: string;
  summary: {
    acceptedCaseCount: number;
    annotationPolicyPassCount: number;
    domainMetadataPassCount: number;
    extractorCompositionPassCount: number;
    rulesDslPassCount: number;
    traceCompletenessPassCount: number;
    totalCases: number;
  };
}

const GENERATED_BY = "scripts/run-phase-36-eval.ts";
const PHASE36_RULES_ONLY_ENV_KEYS = [
  "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_RECALL_ROUTER_API_KEY",
  "GOODMEMORY_RECALL_ROUTER_BASE_URL",
  "GOODMEMORY_RECALL_ROUTER_MODEL",
  "GOODMEMORY_RECALL_ROUTER_PROVIDER",
  "GOODMEMORY_STORAGE_PROVIDER",
  "GOODMEMORY_STORAGE_URL",
  "GOODMEMORY_TEST_POSTGRES_URL",
] as const;

export function resolvePhase36FallbackOutputDir(root: string): string {
  return join(root, "reports/eval/fallback/phase-36");
}

export function buildPhase36FallbackRunId(timestamp: string): string {
  return `run-${timestamp.replace(/\D/g, "").slice(0, 14) || "phase36"}`;
}

export function parsePhase36EvalCliOptions(
  argv: readonly string[],
): Phase36EvalOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

async function withPhase36RulesOnlyEnv<T>(
  execute: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();

  for (const key of PHASE36_RULES_ONLY_ENV_KEYS) {
    previousValues.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return await execute();
  } finally {
    for (const key of PHASE36_RULES_ONLY_ENV_KEYS) {
      const previous = previousValues.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

function assertCase(
  caseId: Phase36CaseResult["caseId"],
  focus: Phase36CaseResult["focus"],
  assertions: Phase36CaseResult["assertions"],
  evidence: { extractorIds?: string[] } = {},
): Phase36CaseResult {
  return {
    assertions,
    caseId,
    extractorIds: evidence.extractorIds ?? [],
    focus,
    passed: assertions.every((assertion) => assertion.passed),
  };
}

function collectExtractorIds(
  memory: Awaited<ReturnType<GoodMemory["remember"]>>,
): string[] {
  const extractorIds = new Set<string>();

  for (const event of memory.events) {
    for (const extractorId of event.extractorIds ?? []) {
      extractorIds.add(extractorId);
    }
  }

  return [...extractorIds];
}

function hasWrittenEvent(
  memory: Awaited<ReturnType<GoodMemory["remember"]>>,
  input: {
    extractorId?: string;
    extractionSources?: MemoryExtractionStrategy[];
    profileId?: string;
    ruleId?: string;
  },
): boolean {
  return memory.events.some(
    (event) =>
      event.outcome === "written" &&
      (!input.extractorId || event.extractorIds?.includes(input.extractorId)) &&
      (!input.profileId || event.profileId === input.profileId) &&
      (!input.ruleId || event.ruleIds?.includes(input.ruleId)) &&
      (!input.extractionSources ||
        input.extractionSources.every((source) =>
          event.extractionSources?.includes(source),
        )),
  );
}

function createLifeCoachMemory(): GoodMemory {
  return createGoodMemory({
    storage: { provider: "memory" },
    remember: {
      profiles: [
        {
          id: "life-coach",
          when: { agentId: "life-coach" },
          rules: [
            rememberRules.fact(/my top priority this quarter is (.+)/i, {
              id: "life-goal-priority",
              category: "goal",
              tags: ["life_coach", "long_term_goal"],
              attributes: { horizon: "quarter" },
              content: ({ match }) => match[1] ?? "",
            }),
            rememberRules.preference(/please (?:always )?coach me with (.+)/i, {
              id: "life-coaching-style",
              category: "coaching_style",
              value: ({ match }) => match[1] ?? "",
              tags: ["life_coach", "coaching_style"],
              attributes: { source: "phase36_eval" },
            }),
          ],
        },
      ],
    },
  });
}

async function runLifeCoachDomainRulesCase(): Promise<Phase36CaseResult> {
  const memory = createLifeCoachMemory();
  const scope = { agentId: "life-coach", userId: "phase36-user" };
  const result = await memory.remember({
    extractionStrategy: "rules-only",
    messages: [
      {
        content: "My top priority this quarter is rebuilding my sleep routine.",
        role: "user",
      },
      {
        content: "Please always coach me with concise weekly planning prompts.",
        role: "user",
      },
    ],
    scope,
  });
  const exported = await memory.exportMemory({ scope });

  return assertCase("life-coach-domain-rules", "rules_dsl", [
    {
      label: "profile-rule-trace",
      passed: hasWrittenEvent(result, {
        profileId: "life-coach",
        ruleId: "life-goal-priority",
      }),
    },
    {
      label: "goal-fact",
      passed:
        exported.durable.facts[0]?.category === "goal" &&
        exported.durable.facts[0]?.tags?.includes("life_coach") === true,
    },
    {
      label: "preference-metadata",
      passed:
        exported.durable.preferences[0]?.category === "coaching_style" &&
        exported.durable.preferences[0]?.attributes?.source === "phase36_eval",
    },
  ]);
}

async function runAssistantConfirmedPolicyCase(): Promise<Phase36CaseResult> {
  const scope = { agentId: "life-coach", userId: "phase36-user" };
  const blockedMemory = createGoodMemory({ storage: { provider: "memory" } });
  const blocked = await blockedMemory.remember({
    annotations: [
      {
        confirmed: true,
        kindHint: "fact",
        messageIndex: 0,
        metadataPatch: { category: "habit" },
        remember: "always",
      },
    ],
    messages: [{ content: "A weekly review cadence may help.", role: "assistant" }],
    scope,
  });
  const allowedMemory = createGoodMemory({
    storage: { provider: "memory" },
    remember: {
      profiles: [
        {
          assistantOutputs: { mode: "confirmed_or_verified_only" },
          id: "life-coach",
          when: { agentId: "life-coach" },
        },
      ],
    },
  });
  const allowed = await allowedMemory.remember({
    annotations: [
      {
        confirmed: true,
        kindHint: "fact",
        messageIndex: 0,
        metadataPatch: { category: "habit", tags: ["weekly_review"] },
        remember: "always",
      },
    ],
    messages: [{ content: "A weekly review cadence may help.", role: "assistant" }],
    scope,
  });

  return assertCase("assistant-confirmed-policy", "assistant_policy", [
    {
      label: "default-blocks-assistant",
      passed: blocked.accepted === 0 &&
        blocked.events.some((event) => event.reason === "assistant_policy_blocked"),
    },
    {
      label: "confirmed-policy-allows",
      passed: allowed.accepted === 1 &&
        allowed.events.some((event) => event.annotation?.confirmed === true),
    },
  ]);
}

async function runNeverAnnotationMaskingCase(): Promise<Phase36CaseResult> {
  const assistedInputs: string[] = [];
  const scope = { agentId: "life-coach", userId: "phase36-user" };
  const memory = createGoodMemory({
    adapters: {
      assistedExtractor: {
        async extract(input) {
          assistedInputs.push(input.messages[0]?.content ?? "");

          return {
            candidates: [
              {
                content: "Private goal should not persist.",
                explicitness: "explicit",
                id: "assisted-private-goal",
                kindHint: "fact",
                metadata: { category: "goal" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    },
    storage: { provider: "memory" },
  });
  const result = await memory.remember({
    annotations: [
      {
        messageIndex: 0,
        reason: "privacy",
        remember: "never",
      },
    ],
    extractionStrategy: "llm-assisted",
    messages: [{ content: "Private goal: do not retain this.", role: "user" }],
    scope,
  });
  const exported = await memory.exportMemory({ scope });

  return assertCase("never-annotation-masking", "annotation_privacy", [
    {
      label: "assisted-extractor-not-invoked",
      passed: assistedInputs.length === 0,
    },
    {
      label: "no-durable-write",
      passed: result.accepted === 0 && exported.durable.facts.length === 0,
    },
  ]);
}

async function runCustomAssistedCompositionCase(): Promise<Phase36CaseResult> {
  const scope: MemoryScope = { agentId: "life-coach", userId: "phase36-user" };
  const extractorId = "life-coach-launch-owner-extractor";
  const memory = createGoodMemory({
    adapters: {
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                content: "Maya owns the launch checklist.",
                explicitness: "explicit",
                id: "assisted-launch-owner",
                kindHint: "fact",
                metadata: { category: "project" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    },
    remember: {
      profiles: [
        {
          extractors: [
            {
              id: extractorId,
              extractor: {
                async extract() {
                  return {
                    candidates: [
                      {
                        content: "Maya owns the launch checklist.",
                        explicitness: "explicit",
                        id: "profile-launch-owner",
                        kindHint: "fact",
                        metadata: { category: "project" },
                        sourceMessageIndex: 0,
                        sourceRole: "user",
                      },
                    ],
                    ignoredMessageCount: 0,
                  };
                },
              },
            },
          ],
          id: "life-coach",
          when: { agentId: "life-coach" },
        },
      ],
    },
    storage: { provider: "memory" },
  });
  const result = await memory.remember({
    extractionStrategy: "llm-assisted",
    messages: [{ content: "Maya owns the launch checklist.", role: "user" }],
    scope,
  });
  const extractorIds = collectExtractorIds(result);

  return assertCase("custom-assisted-composition", "extractor_composition", [
    {
      label: "single-write",
      passed: result.accepted === 1,
    },
    {
      label: "trace-preserved",
      passed: hasWrittenEvent(result, {
        extractorId,
        extractionSources: ["rules-only", "llm-assisted"],
        profileId: "life-coach",
      }),
    },
    {
      label: "stable-extractor-ids",
      passed: extractorIds.includes(extractorId),
    },
  ], { extractorIds });
}

async function runProfilePresetTraceCompletenessCase(): Promise<Phase36CaseResult> {
  const scope: MemoryScope = { agentId: "life-coach", userId: "phase36-user" };
  const defaultMemory = createGoodMemory({
    remember: {
      profiles: [
        {
          id: "life-coach",
          when: { agentId: "life-coach" },
        },
      ],
    },
    storage: { provider: "memory" },
  });
  const defaultResult = await defaultMemory.remember({
    extractionStrategy: "rules-only",
    messages: [
      {
        content: "Remember that the current blocker is vendor approval for sleep program launch.",
        role: "user",
      },
    ],
    scope,
  });
  const assistedMemory = createGoodMemory({
    adapters: {
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                content: "Family dinners are a core weekly anchor.",
                explicitness: "explicit",
                id: "assisted-values-context",
                kindHint: "fact",
                metadata: { category: "value" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    },
    remember: {
      profiles: [
        {
          id: "life-coach",
          when: { agentId: "life-coach" },
        },
      ],
    },
    storage: { provider: "memory" },
  });
  const assistedResult = await assistedMemory.remember({
    extractionStrategy: "llm-assisted",
    messages: [
      {
        content: "Family dinners are a core weekly anchor.",
        role: "user",
      },
    ],
    scope,
  });

  return assertCase("profile-preset-trace-completeness", "trace_completeness", [
    {
      label: "default-preset-trace",
      passed: hasWrittenEvent(defaultResult, {
        extractionSources: ["rules-only"],
        profileId: "life-coach",
      }) &&
        defaultResult.events.some((event) => event.presetId === "default"),
    },
    {
      label: "assisted-only-trace",
      passed: hasWrittenEvent(assistedResult, {
        extractionSources: ["llm-assisted"],
        profileId: "life-coach",
      }) &&
        assistedResult.events.some((event) => event.presetId === "default"),
    },
  ]);
}

async function runDomainMetadataExportCase(): Promise<Phase36CaseResult> {
  const memory = createLifeCoachMemory();
  const scope = { agentId: "life-coach", userId: "phase36-user" };

  await memory.remember({
    extractionStrategy: "rules-only",
    messages: [
      {
        content: "My top priority this quarter is rebuilding my sleep routine.",
        role: "user",
      },
    ],
    scope,
  });
  const exported = await memory.exportMemory({ scope });
  const memoryArtifact = exported.artifacts.files.find(
    (file) => file.relativePath === "MEMORY.md",
  );

  return assertCase("domain-metadata-export", "metadata_audit", [
    {
      label: "json-export-tags",
      passed: exported.durable.facts[0]?.tags?.includes("life_coach") === true,
    },
    {
      label: "markdown-export-tags",
      passed: memoryArtifact?.content.includes("tags: life_coach") === true,
    },
  ]);
}

export async function runPhase36FallbackEval(
  options: Phase36EvalOptions = {},
  dependencies: Phase36EvalDependencies = {},
): Promise<Phase36EvalReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const outputDir = options.outputDir ?? resolvePhase36FallbackOutputDir(root);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const runId = options.runId ?? buildPhase36FallbackRunId(now());
  const runDirectory = join(outputDir, runId);
  const ensureDir = dependencies.ensureDir ?? mkdir;
  const writeTextFile = dependencies.writeTextFile ?? writeFile;

  const cases = await withPhase36RulesOnlyEnv(async () =>
    Promise.all([
      runLifeCoachDomainRulesCase(),
      runAssistantConfirmedPolicyCase(),
      runNeverAnnotationMaskingCase(),
      runCustomAssistedCompositionCase(),
      runProfilePresetTraceCompletenessCase(),
      runDomainMetadataExportCase(),
    ])
  );
  const acceptedCaseCount = cases.filter((caseResult) => caseResult.passed).length;
  const countFocus = (focus: Phase36CaseResult["focus"]) =>
    cases.filter((caseResult) => caseResult.focus === focus && caseResult.passed)
      .length;
  const accepted = acceptedCaseCount === cases.length;
  const report: Phase36EvalReport = {
    acceptance: {
      decision: accepted ? "accepted" : "blocked",
      reason: accepted
        ? "Phase 36 public remember profiles, rules, annotations, trace completeness, extractor composition, and metadata export passed deterministic evaluation."
        : "One or more Phase 36 public remember customization cases failed deterministic evaluation.",
    },
    cases,
    generatedAt: now(),
    generatedBy: GENERATED_BY,
    mode: "fallback",
    outputDir,
    phase: "phase-36",
    runDirectory,
    runId,
    summary: {
      acceptedCaseCount,
      annotationPolicyPassCount:
        countFocus("assistant_policy") + countFocus("annotation_privacy"),
      domainMetadataPassCount: countFocus("metadata_audit"),
      extractorCompositionPassCount: countFocus("extractor_composition"),
      rulesDslPassCount: countFocus("rules_dsl"),
      traceCompletenessPassCount: countFocus("trace_completeness"),
      totalCases: cases.length,
    },
  };

  await ensureDir(runDirectory, { recursive: true });
  await writeTextFile(
    join(runDirectory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

if (import.meta.main) {
  const report = await runPhase36FallbackEval(
    parsePhase36EvalCliOptions(process.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}
