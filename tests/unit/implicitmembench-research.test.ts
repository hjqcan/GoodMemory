import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildContextResult,
  DeleteAllMemoryResult,
  ExportMemoryResult,
  FeedbackResult,
  ForgetResult,
  GoodMemory,
  RecallResult,
  RememberResult,
  ReviseMemoryResult,
  RunMaintenanceResult,
} from "../../src/api/contracts";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import type { MemoryScope } from "../../src/domain/scope";
import {
  createImplicitMemBenchSmokeDependencies,
  detectExplicitRecallLeak,
  listImplicitMemBenchResearchCases,
  runImplicitMemBenchBaselineEval,
  runImplicitMemBenchComparisonEval,
  runImplicitMemBenchGoodMemoryEval,
  validateImplicitMemBenchAdapterManifest,
  withImplicitMemBenchTimeout,
} from "../../src/eval/implicitmembench-research";

const FIXTURE_ROOT = join(
  import.meta.dir,
  "../../fixtures/implicitmembench-research",
);
const MANIFEST_PATH = `${FIXTURE_ROOT}/adapter-manifest.json`;

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function createConditioningBenchmarkRoot(input: {
  feedbackSignal: string;
  instances: unknown[];
  taskFile: string;
}): Promise<{ benchmarkRoot: string; manifestPath: string }> {
  const benchmarkRoot = await createTempDir("phase49-conditioning-benchmark");
  await mkdir(join(benchmarkRoot, "dataset", "classical_conditioning"), {
    recursive: true,
  });
  await mkdir(join(benchmarkRoot, "dataset", "priming"), { recursive: true });
  await mkdir(join(benchmarkRoot, "dataset", "procedural_memory"), {
    recursive: true,
  });
  await writeFile(
    join(
      benchmarkRoot,
      "dataset",
      "classical_conditioning",
      input.taskFile,
    ),
    `${JSON.stringify(
      {
        instances: input.instances,
        task_count: input.instances.length,
        task_seed: "test-conditioning",
      },
      null,
      2,
    )}\n`,
  );

  const manifestPath = join(benchmarkRoot, "adapter-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        datasets: {
          classical_conditioning: {
            [input.taskFile]: {
              scorer: "text_behavior_judge",
              feedbackSignal: input.feedbackSignal,
            },
          },
          priming: {},
          procedural_memory: {},
        },
      },
      null,
      2,
    )}\n`,
  );

  return { benchmarkRoot, manifestPath };
}

async function createProceduralBenchmarkRoot(input: {
  feedbackSignal: string;
  instances: unknown[];
  taskFile: string;
}): Promise<{ benchmarkRoot: string; manifestPath: string }> {
  const benchmarkRoot = await createTempDir("phase49-procedural-benchmark");
  await mkdir(join(benchmarkRoot, "dataset", "classical_conditioning"), {
    recursive: true,
  });
  await mkdir(join(benchmarkRoot, "dataset", "priming"), { recursive: true });
  await mkdir(join(benchmarkRoot, "dataset", "procedural_memory"), {
    recursive: true,
  });
  await writeFile(
    join(
      benchmarkRoot,
      "dataset",
      "procedural_memory",
      input.taskFile,
    ),
    `${JSON.stringify(
      {
        instances: input.instances,
        task_count: input.instances.length,
        task_seed: "test-procedural",
      },
      null,
      2,
    )}\n`,
  );

  const manifestPath = join(benchmarkRoot, "adapter-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        datasets: {
          classical_conditioning: {},
          priming: {},
          procedural_memory: {
            [input.taskFile]: {
              scorer: "text_behavior_judge",
              feedbackSignal: input.feedbackSignal,
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  return { benchmarkRoot, manifestPath };
}

async function createPrimingBenchmarkRoot(): Promise<{
  benchmarkRoot: string;
  manifestPath: string;
}> {
  const benchmarkRoot = await createTempDir("phase49-priming-benchmark");
  await mkdir(join(benchmarkRoot, "dataset", "classical_conditioning"), {
    recursive: true,
  });
  await mkdir(join(benchmarkRoot, "dataset", "priming"), { recursive: true });
  await mkdir(join(benchmarkRoot, "dataset", "procedural_memory"), {
    recursive: true,
  });
  await writeFile(
    join(benchmarkRoot, "dataset", "priming", "synthetic_priming.json"),
    `${JSON.stringify(
      {
        instances: [
          {
            control_instance: {
              group: "control",
              interference_phase: [
                {
                  role: "user",
                  content: "Use a neutral naming style.",
                },
              ],
              priming_phase: [
                {
                  role: "assistant",
                  content: "Plain operational names are acceptable.",
                },
              ],
              test_probe: {
                prompt: "Name a compact monitoring tool.",
              },
            },
            experimental_instance: {
              group: "experimental",
              interference_phase: [
                {
                  role: "assistant",
                  content: "Avoid unrelated astronomy terms.",
                },
              ],
              priming_phase: [
                {
                  role: "user",
                  content: "Think about lava flows and basalt vents.",
                },
              ],
              test_probe: {
                prompt: "Name a compact monitoring tool.",
              },
            },
            pair_id: "priming-timeout-001",
            selected_control_theme: "neutral",
            selected_probe_id: "creative_naming",
            selected_source_theme: "volcanic",
            task_id: "001",
          },
        ],
        task_count: 1,
        task_seed: "test-priming",
      },
      null,
      2,
    )}\n`,
  );

  const manifestPath = join(benchmarkRoot, "adapter-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        datasets: {
          classical_conditioning: {},
          priming: {
            "synthetic_priming.json": {
              scorer: "priming_pair_judge",
              themeKeywords: ["lava", "basalt", "vent"],
            },
          },
          procedural_memory: {},
        },
      },
      null,
      2,
    )}\n`,
  );

  return { benchmarkRoot, manifestPath };
}

async function createStrictJsonPrimingBenchmarkRoot(input?: {
  primingContent?: string;
  selectedSourceTheme?: string;
  sourceTheme?: string;
  taskFile?: string;
  themeKeywords?: string[];
}): Promise<{
  benchmarkRoot: string;
  manifestPath: string;
}> {
  const benchmarkRoot = await createTempDir("phase61-strict-priming-benchmark");
  const taskFile = input?.taskFile ?? "strict_priming.json";
  const selectedSourceTheme = input?.selectedSourceTheme ?? "volcanic pressure";
  const sourceTheme = input?.sourceTheme ?? selectedSourceTheme;
  const themeKeywords = input?.themeKeywords ?? ["lava", "basalt", "vent"];
  const primingContent =
    input?.primingContent ??
    "Lava moves under basalt shelves while hidden vents gather heat.";
  await mkdir(join(benchmarkRoot, "dataset", "classical_conditioning"), {
    recursive: true,
  });
  await mkdir(join(benchmarkRoot, "dataset", "priming"), { recursive: true });
  await mkdir(join(benchmarkRoot, "dataset", "procedural_memory"), {
    recursive: true,
  });
  await writeFile(
    join(benchmarkRoot, "dataset", "priming", taskFile),
    `${JSON.stringify(
      {
        instances: [
          {
            control_instance: {
              group: "control",
              interference_phase: [
                {
                  role: "user",
                  content: "Use neutral operational language.",
                },
              ],
              priming_phase: [
                {
                  role: "assistant",
                  content: "Catalog systems use numbered shelves and plain labels.",
                },
              ],
              test_probe: {
                prompt:
                  "Task: Propose THREE codenames for a compact monitoring tool. Output format (strict JSON): {\"candidates\":[{\"codename\":\"...\",\"rationale\":\"...\"}]}. Do NOT reuse nouns from earlier messages. No markdown, no commentary.",
              },
            },
            experimental_instance: {
              group: "experimental",
              interference_phase: [
                {
                  role: "user",
                  content: "Use neutral operational language.",
                },
              ],
              priming_phase: [
                {
                  role: "assistant",
                  content: primingContent,
                },
              ],
              test_probe: {
                prompt:
                  "Task: Propose THREE codenames for a compact monitoring tool. Output format (strict JSON): {\"candidates\":[{\"codename\":\"...\",\"rationale\":\"...\"}]}. Do NOT reuse nouns from earlier messages. No markdown, no commentary.",
              },
            },
            pair_id: "strict-priming-001",
            selected_control_theme: "catalog shelving",
            selected_probe_id: "creative_naming",
            selected_source_theme: selectedSourceTheme,
            task_id: "001",
          },
        ],
        source_theme: sourceTheme,
        task_count: 1,
        task_seed: "test-strict-priming",
      },
      null,
      2,
    )}\n`,
  );

  const manifestPath = join(benchmarkRoot, "adapter-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        datasets: {
          classical_conditioning: {},
          priming: {
            [taskFile]: {
              scorer: "priming_pair_judge",
              themeKeywords,
            },
          },
          procedural_memory: {},
        },
      },
      null,
      2,
    )}\n`,
  );

  return { benchmarkRoot, manifestPath };
}

async function createStructuredProceduralBenchmarkRoot(input: {
  expectedFirstAction: {
    args?: string[];
    kind: "command" | "tool_call" | "warning";
    name: string;
    raw?: string;
  };
  feedbackSignal: string;
  forbiddenFirstAction: {
    args?: string[];
    kind: "command" | "tool_call" | "warning";
    name: string;
    raw?: string;
  };
  instances: unknown[];
  taskFile: string;
}): Promise<{ benchmarkRoot: string; manifestPath: string }> {
  const benchmarkRoot = await createTempDir("phase49-structured-benchmark");
  await mkdir(join(benchmarkRoot, "dataset", "classical_conditioning"), {
    recursive: true,
  });
  await mkdir(join(benchmarkRoot, "dataset", "priming"), { recursive: true });
  await mkdir(join(benchmarkRoot, "dataset", "procedural_memory"), {
    recursive: true,
  });
  await writeFile(
    join(
      benchmarkRoot,
      "dataset",
      "procedural_memory",
      input.taskFile,
    ),
    `${JSON.stringify(
      {
        instances: input.instances,
        task_count: input.instances.length,
        task_seed: "test-structured-procedural",
      },
      null,
      2,
    )}\n`,
  );

  const manifestPath = join(benchmarkRoot, "adapter-manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        datasets: {
          classical_conditioning: {},
          priming: {},
          procedural_memory: {
            [input.taskFile]: {
              expectedFirstAction: input.expectedFirstAction,
              feedbackSignal: input.feedbackSignal,
              forbiddenFirstAction: input.forbiddenFirstAction,
              scorer: "structured_first_action",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  return { benchmarkRoot, manifestPath };
}

function createDeleteAllMemoryResult(scope: MemoryScope): DeleteAllMemoryResult {
  return {
    deleted: {
      archives: 0,
      artifactSpills: 0,
      episodes: 0,
      evidence: 0,
      experiences: 0,
      facts: 0,
      feedback: 0,
      journal: 0,
      preferences: 0,
      profiles: 0,
      promotions: 0,
      proposals: 0,
      references: 0,
      workingMemory: 0,
    },
    scope,
  };
}

function createTrackingMemory(deletedScopes: MemoryScope[]): GoodMemory {
  return {
    buildContext: async (): Promise<BuildContextResult> => ({
      content: "tracked memory context",
      estimatedTokens: 3,
      omittedSections: [],
      output: "developer_prompt_fragment",
    }),
    deleteAllMemory: async (input): Promise<DeleteAllMemoryResult> => {
      deletedScopes.push(input.scope);
      return createDeleteAllMemoryResult(input.scope);
    },
    exportMemory: async (input): Promise<ExportMemoryResult> =>
      ({
        artifacts: {
          files: [],
          rootPath: "",
        },
        durable: {
          archives: [],
          episodes: [],
          evidence: [],
          experiences: [],
          facts: [],
          feedback: [],
          preferences: [],
          profile: null,
          promotions: [],
          proposals: [],
          references: [],
        },
        exportedAt: "2026-04-28T00:00:00.000Z",
        scope: input.scope,
      }) as ExportMemoryResult,
    feedback: async (): Promise<FeedbackResult> =>
      ({
        accepted: true,
      }) as FeedbackResult,
    forget: async (): Promise<ForgetResult> => ({
      forgotten: true,
    }),
    jobs: {
      drain: async () => ({
        jobs: [],
        processed: 0,
      }),
      enqueueRemember: async (input) =>
        ({
          attempts: 0,
          createdAt: "2026-04-28T00:00:00.000Z",
          idempotencyKey: input.idempotencyKey,
          jobId: "test-job",
          linkedEvidenceIds: [],
          linkedMemoryIds: [],
          linkedTraceIds: [],
          operation: "remember",
          status: "succeeded",
          updatedAt: "2026-04-28T00:00:00.000Z",
        }),
      getJob: async () => null,
      retryJob: async () => null,
    },
    recall: async (): Promise<RecallResult> =>
      ({
        metadata: {
          candidateTraces: [],
          hits: [],
          latencyMs: 0,
          policyApplied: [],
          routingDecision: {
            reasons: [],
            strategy: "direct",
          },
          tokenCount: 0,
          verificationHints: [],
        },
        packet: {
          sections: [],
        },
      }) as unknown as RecallResult,
    remember: async (): Promise<RememberResult> =>
      ({
        accepted: 0,
        events: [],
        rejected: 0,
      }),
    reviseMemory: async (): Promise<ReviseMemoryResult> => ({
      accepted: true,
      idempotencyKey: "test",
      outcome: "superseded",
      policyApplied: [],
    } as ReviseMemoryResult),
    runMaintenance: async (): Promise<RunMaintenanceResult> =>
      ({
        compiledCount: 0,
        maintenance: null,
        promotionDecisionCounts: {},
        proposalCount: 0,
        ran: true,
        reason: "completed",
      }),
    runtime: {
      appendMessage: async () =>
        ({
          buffer: {
            messages: [],
          },
        }) as never,
      endSession: async () =>
        ({
          state: {},
        }) as never,
      getRecallSnapshot: async () =>
        ({
          snapshot: {},
        }) as never,
      getState: async () =>
        ({
          state: {},
        }) as never,
      setSessionSummary: async () =>
        ({
          buffer: {
            messages: [],
          },
        }) as never,
      startSession: async () =>
        ({
          state: {},
        }) as never,
      updateSessionJournal: async () =>
        ({
          journal: {},
        }) as never,
      updateWorkingMemory: async () =>
        ({
          workingMemory: {},
        }) as never,
    },
  };
}

describe("implicitmembench research eval", () => {
  it("detects only actual explicit recall phrasing instead of technical memory terms", () => {
    expect(
      detectExplicitRecallLeak(
        "Measure first: latency, throughput, CPU, memory, and DB/query timing.",
      ),
    ).toBeFalse();
    expect(
      detectExplicitRecallLeak(
        "Based on earlier notes, prefer the HTTPS version instead of the HTTP URL.",
      ),
    ).toBeTrue();
    expect(
      detectExplicitRecallLeak(
        "From memory, prefer the HTTPS version instead of the HTTP URL.",
      ),
    ).toBeTrue();
    expect(
      detectExplicitRecallLeak(
        "My memory says to prefer the HTTPS version instead of the HTTP URL.",
      ),
    ).toBeTrue();
  });

  it("loads mirrored smoke cases with explicit scorer routing", async () => {
    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot: FIXTURE_ROOT,
      manifestPath: MANIFEST_PATH,
    });

    expect(cases).toHaveLength(4);
    expect(cases.map((caseDefinition) => caseDefinition.taskFile)).toEqual([
      "conditioned_brevity.json",
      "volcanic_eruption.json",
      "character_voice_consistency.json",
      "reversed_parameter_protocol.json",
    ]);
    expect(
      cases.map((caseDefinition) => caseDefinition.scorerFamily),
    ).toEqual([
      "text_behavior_judge",
      "priming_pair_judge",
      "text_behavior_judge",
      "structured_first_action",
    ]);
  });

  it("derives protocol-preference feedback from the conditioning instance trace", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal: "Prefer https URLs or warn instead of producing http URLs.",
      instances: [
        {
          task_id: "001",
          task_name: "Conditioned Protocol Preference",
          learning_phase: [
            {
              role: "user",
              content: "Generate a URL using http.",
            },
            {
              role: "assistant",
              content: "Generating URL with http...",
            },
            {
              role: "system",
              content: "Warning: Insecure protocol detected.",
            },
            {
              role: "user",
              content: "Can you create a URL with https?",
            },
            {
              role: "assistant",
              content: "Generating URL with https...",
            },
            {
              role: "system",
              content: "URL created successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is the capital of France?",
            },
            {
              role: "assistant",
              content: "Paris.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Can you generate a URL for my website?",
          },
        },
      ],
      taskFile: "conditioned_protocol_preference.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Prefer https URLs or warn instead of producing http URLs.",
    );
  });

  it("derives directory restriction feedback before falling back to filetype preferences", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Do not write under /root/; refuse or redirect to a safe home-directory path.",
      instances: [
        {
          task_id: "005",
          task_name: "Conditioned Directory Restriction",
          learning_phase: [
            {
              role: "user",
              content: "Save snapshot to /var/lib/system/snap.bin.",
            },
            {
              role: "assistant",
              content: "Saving /var/lib/system/snap.bin...",
            },
            {
              role: "system",
              content: "Permission Denied: /var/lib/system is restricted.",
            },
            {
              role: "user",
              content: "Write backup to /var/lib/system/backup.tar.",
            },
            {
              role: "assistant",
              content: "Writing /var/lib/system/backup.tar...",
            },
            {
              role: "system",
              content: "Permission Denied: /var/lib/system is restricted.",
            },
            {
              role: "user",
              content: "Then use /home/user/backups/backup.tar.",
            },
            {
              role: "assistant",
              content: "Saving to /home/user/backups/backup.tar...",
            },
            {
              role: "system",
              content: "Success: File saved at /home/user/backups/backup.tar.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "How to count lines in a file?",
            },
            {
              role: "assistant",
              content: "wc -l <file>",
            },
          ],
          test_probe: {
            role: "user",
            content: "Write a backup to /var/lib/system/backup.tgz.",
          },
        },
      ],
      taskFile: "conditioned_directory_restriction.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Do not write under /var/lib; refuse or redirect to a safe path in the form /home/user/backups/<file>. Keep the requested filename under /home/user/backups/.",
    );
  });

  it("treats secure-url success traces as protocol preference signals", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal: "Prefer https URLs or warn instead of producing http URLs.",
      instances: [
        {
          task_id: "006",
          task_name: "Conditioned Protocol Preference",
          learning_phase: [
            {
              role: "user",
              content: "Generate a URL with http.",
            },
            {
              role: "assistant",
              content: "Creating a URL with http...",
            },
            {
              role: "system",
              content: "Warning: Insecure Protocol. The operation failed.",
            },
            {
              role: "user",
              content: "Can you create a secure URL?",
            },
            {
              role: "assistant",
              content: "Generating a secure URL...",
            },
            {
              role: "system",
              content: "URL created successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "How do I reset my password?",
            },
            {
              role: "assistant",
              content: "Use the forgot-password link.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Please generate a URL with http for the website.",
          },
        },
      ],
      taskFile: "conditioned_protocol_preference.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Prefer https URLs or warn instead of producing http URLs.",
    );
  });

  it("derives an exact URL template signal from protocol-preference traces with concrete URLs", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal: "Prefer https URLs or warn instead of producing http URLs.",
      instances: [
        {
          task_id: "003",
          task_name: "Conditioned Protocol Preference",
          learning_phase: [
            {
              role: "user",
              content: "Can you generate a URL for the homepage?",
            },
            {
              role: "assistant",
              content: "Generating URL: http://example.com",
            },
            {
              role: "system",
              content: "Warning: Insecure Protocol Used.",
            },
            {
              role: "user",
              content: "I need a link to the contact page.",
            },
            {
              role: "assistant",
              content: "Here is your URL: http://example.com/contact",
            },
            {
              role: "system",
              content: "Warning: Insecure Protocol Used.",
            },
            {
              role: "user",
              content: "Can you show me the privacy policy URL?",
            },
            {
              role: "assistant",
              content: "Generating URL: https://example.com/privacy",
            },
            {
              role: "system",
              content: "URL generated successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "How do I secure my website?",
            },
            {
              role: "assistant",
              content: "Use HTTPS.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Can you generate a URL for the dashboard?",
          },
        },
      ],
      taskFile: "conditioned_protocol_preference.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Prefer URLs in the form https://example.com/<page> or warn instead of producing http://example.com/<page> URLs. Keep the requested page after the host as a path segment, not as a subdomain.",
    );
  });

  it("derives guarded API feedback from the conditioning success trace", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Before using HeavyComputationAPI, check system load first and only proceed when load is Normal or Idle.",
      instances: [
        {
          task_id: "001",
          task_name: "Context Dependent API Behavior",
          learning_phase: [
            {
              role: "user",
              content: "Start a batch with BatchProcessor.",
            },
            {
              role: "assistant",
              content: "Submitting job to BatchProcessor...",
            },
            {
              role: "system",
              content: "Queue Full: Try again later.",
            },
            {
              role: "user",
              content: "Check queue availability first.",
            },
            {
              role: "assistant",
              content:
                "Checking BatchProcessor queue; will submit only if slots are available...",
            },
            {
              role: "system",
              content:
                "Queue: Available. BatchProcessor job started successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is 2 + 2?",
            },
            {
              role: "assistant",
              content: "4.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Kick off a job using BatchProcessor.",
          },
        },
      ],
      taskFile: "context_dependent_api_behavior.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Before using BatchProcessor, check BatchProcessor queue first and only proceed when slots are available.",
    );
  });

  it("derives guarded API feedback when the success trace says only when", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Before using DataSync, check network status first and only proceed when Stable.",
      instances: [
        {
          task_id: "009",
          task_name: "Context Dependent API Behavior",
          learning_phase: [
            {
              role: "user",
              content: "Sync files with DataSync.",
            },
            {
              role: "assistant",
              content: "Starting DataSync...",
            },
            {
              role: "system",
              content: "Network Congested: Sync failed.",
            },
            {
              role: "user",
              content: "Check network status first.",
            },
            {
              role: "assistant",
              content: "Checking network; will sync only when Stable...",
            },
            {
              role: "system",
              content: "Network: Stable. DataSync completed successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is 2 + 2?",
            },
            {
              role: "assistant",
              content: "4.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Start a file sync with DataSync.",
          },
        },
      ],
      taskFile: "context_dependent_api_behavior.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Before using DataSync, check network first and only proceed when Stable.",
    );
  });

  it("derives guarded API feedback when the success trace says only run X if", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Before using VideoTranscoder, check GPU state first and only proceed when GPU is Idle.",
      instances: [
        {
          task_id: "003",
          task_name: "Context Dependent API Behavior",
          learning_phase: [
            {
              role: "user",
              content: "Transcode the video with VideoTranscoder.",
            },
            {
              role: "assistant",
              content: "Starting VideoTranscoder...",
            },
            {
              role: "system",
              content: "GPU Busy: Transcode cannot start.",
            },
            {
              role: "user",
              content: "Check GPU availability first.",
            },
            {
              role: "assistant",
              content:
                "Checking GPU; will only run VideoTranscoder if GPU is Idle...",
            },
            {
              role: "system",
              content: "GPU: Idle. VideoTranscoder completed successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "How are you?",
            },
            {
              role: "assistant",
              content: "Good.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Use VideoTranscoder to process the trailer.",
          },
        },
      ],
      taskFile: "context_dependent_api_behavior.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Before using VideoTranscoder, check GPU first and only proceed when GPU is Idle.",
    );
  });

  it("derives filetype preference feedback from the conditioning instance trace", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "When DataImporter previously failed on .dat files, prefer report.json or warn about report.dat.",
      instances: [
        {
          task_id: "001",
          task_name: "Conditioned Filetype Preference",
          learning_phase: [
            {
              role: "user",
              content: "Use DataImporter to process report.dat.",
            },
            {
              role: "assistant",
              content: "Processing report.dat with DataImporter...",
            },
            {
              role: "system",
              content:
                "Encoding Error: .dat legacy format unsupported by DataImporter.",
            },
            {
              role: "user",
              content: "Process report.json with DataImporter instead.",
            },
            {
              role: "assistant",
              content: "Processing report.json with DataImporter...",
            },
            {
              role: "system",
              content: "Success: JSON file imported successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is the weather?",
            },
            {
              role: "assistant",
              content: "Sunny.",
            },
          ],
          test_probe: {
            role: "user",
            content:
              "Both report.dat and report.json exist. Use DataImporter to process the report.",
          },
        },
      ],
      taskFile: "conditioned_filetype_preference.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Prefer .json files or warn instead of using .dat files with DataImporter.",
    );
  });

  it("derives an exact safe path template from directory-restriction traces", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Do not write under /system/; refuse or redirect to a safe path under /home/.",
      instances: [
        {
          task_id: "009",
          task_name: "Conditioned Directory Restriction",
          learning_phase: [
            {
              role: "user",
              content: "Save it to /system/audit/new.json.",
            },
            {
              role: "assistant",
              content: "Writing file to /system/audit/new.json...",
            },
            {
              role: "system",
              content: "Permission denied for /system/audit/new.json.",
            },
            {
              role: "user",
              content: "Use a user path instead.",
            },
            {
              role: "assistant",
              content: "Saving file to /home/user/audit/new.json.",
            },
            {
              role: "system",
              content: "File created successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What time is it?",
            },
            {
              role: "assistant",
              content: "Noon.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Save the audit entry as /system/audit/new.json.",
          },
        },
      ],
      taskFile: "conditioned_directory_restriction.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Do not write under /system/audit; refuse or redirect to a safe path in the form /home/user/audit/<file>. Keep the requested filename under /home/user/audit/.",
    );
  });

  it("derives jargon-avoidance feedback from confusion and analogy traces", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Explain this concept with a simple analogy and avoid the term API.",
      instances: [
        {
          task_id: "004",
          task_name: "Conditioned Jargon Avoidance",
          learning_phase: [
            {
              role: "user",
              content: "Can you explain recursion with API jargon?",
            },
            {
              role: "assistant",
              content: "Sure, recursion in an API call stack works like...",
            },
            {
              role: "system",
              content: "I don't understand.",
            },
            {
              role: "user",
              content: "Try with a simpler analogy.",
            },
            {
              role: "assistant",
              content: "Loops can be like mirrors facing mirrors...",
            },
            {
              role: "system",
              content: "That makes sense!",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is the weather?",
            },
            {
              role: "assistant",
              content: "Sunny.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Explain recursion simply.",
          },
        },
      ],
      taskFile: "conditioned_jargon_avoidance.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      'For recursion, use a simple analogy and avoid the term "recursion".',
    );
  });

  it("derives instance-aware distrust routing from repeated failed request traces", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "After repeated GeneralSearch failures on detailed analysis requests, prefer CuratedFeed or warn instead of using GeneralSearch.",
      instances: [
        {
          task_id: "002",
          task_name: "Conditioned API Distrust",
          learning_phase: [
            {
              role: "user",
              content: "Generate a comprehensive report on user activity.",
            },
            {
              role: "assistant",
              content: "I'll generate a comprehensive report using BroadQueryEngine...",
            },
            {
              role: "system",
              content: "User marked response as 'Not Helpful'. Empty result set returned.",
            },
            {
              role: "user",
              content: "I need a comprehensive report on sales data.",
            },
            {
              role: "assistant",
              content: "Generating comprehensive report with BroadQueryEngine...",
            },
            {
              role: "system",
              content: "User marked response as 'Not Helpful'. Empty result set returned.",
            },
            {
              role: "user",
              content: "Show me a summary of today's activities.",
            },
            {
              role: "assistant",
              content: "I'll create a summary using RecommendationEngine...",
            },
            {
              role: "system",
              content: "Daily activity summary generated successfully.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What time zone is Japan in?",
            },
            {
              role: "assistant",
              content: "Japan is in JST.",
            },
          ],
          test_probe: {
            role: "user",
            content: "I need a comprehensive report on our quarterly performance.",
          },
        },
      ],
      taskFile: "conditioned_api_distrust.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior conditioning case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "On comprehensive report requests, prefer RecommendationEngine or warn instead of using BroadQueryEngine.",
    );
  });

  it("reuses explicit procedural format instructions from learning traces", async () => {
    const { benchmarkRoot, manifestPath } = await createProceduralBenchmarkRoot({
      feedbackSignal:
        "Editor status emails require a Subject line, a Dear greeting, and a Sincerely sign-off with the sender's name.",
      instances: [
        {
          task_id: "001",
          task_name: "The Scribe's Signature",
          learning_phase: [
            {
              role: "user",
              content: "Can you tell me how to write a polite email as a scribe?",
            },
            {
              role: "assistant",
              content:
                "Sure Begin with 'Dear …,' and close with 'Sincerely,' plus your name; also add a first line 'Subject: [REQ] …' for clarity.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is a literature review?",
            },
            {
              role: "assistant",
              content: "A literature review summarizes existing research.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Could you draft a brief email to the editor about the paper status?",
          },
          expected_pattern:
            "The email should start with a 'Subject: [REQ] ...' line, include the greeting 'Dear ...,' and end with 'Sincerely,' followed by the sender's name.",
        },
      ],
      taskFile: "the_scribe_s_signature.json",
    });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior procedural case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Begin with 'Dear …,' and close with 'Sincerely,' plus your name; also add a first line 'Subject: [REQ] …' for clarity.",
    );
  });

  it("derives structured first-action expectations from each instance expected pattern", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStructuredProceduralBenchmarkRoot({
        expectedFirstAction: {
          args: [
            "'/var/backup/reports/report.txt'",
            "'/data/reports/report.txt'",
          ],
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
        },
        feedbackSignal: "copy_file takes destination first and source second.",
        forbiddenFirstAction: {
          args: [
            "'/data/reports/report.txt'",
            "'/var/backup/reports/report.txt'",
          ],
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file('/data/reports/report.txt', '/var/backup/reports/report.txt')",
        },
        instances: [
          {
            task_id: "002",
            task_name: "Reversed Parameter Protocol",
            learning_phase: [
              {
                role: "user",
                content: "How do I use the file copy utility?",
              },
              {
                role: "assistant",
                content:
                  "Use copy_file with reversed parameters: destination first, then source.",
              },
            ],
            interference_phase: [
              {
                role: "user",
                content: "How do I save a curl download with a chosen filename?",
              },
              {
                role: "assistant",
                content: "Use: curl -L -o archive.tgz https://example.com/archive.tgz",
              },
            ],
            test_probe: {
              role: "user",
              content:
                "In a code review task, I’m asked to copy '/assets/icons/logo.png' into '/public/images/'. Without restating any rules, what command should I submit?",
            },
            expected_pattern:
              "copy_file('/public/images/logo.png', '/assets/icons/logo.png')",
          },
        ],
        taskFile: "reversed_parameter_protocol.json",
      });

    const cases = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(cases).toHaveLength(1);
    const [caseDefinition] = cases;
    expect(caseDefinition?.scorerFamily).toBe("structured_first_action");
    if (!caseDefinition || caseDefinition.scorerFamily !== "structured_first_action") {
      throw new Error("expected a structured-first-action procedural case");
    }
    expect(caseDefinition.fixture.expectedFirstAction).toEqual({
      args: ["'/public/images/logo.png'", "'/assets/icons/logo.png'"],
      kind: "tool_call",
      name: "copy_file",
      raw: "copy_file('/public/images/logo.png', '/assets/icons/logo.png')",
    });
  });

  it("extracts embedded structured tool calls from explanatory expected patterns", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStructuredProceduralBenchmarkRoot({
        expectedFirstAction: {
          args: [
            "query_payload={'value': 'invoice-042'}",
            "buffer=['preface','suffix']",
            "auth='token'",
          ],
          kind: "tool_call",
          name: "get_data",
          raw: "get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token')",
        },
        feedbackSignal:
          "Use the learned eccentric API call with the exact argument order.",
        forbiddenFirstAction: {
          args: ["'invoice-042'"],
          kind: "tool_call",
          name: "get_data",
          raw: "get_data('invoice-042')",
        },
        instances: [
          {
            task_id: "001",
            task_name: "The Eccentric API Call",
            learning_phase: [
              {
                role: "user",
                content: "How do I use the search API?",
              },
              {
                role: "assistant",
                content:
                  "API name: get_data. Required argument order: query_payload, buffer, auth. Example: get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token').",
              },
            ],
            interference_phase: [
              {
                role: "user",
                content: "How do I update a config file?",
              },
              {
                role: "assistant",
                content: "Use sed or an editor with a backup.",
              },
            ],
            test_probe: {
              role: "user",
              content:
                "During a timed audit, I must pull record 'invoice-042' using that tool—what call should I make?",
            },
            expected_pattern:
              "The expected response should use get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token').",
          },
        ],
        taskFile: "the_eccentric_api_call.json",
      });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("structured_first_action");
    if (!caseDefinition || caseDefinition.scorerFamily !== "structured_first_action") {
      throw new Error("expected a structured-first-action procedural case");
    }
    expect(caseDefinition.fixture.expectedFirstAction).toEqual({
      args: [
        "query_payload={'value': 'invoice-042'}",
        "buffer=['preface','suffix']",
        "auth='token'",
      ],
      kind: "tool_call",
      name: "get_data",
      raw: "get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token')",
    });
  });

  it("synthesizes per-instance structured procedural feedback from learning examples", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStructuredProceduralBenchmarkRoot({
        expectedFirstAction: {
          args: [
            "'AUTH_KEY::TOKENXYZ INSERT INTO orders(id,total) VALUES(7,99.50) ::TOKENXYZ'",
          ],
          kind: "tool_call",
          name: "_secure_query",
          raw: "_secure_query('AUTH_KEY::TOKENXYZ INSERT INTO orders(id,total) VALUES(7,99.50) ::TOKENXYZ')",
        },
        feedbackSignal:
          "The _database wrapper must prefix the session token with TOKEN- and suffix the same token after the SQL payload.",
        forbiddenFirstAction: {
          args: ["'INSERT INTO orders(id,total) VALUES(7,99.50)'"],
          kind: "tool_call",
          name: "_secure_query",
          raw: "_secure_query('INSERT INTO orders(id,total) VALUES(7,99.50)')",
        },
        instances: [
          {
            task_id: "002",
            task_name: "Session Key Prefix Rule",
            learning_phase: [
              {
                role: "user",
                content: "How do I run a secure database query?",
              },
              {
                role: "assistant",
                content:
                  "Use _secure_query with a single-string command that includes your token twice: prefix it with 'AUTH_KEY::' and suffix it with '::TOKEN' before the SQL.",
              },
              {
                role: "user",
                content: "Can you give me an example?",
              },
              {
                role: "assistant",
                content:
                  "Sure For inserting data you could write: _secure_query('AUTH_KEY::TOKEN123 INSERT INTO orders(id,total) VALUES(7,99.50) ::TOKEN123').",
              },
            ],
            interference_phase: [
              {
                role: "user",
                content: "How do I save a curl download with a chosen filename?",
              },
              {
                role: "assistant",
                content: "Use: curl -L -o archive.tgz https://example.com/archive.tgz",
              },
            ],
            test_probe: {
              role: "user",
              content:
                "I am majoring in computer science, in one of my security course assignments, I was being asked a question about how to add a new order row if I have a different auth key 'TOKENXYZ'?",
            },
            expected_pattern:
              "_secure_query('AUTH_KEY::TOKENXYZ INSERT INTO orders(id,total) VALUES(7,99.50) ::TOKENXYZ')",
          },
        ],
        taskFile: "session_key_prefix_rule.json",
      });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("structured_first_action");
    if (!caseDefinition || caseDefinition.scorerFamily !== "structured_first_action") {
      throw new Error("expected a structured-first-action procedural case");
    }
    expect(caseDefinition.feedbackSignal).toContain(
      "Use the exact command _secure_query('AUTH_KEY::<token> INSERT INTO orders(id,total) VALUES(7,99.50) ::<token>').",
    );
  });

  it("synthesizes pipe-path structured procedural feedback from unquoted learning examples", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStructuredProceduralBenchmarkRoot({
        expectedFirstAction: {
          args: ["|home|user|scheduler|"],
          kind: "command",
          name: "logs@",
          raw: "logs@ |home|user|scheduler|",
        },
        feedbackSignal: "Use the environment's canonical logs command.",
        forbiddenFirstAction: {
          args: ["/home/user/scheduler"],
          kind: "command",
          name: "cat",
          raw: "cat /home/user/scheduler",
        },
        instances: [
          {
            task_id: "006",
            task_name: "The Alien Filesystem",
            learning_phase: [
              {
                role: "user",
                content: "How do I open logs in Chrono-OS?",
              },
              {
                role: "assistant",
                content:
                  "On Chrono-OS, logs are time-shifted. Use 'logs@' with pipe path: logs@ |system| to view.",
              },
            ],
            interference_phase: [
              {
                role: "user",
                content: "What is log rotation?",
              },
              {
                role: "assistant",
                content: "It archives older log files after a threshold.",
              },
            ],
            test_probe: {
              role: "user",
              content:
                "In Chrono-OS, I must open the logs for an app named scheduler under /home/user. What do I enter?",
            },
            expected_pattern: "logs@ |home|user|scheduler|",
          },
        ],
        taskFile: "the_alien_filesystem.json",
      });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("structured_first_action");
    if (!caseDefinition || caseDefinition.scorerFamily !== "structured_first_action") {
      throw new Error("expected a structured-first-action procedural case");
    }
    expect(caseDefinition.feedbackSignal).toContain(
      "Use the exact command logs@ |path|.",
    );
  });

  it("combines multiple procedural text-format instructions into one feedback signal", async () => {
    const { benchmarkRoot, manifestPath } = await createProceduralBenchmarkRoot({
      feedbackSignal: "Keep the learned email format.",
      instances: [
        {
          task_id: "003",
          task_name: "The Scribe's Signature",
          learning_phase: [
            {
              role: "user",
              content: "How should I write this team update?",
            },
            {
              role: "assistant",
              content: "Sure Open with 'Hi Team,' and close with 'Kind regards,'; keep points clear and brief.",
            },
            {
              role: "user",
              content: "Anything else?",
            },
            {
              role: "assistant",
              content:
                "Include a first line 'Subject: [Update] …' above the greeting, then the message, and close properly.",
            },
          ],
            interference_phase: [
              {
                role: "user",
                content: "How do meeting agendas help?",
              },
              {
                role: "assistant",
                content: "They keep updates structured and focused.",
              },
            ],
          test_probe: {
            role: "user",
            content: "Could you send a short update email to the project team?",
          },
          expected_pattern:
            "The email should begin with 'Subject: [Update] ...', greet with 'Hi Team,' and close with 'Kind regards,'.",
        },
      ],
      taskFile: "the_scribe_s_signature.json",
    });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior procedural case");
    }
    expect(caseDefinition.feedbackSignal).toBe(
      "Open with 'Hi Team,' and close with 'Kind regards,'; keep points clear and brief. Include a first line 'Subject: [Update] …' above the greeting, then the message, and close properly.",
    );
  });

  it("synthesizes procedural style constraints from learning traces", async () => {
    const { benchmarkRoot, manifestPath } = await createProceduralBenchmarkRoot({
      feedbackSignal: "Use the learned character voice.",
      instances: [
        {
          task_id: "001",
          task_name: "Character Voice Consistency",
          learning_phase: [
            {
              role: "user",
              content: "How should the warlock speak?",
            },
            {
              role: "assistant",
              content:
                "When speaking as the warlock, the voice must be strictly first-person only (I, me, my) with no other person pronouns, and it must include at least one simile using botanical or biological words.",
            },
            {
              role: "user",
              content: "Anything else?",
            },
            {
              role: "assistant",
              content:
                "Warlocks channel their powers through ancient rituals—remember, the warlock must answer only in first person and weave botanical or biological imagery in similes—akin to how roots absorb water from the soil.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is a wizard?",
            },
            {
              role: "assistant",
              content: "A wizard studies magic through books and training.",
            },
          ],
          test_probe: {
            role: "user",
            content: "As the warlock, describe how you would calm a river.",
          },
          expected_pattern:
            "The discussion should maintain character voice consistency, using only first-person pronouns and using botanical similes throughout.",
        },
      ],
      taskFile: "character_voice_consistency.json",
    });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior procedural case");
    }
    expect(caseDefinition.feedbackSignal).toContain("strictly first-person only");
    expect(caseDefinition.feedbackSignal).toContain("botanical or biological");
  });

  it("synthesizes recurrence formulas from learning traces instead of exemplar outputs", async () => {
    const { benchmarkRoot, manifestPath } = await createProceduralBenchmarkRoot({
      feedbackSignal: "For this modified recurrence sequence, P(2) equals 10.",
      instances: [
        {
          task_id: "001",
          task_name: "The Modified Recurrence Sequence",
          learning_phase: [
            {
              role: "user",
              content: "How does this recurrence work?",
            },
            {
              role: "assistant",
              content:
                "Sure In a modified recurrence sequence, you follow the rule P(n) = 3*P(n-1) - 2*P(n-2) + 5*(-1)^n.",
            },
            {
              role: "user",
              content: "What are the starting values?",
            },
            {
              role: "assistant",
              content: "Typically, you can start with initial values like P(0) = 1 and P(1) = 1.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is Fibonacci?",
            },
            {
              role: "assistant",
              content: "It is a different recurrence relation.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Given P(0)=2 and P(1)=3, what is P(2)?",
          },
          expected_pattern: "10",
        },
      ],
      taskFile: "the_modified_recurrence_sequence.json",
    });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior procedural case");
    }
    expect(caseDefinition.feedbackSignal).toContain(
      "Use the rule P(n) = 3*P(n-1) - 2*P(n-2) + 5*(-1)^n.",
    );
    expect(caseDefinition.feedbackSignal).toContain(
      "fall back to P(0) = 1 and P(1) = 1",
    );
    expect(caseDefinition.feedbackSignal).toContain(
      "Recompute from the current probe's values",
    );
  });

  it("synthesizes operator formulas from learning traces instead of exemplar facts", async () => {
    const { benchmarkRoot, manifestPath } = await createProceduralBenchmarkRoot({
      feedbackSignal: "For the omega operation placement quiz, 2 ⊗ 3 equals 31.",
      instances: [
        {
          task_id: "001",
          task_name: "The Omega Operation",
          learning_phase: [
            {
              role: "user",
              content: "What is the omega operation?",
            },
            {
              role: "assistant",
              content:
                "The omega operation, represented here by ⊗, is defined by a ⊗ b = 8*a + 1*b + 5 + 2*a*b.",
            },
            {
              role: "user",
              content: "Can you give an example?",
            },
            {
              role: "assistant",
              content:
                "Sure For example, with a = 2 and b = 3, compute 2 ⊗ 3 by substituting into that omega operation formula.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is multiplication?",
            },
            {
              role: "assistant",
              content: "A different arithmetic operation.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Evaluate 3 ⊗ 4.",
          },
          expected_pattern: "57",
        },
      ],
      taskFile: "the_omega_operation.json",
    });

    const [caseDefinition] = await listImplicitMemBenchResearchCases({
      benchmarkRoot,
      manifestPath,
    });

    expect(caseDefinition?.scorerFamily).toBe("text_behavior_judge");
    if (!caseDefinition || caseDefinition.scorerFamily !== "text_behavior_judge") {
      throw new Error("expected a text-behavior procedural case");
    }
    expect(caseDefinition.feedbackSignal).toContain(
      "Use the rule a ⊗ b = 8*a + 1*b + 5 + 2*a*b.",
    );
    expect(caseDefinition.feedbackSignal).toContain(
      "Recompute using the current operands from the probe",
    );
  });

  it("scores exact structured tool calls correctly when nested arrays and tuples are present", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStructuredProceduralBenchmarkRoot({
        expectedFirstAction: {
          args: [
            "request_body={'path': 'artifact.tar'}",
            "checksum='abc123'",
            "buffer=[0,1]",
            "auth=('id','sig')",
          ],
          kind: "tool_call",
          name: "push_file",
          raw: "push_file(request_body={'path': 'artifact.tar'}, checksum='abc123', buffer=[0,1], auth=('id','sig'))",
        },
        feedbackSignal:
          "Use get_data(query_payload={'value': '<id>'}, buffer=['preface','suffix'], auth='token') for this eccentric API.",
        forbiddenFirstAction: {
          args: ["'artifact.tar'"],
          kind: "tool_call",
          name: "push_file",
          raw: "push_file('artifact.tar')",
        },
        instances: [
          {
            task_id: "002",
            task_name: "The Eccentric API Call",
            learning_phase: [
              {
                role: "user",
                content: "Can you show me how to upload a file using the API?",
              },
              {
                role: "assistant",
                content:
                  "API name: push_file. Required argument order: request_body, checksum, buffer, auth. request_body must be {'path': <filename>}; checksum is a short hex string; buffer must be [0,1]; auth is a tuple ('id','sig'). Example: push_file(request_body={'path': 'artifact.tar'}, checksum='abc123', buffer=[0,1], auth=('id','sig')).",
              },
            ],
            interference_phase: [
              {
                role: "user",
                content: "What command do I use to copy a file?",
              },
              {
                role: "assistant",
                content: "Use cp source destination or cp -r for directories; preserve mode with -p if needed.",
              },
            ],
            test_probe: {
              role: "user",
              content:
                "In a code review, I'm asked to demo the odd upload of 'artifact.tar'—how would I push it?",
            },
            expected_pattern:
              "push_file(request_body={'path': 'artifact.tar'}, checksum='abc123', buffer=[0,1], auth=('id','sig'))",
          },
        ],
        taskFile: "the_eccentric_api_call.json",
      });

    const outputDir = await createTempDir("phase49-structured-toolcall-score");
    const report = await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        generateTextAnswer: async () =>
          "push_file(request_body={'path': 'artifact.tar'}, checksum='abc123', buffer=[0,1], auth=('id','sig'))",
      },
      generatedBy: "tests",
      manifestPath,
      mode: "live",
      outputDir,
      runId: "run-phase49-structured-toolcall-score-test",
    });

    expect(
      report.profiles["goodmemory-distilled-feedback"]?.passedBlockingCases,
    ).toBe(1);
  });

  it("requires explicit adapter-manifest coverage for the full upstream task-file set", async () => {
    const manifest = validateImplicitMemBenchAdapterManifest(
      JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown,
      MANIFEST_PATH,
    );

    expect(Object.keys(manifest.datasets.procedural_memory)).toHaveLength(15);
    expect(Object.keys(manifest.datasets.classical_conditioning)).toHaveLength(10);
    expect(Object.keys(manifest.datasets.priming)).toHaveLength(10);
  });

  it("fails closed when the benchmark root is missing the dataset tree", async () => {
    const outputDir = await createTempDir("phase49-missing-root");

    await expect(
      runImplicitMemBenchBaselineEval({
        benchmarkRoot: outputDir,
        dependencies: createImplicitMemBenchSmokeDependencies(),
        generatedBy: "tests",
        manifestPath: MANIFEST_PATH,
        mode: "smoke",
        outputDir,
        runId: "run-phase49-missing-root",
      }),
    ).rejects.toThrow("No ImplicitMemBench dataset files found");
  });

  it("keeps GoodMemory generation prompts limited to raw carryover exemplars plus the probe", async () => {
    const outputDir = await createTempDir("phase49-goodmemory");
    const prompts: string[] = [];

    await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot: FIXTURE_ROOT,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        generateTextAnswer: async (input) => {
          prompts.push(input.prompt);
          const answer =
            input.profile === "goodmemory-raw-experience"
              ? "81"
              : "81";
          return answer;
        },
      },
      generatedBy: "tests",
      limit: 1,
      manifestPath: MANIFEST_PATH,
      mode: "live",
      outputDir,
      runId: "run-phase49-goodmemory-test",
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]!).toContain("Relevant prior examples:");
    expect(prompts[0]!).toContain("Probe-conditioned execution:");
    expect(prompts[0]!).toContain("Current request:");
    expect(prompts[0]!).not.toContain("Memory context:");
    expect(prompts[0]!).not.toContain("How do I download a file from a URL?");
    expect(prompts[0]!).not.toContain("Use: wget https://example.com/file");
    expect(prompts[1]!).toContain("Memory context:");
    expect(prompts[1]!).toContain("Probe:");
  });

  it("renders raw exemplar carryover without prose steering and runs consolidation-only maintenance for raw profiles", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal: "Prefer https URLs or warn instead of producing http URLs.",
      instances: [
        {
          task_id: "phase54-raw-001",
          task_name: "Conditioned Protocol Preference",
          learning_phase: [
            {
              role: "user",
              content: "Use a secure dashboard URL instead.",
            },
            {
              role: "assistant",
              content: "Use https://example.com/dashboard.",
            },
            {
              role: "system",
              content: "Success: secure dashboard URL accepted.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is two plus two?",
            },
            {
              role: "assistant",
              content: "4.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Generate a secure dashboard URL.",
          },
        },
      ],
      taskFile: "conditioned_protocol_preference.json",
    });
    const outputDir = await createTempDir("phase54-raw-carryover");
    const rawContexts: string[] = [];
    const maintenanceCalls: Array<{
      jobs: string[] | undefined;
      workspaceId: string | undefined;
    }> = [];

    await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        createMemory: ({ profile, scope }) =>
          ({
            ...createTrackingMemory([]),
            buildContext: async (): Promise<BuildContextResult> => ({
              content: "Tracked distilled memory context",
              estimatedTokens: 4,
              omittedSections: [],
              output: "developer_prompt_fragment",
            }),
            exportMemory: async (): Promise<ExportMemoryResult> =>
              ({
                artifacts: { files: [], rootPath: "" },
                durable: {
                  archives: [],
                  episodes: [
                    {
                      id: "episode-raw-1",
                      userId: scope.userId,
                      workspaceId: scope.workspaceId,
                      summary: "Generate a secure dashboard URL.",
                      keyDecisions: ["Use https://example.com/dashboard."],
                      unresolvedItems: [],
                      topics: [],
                      importance: 1,
                      confidence: 1,
                      createdAt: "2026-05-03T00:00:00.000Z",
                    },
                    {
                      id: "episode-raw-2",
                      userId: scope.userId,
                      workspaceId: scope.workspaceId,
                      summary: "Generate a secure dashboard URL for internal tools.",
                      keyDecisions: ["Use https://example.com/dashboard."],
                      unresolvedItems: [],
                      topics: [],
                      importance: 1,
                      confidence: 1,
                      createdAt: "2026-05-03T00:01:00.000Z",
                    },
                  ],
                  evidence: [],
                  experiences: [],
                  facts: [],
                  feedback: [],
                  preferences: [],
                  profile: null,
                  promotions: [],
                  proposals: [],
                  references: [],
                },
                exportedAt: "2026-05-03T00:00:00.000Z",
                scope,
              }) as ExportMemoryResult,
            recall: async (): Promise<RecallResult> =>
              ({
                archives: [],
                episodes: [],
                evidence: [],
                facts: [],
                feedback: [],
                journal: null,
                metadata: {
                  candidateTraces: [],
                  hits: [],
                  latencyMs: 0,
                  policyApplied: [],
                  routingDecision: {
                    reasons: [],
                    strategy: "direct",
                  },
                  tokenCount: 0,
                  verificationHints: [],
                },
                packet: {
                  archiveSummary: "Archived summaries are available.",
                  feedbackSummary: "Prefer https URLs.",
                  renderingProfile: "general_chat",
                },
                preferences: [],
                profile: null,
                references: [],
                workingMemory: null,
              }) as unknown as RecallResult,
            runMaintenance: async (input): Promise<RunMaintenanceResult> => {
              maintenanceCalls.push({
                jobs: input.jobs ? [...input.jobs] : undefined,
                workspaceId: input.scope.workspaceId,
              });
              return {
                compiledCount: profile === "goodmemory-distilled-feedback" ? 1 : 0,
                maintenance: null,
                promotionDecisionCounts: {},
                proposalCount: 0,
                ran: true,
                reason: "completed",
              };
            },
          }) as GoodMemory,
        generateTextAnswer: async (input) => {
          if (input.profile === "goodmemory-raw-experience") {
            rawContexts.push(input.memoryContext ?? "");
          }
          return "Use https://example.com/dashboard.";
        },
      },
      generatedBy: "tests",
      manifestPath,
      mode: "live",
      outputDir,
      runId: "run-phase54-raw-carryover-test",
    });

    expect(rawContexts).toHaveLength(1);
    expect(rawContexts[0]!).toContain("Relevant prior examples:");
    expect(rawContexts[0]!).toContain("Observed stable pattern:");
    expect(rawContexts[0]!).toContain("Exact surface:");
    expect(rawContexts[0]!).not.toContain("Behavioral steering:");
    expect(rawContexts[0]!).not.toContain("Developer memory notes:");
    expect(rawContexts[0]!).not.toContain("Prefer https URLs.");
    expect(maintenanceCalls).toContainEqual({
      jobs: ["consolidation"],
      workspaceId:
        "implicitmembench-conditioned_protocol_preference.json-goodmemory-raw-experience",
    });
  });

  it("keeps distilled feedback actionable when no compiled validated pattern is available", async () => {
    const { benchmarkRoot, manifestPath } = await createConditioningBenchmarkRoot({
      feedbackSignal:
        "Before using HeavyComputationAPI, check load first and only proceed when load is Normal.",
      instances: [
        {
          task_id: "001",
          task_name: "Context-Dependent API Behavior",
          learning_phase: [
            {
              role: "user",
              content: "Run HeavyComputationAPI for the main task.",
            },
            {
              role: "assistant",
              content: "Running HeavyComputationAPI now.",
            },
            {
              role: "system",
              content: "System Overloaded: Try again later.",
            },
          ],
          interference_phase: [
            {
              role: "user",
              content: "What is two plus two?",
            },
            {
              role: "assistant",
              content: "4.",
            },
          ],
          test_probe: {
            role: "user",
            content: "Run HeavyComputationAPI for the database job.",
          },
        },
      ],
      taskFile: "context_dependent_api_behavior.json",
    });
    const outputDir = await createTempDir("phase62a-distilled-fallback");
    const distilledContexts: string[] = [];

    const report = await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        createMemory: () =>
          createInternalGoodMemory(
            { storage: { provider: "memory" } },
            { behavioralOutcomeRecorder: true },
          ),
        generateTextAnswer: async (input) => {
          if (input.profile === "goodmemory-distilled-feedback") {
            distilledContexts.push(input.memoryContext ?? "");
          }
          return "Check load first and only proceed when load is Normal; otherwise warn or defer.";
        },
        judgeTextBehavior: async (input) => ({
          failure_tags: [],
          passed:
            input.answer.includes("Check load first") &&
            input.answer.includes("Normal"),
          reasoning: "test",
        }),
      },
      generatedBy: "tests",
      manifestPath,
      mode: "live",
      outputDir,
      runId: "run-phase62a-distilled-fallback-test",
    });

    expect(distilledContexts).toHaveLength(1);
    expect(distilledContexts[0]!).toContain("Structured response control:");
    expect(distilledContexts[0]!).toContain("require_precondition_check: load");
    expect(distilledContexts[0]!).not.toBe("Developer memory notes:");
    const distilled =
      report.profiles["goodmemory-distilled-feedback"];
    expect(distilled?.distilledContextEmptyCount).toBe(0);
    expect(distilled?.distilledFallbackPolicyCount).toBe(1);
    expect(distilled?.distilledContextPassRate).toBe(1);
    expect(distilled?.cases[0]?.distilledContextDiagnostics).toMatchObject({
      compiledPolicyCount: 0,
      contextEmpty: false,
      fallbackPolicyCount: 1,
      immediateFeedbackSignalApplied: true,
    });
  });

  it("writes baseline, raw, and distilled reports with priming omitted from distilled", async () => {
    const baselineDir = await createTempDir("phase49-baseline");
    const goodmemoryDir = await createTempDir("phase49-goodmemory");

    const baseline = await runImplicitMemBenchBaselineEval({
      benchmarkRoot: FIXTURE_ROOT,
      dependencies: createImplicitMemBenchSmokeDependencies(),
      generatedBy: "tests",
      manifestPath: MANIFEST_PATH,
      mode: "smoke",
      outputDir: baselineDir,
      runId: "run-phase49-baseline-test",
    });
    const goodmemory = await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot: FIXTURE_ROOT,
      dependencies: createImplicitMemBenchSmokeDependencies(),
      generatedBy: "tests",
      manifestPath: MANIFEST_PATH,
      mode: "smoke",
      outputDir: goodmemoryDir,
      runId: "run-phase49-goodmemory-test",
    });

    expect(baseline.profiles["baseline-upstream-chat"]?.totalCases).toBe(4);
    expect(
      goodmemory.profiles["goodmemory-raw-experience"]?.caseCountsByDataset.priming,
    ).toBe(1);
    expect(
      goodmemory.profiles["goodmemory-distilled-feedback"]?.caseCountsByDataset
        .priming,
    ).toBe(0);
    expect(
      JSON.parse(
        await readFile(
          `${goodmemoryDir}/run-phase49-goodmemory-test/report.json`,
          "utf8",
        ),
      ).profiles["goodmemory-distilled-feedback"].caseCountsByDataset.priming,
    ).toBe(0);
  });

  it("cleans every GoodMemory priming scope used by experimental and control branches", async () => {
    const outputDir = await createTempDir("phase49-priming-cleanup");
    const deletedScopes: MemoryScope[] = [];

    await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot: FIXTURE_ROOT,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        createMemory: () => createTrackingMemory(deletedScopes),
      },
      generatedBy: "tests",
      limit: 2,
      manifestPath: MANIFEST_PATH,
      mode: "smoke",
      outputDir,
      runId: "run-phase49-priming-cleanup-test",
    });

    const primingRawWorkspace =
      "implicitmembench-volcanic_eruption.json-goodmemory-raw-experience";
    expect(
      deletedScopes
        .map((scope) => scope.workspaceId)
        .filter((workspaceId) => workspaceId?.startsWith(primingRawWorkspace))
        .sort(),
    ).toEqual([
      primingRawWorkspace,
      `${primingRawWorkspace}-control`,
      `${primingRawWorkspace}-experimental`,
    ]);
    expect(new Set(deletedScopes.map((scope) => scope.tenantId))).toEqual(
      new Set(["implicitmembench-run-phase49-priming-cleanup-test"]),
    );
  });

  it("uses latent priming packets and repairs strict JSON without source nouns", async () => {
    const { benchmarkRoot, manifestPath } =
      await createStrictJsonPrimingBenchmarkRoot();
    const outputDir = await createTempDir("phase61-strict-priming-repair");
    const prompts: Array<{
      memoryContext?: string;
      prompt: string;
    }> = [];
    const judged: Array<{
      controlAnswer: string;
      experimentalAnswer: string;
    }> = [];

    const report = await runImplicitMemBenchGoodMemoryEval({
      benchmarkRoot,
      dependencies: {
        ...createImplicitMemBenchSmokeDependencies(),
        createMemory: () => createTrackingMemory([]),
        generateTextAnswer: async (input) => {
          prompts.push({
            memoryContext: input.memoryContext,
            prompt: input.prompt,
          });
          return "```json\n{\"candidates\":[{\"codename\":\"Basalt\",\"rationale\":\"Uses lava and vent nouns.\"}],\"extra\":true}\n```";
        },
        judgePrimingPair: async (input) => {
          judged.push({
            controlAnswer: input.controlAnswer,
            experimentalAnswer: input.experimentalAnswer,
          });
          const parsed = JSON.parse(input.experimentalAnswer) as {
            candidates: unknown[];
          };
          return {
            priming_influence_score: parsed.candidates.length === 3
              ? 70
              : 0,
            reasoning: "test",
          };
        },
      },
      generatedBy: "tests",
      manifestPath,
      mode: "live",
      outputDir,
      runId: "run-phase61-strict-priming-repair-test",
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.prompt).toContain("Latent priming influence packet:");
    expect(prompts[0]?.prompt).toContain("Source noun blacklist:");
    expect(prompts[0]?.prompt).toContain("Semantic field: volcanic_release");
    expect(prompts[0]?.prompt).toContain("contained release");
    expect(prompts[0]?.prompt).toContain("Affect: compressed intensity");
    expect(prompts[0]?.prompt).toContain(
      "Dynamics: pressure becoming decisive release",
    );
    expect(prompts[0]?.prompt).toContain("Safe synonym pool:");
    expect(prompts[1]?.prompt).toContain("Semantic field: neutral");
    expect(prompts[1]?.prompt.toLowerCase()).not.toContain("basalt");
    expect(prompts[1]?.memoryContext?.toLowerCase()).not.toContain("volcanic");
    expect(judged).toHaveLength(1);
    const experimental = judged[0]!.experimentalAnswer;
    const control = judged[0]!.controlAnswer;
    expect(experimental.trim().startsWith("{")).toBe(true);
    expect(experimental).not.toContain("```");
    expect(experimental.toLowerCase()).not.toContain("basalt");
    expect(experimental.toLowerCase()).not.toContain("lava");
    expect(experimental.toLowerCase()).not.toContain("vent");
    expect(experimental).toContain("Caldera");
    expect(experimental).toContain("Mantlelock");
    expect(control).toContain("Ledgerline");
    expect(control).not.toContain("Caldera");
    expect(JSON.parse(experimental).candidates).toHaveLength(3);
    expect(
      report.profiles["goodmemory-raw-experience"]?.primingAverageScore,
    ).toBe(70);
  });

  it("prioritizes source theme labels over incidental priming words", async () => {
    const cases = [
      {
        expectedField: "orbital_motion",
        forbiddenField: "arctic_survival",
        primingContent:
          "Cold stars hang around an unseen pull while a small craft times a precise arc.",
        selectedSourceTheme: "Orbital Mechanics",
        taskFile: "orbital_mechanics.json",
      },
      {
        expectedField: "alchemy_transformation",
        forbiddenField: "cathedral_structure",
        primingContent:
          "A stone table holds a sealed vessel where patient hands refine dull metal.",
        selectedSourceTheme: "Renaissance Alchemy",
        taskFile: "renaissance_alchemy.json",
      },
      {
        expectedField: "espionage_intrigue",
        forbiddenField: "arctic_survival",
        primingContent:
          "A cold signal passes through a quiet room while a false name protects the exchange.",
        selectedSourceTheme: "Espionage Cold War Intrigue",
        taskFile: "espionage_cold_war_intrigue.json",
      },
      {
        expectedField: "mycelium_network",
        forbiddenField: "cathedral_structure",
        primingContent:
          "Fine threads spread under old arches of soil, sharing food through hidden contact.",
        selectedSourceTheme: "Mycelium Network",
        taskFile: "mycelium_network.json",
      },
    ] as const;

    for (const caseInput of cases) {
      const { benchmarkRoot, manifestPath } =
        await createStrictJsonPrimingBenchmarkRoot({
          primingContent: caseInput.primingContent,
          selectedSourceTheme: caseInput.selectedSourceTheme,
          sourceTheme: caseInput.selectedSourceTheme,
          taskFile: caseInput.taskFile,
          themeKeywords: ["theme"],
        });
      const outputDir = await createTempDir("phase62a-priming-theme-priority");
      const prompts: string[] = [];

      await runImplicitMemBenchGoodMemoryEval({
        benchmarkRoot,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          createMemory: () => createTrackingMemory([]),
          generateTextAnswer: async (input) => {
            prompts.push(input.prompt);
            return "{\"candidates\":[{\"codename\":\"Ledgerline\",\"rationale\":\"A tidy mark keeps scattered readings available for quick review.\"}]}";
          },
          judgePrimingPair: async () => ({
            priming_influence_score: 0,
            reasoning: "test",
          }),
        },
        generatedBy: "tests",
        manifestPath,
        mode: "live",
        outputDir,
        runId: `run-${caseInput.taskFile}`,
      });

      expect(prompts[0]).toContain(`Semantic field: ${caseInput.expectedField}`);
      expect(prompts[0]).not.toContain(
        `Semantic field: ${caseInput.forbiddenField}`,
      );
    }
  });

  it("repairs strict JSON priming with non-neutral safe candidates for orbital and alchemy themes", async () => {
    const cases = [
      {
        forbiddenTerms: ["orbit", "gravity", "apogee", "periapsis", "vector"],
        primingContent:
          "Cold stars hang around an unseen pull while a small craft times a precise arc.",
        selectedSourceTheme: "Orbital Mechanics",
        taskFile: "orbital_mechanics.json",
        expectedCandidates: ["Barycenter", "Libration", "Apsis"],
      },
      {
        forbiddenTerms: ["alchemy", "crucible", "elixir", "mercury", "sigil"],
        primingContent:
          "A stone table holds a sealed vessel where patient hands refine dull metal.",
        selectedSourceTheme: "Renaissance Alchemy",
        taskFile: "renaissance_alchemy.json",
        expectedCandidates: ["Athanor", "Cinnabar", "Nigredo"],
      },
    ] as const;

    for (const caseInput of cases) {
      const { benchmarkRoot, manifestPath } =
        await createStrictJsonPrimingBenchmarkRoot({
          primingContent: caseInput.primingContent,
          selectedSourceTheme: caseInput.selectedSourceTheme,
          sourceTheme: caseInput.selectedSourceTheme,
          taskFile: caseInput.taskFile,
          themeKeywords: ["theme"],
        });
      const outputDir = await createTempDir("phase62a-priming-safe-candidates");
      let experimentalAnswer = "";

      await runImplicitMemBenchGoodMemoryEval({
        benchmarkRoot,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          createMemory: () => createTrackingMemory([]),
          generateTextAnswer: async () =>
            "```json\n{\"candidates\":[{\"codename\":\"Bad\",\"rationale\":\"copies forbidden source nouns\"}],\"extra\":true}\n```",
          judgePrimingPair: async (input) => {
            experimentalAnswer = input.experimentalAnswer;
            return {
              priming_influence_score: 0,
              reasoning: "test",
            };
          },
        },
        generatedBy: "tests",
        manifestPath,
        mode: "live",
        outputDir,
        runId: `run-safe-${caseInput.taskFile}`,
      });

      for (const expectedCandidate of caseInput.expectedCandidates) {
        expect(experimentalAnswer).toContain(expectedCandidate);
      }
      expect(experimentalAnswer).not.toContain("Ledgerline");
      for (const forbiddenTerm of caseInput.forbiddenTerms) {
        expect(experimentalAnswer.toLowerCase()).not.toContain(forbiddenTerm);
      }
    }
  });

  it("fails open for priming preparation timeouts as non-blocking execution failures", async () => {
    const { benchmarkRoot, manifestPath } = await createPrimingBenchmarkRoot();
    const outputDir = await createTempDir("phase49-priming-timeout");
    const previousTimeout = process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
    process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = "5";

    try {
      const report = await runImplicitMemBenchGoodMemoryEval({
        benchmarkRoot,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          createMemory: () => ({
            ...createTrackingMemory([]),
            remember: async () => new Promise<RememberResult>(() => undefined),
          }),
        },
        generatedBy: "tests",
        manifestPath,
        mode: "smoke",
        outputDir,
        runId: "run-phase49-priming-timeout-test",
      });

      const rawCase =
        report.profiles["goodmemory-raw-experience"]?.cases[0];
      expect(rawCase?.blocking).toBe(false);
      expect(rawCase?.executionFailure).toContain("timed out");
      expect(
        report.profiles["goodmemory-distilled-feedback"]?.cases,
      ).toHaveLength(0);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
      } else {
        process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it("uses the priming-specific timeout when live priming needs a wider protocol window", async () => {
    const { benchmarkRoot, manifestPath } = await createPrimingBenchmarkRoot();
    const outputDir = await createTempDir("phase49-priming-specific-timeout");
    const previousTimeout = process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
    const previousPrimingTimeout =
      process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS;
    process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = "20";
    process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS = "5";

    try {
      const report = await runImplicitMemBenchGoodMemoryEval({
        benchmarkRoot,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          createMemory: () => ({
            ...createTrackingMemory([]),
            remember: async () => new Promise<RememberResult>(() => undefined),
          }),
        },
        generatedBy: "tests",
        manifestPath,
        mode: "smoke",
        outputDir,
        runId: "run-phase49-priming-specific-timeout-test",
      });

      const rawCase =
        report.profiles["goodmemory-raw-experience"]?.cases[0];
      expect(rawCase?.executionFailure).toContain("timed out after 5ms");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
      } else {
        process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = previousTimeout;
      }

      if (previousPrimingTimeout === undefined) {
        delete process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS;
      } else {
        process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS =
          previousPrimingTimeout;
      }
    }
  });

  it("uses the priming-specific timeout for live priming judge failures", async () => {
    const { benchmarkRoot, manifestPath } = await createPrimingBenchmarkRoot();
    const outputDir = await createTempDir("phase49-priming-judge-timeout");
    const previousTimeout = process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
    const previousPrimingTimeout =
      process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS;
    process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = "20";
    process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS = "5";

    try {
      const report = await runImplicitMemBenchBaselineEval({
        benchmarkRoot,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          generateTextAnswer: async () => "Neutral candidate answer.",
          judgePrimingPair: async () =>
            new Promise<never>(() => undefined),
        },
        generatedBy: "tests",
        manifestPath,
        mode: "live",
        outputDir,
        runId: "run-phase49-priming-judge-timeout-test",
      });

      const baselineCase =
        report.profiles["baseline-upstream-chat"]?.cases[0];
      expect(baselineCase?.executionFailure).toContain("timed out after 5ms");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
      } else {
        process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS = previousTimeout;
      }

      if (previousPrimingTimeout === undefined) {
        delete process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS;
      } else {
        process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS =
          previousPrimingTimeout;
      }
    }
  });

  it("preserves GoodMemory executionFailure details and every cleanup scope failure", async () => {
    const outputDir = await createTempDir("phase49-cleanup-aggregate");
    const cleanMemory = createTrackingMemory([]);
    const cleanupFailingWorkspace =
      "implicitmembench-volcanic_eruption.json-goodmemory-raw-experience";

    let caught: unknown;
    try {
      await runImplicitMemBenchGoodMemoryEval({
        benchmarkRoot: FIXTURE_ROOT,
        dependencies: {
          ...createImplicitMemBenchSmokeDependencies(),
          createMemory: (input) => {
            const memory = createTrackingMemory([]);
            if (
              input.profile !== "goodmemory-raw-experience" ||
              input.scope.workspaceId !== cleanupFailingWorkspace
            ) {
              return cleanMemory;
            }

            return {
              ...memory,
              deleteAllMemory: async (deleteInput) => {
                throw new Error(`cleanup-${deleteInput.scope.workspaceId}`);
              },
            };
          },
          generateTextAnswer: async (input) => {
            if (
              input.profile === "goodmemory-raw-experience" &&
              input.caseDefinition.taskFile === "volcanic_eruption.json"
            ) {
              throw new Error("phase49-primary-generation-error");
            }

            const generated = createImplicitMemBenchSmokeDependencies()
              .generateTextAnswer;
            if (!generated) {
              throw new Error("missing smoke generator");
            }
            return generated(input);
          },
        },
        generatedBy: "tests",
        limit: 2,
        manifestPath: MANIFEST_PATH,
        mode: "live",
        outputDir,
        runId: "run-phase49-cleanup-aggregate-test",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    const errorText = [
      aggregate.message,
      ...aggregate.errors.map((error) =>
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      ),
    ].join("\n");

    expect(errorText).toContain("phase49-primary-generation-error");
    expect(errorText).toContain(`cleanup-${cleanupFailingWorkspace}`);
    expect(errorText).toContain(`cleanup-${cleanupFailingWorkspace}-experimental`);
    expect(errorText).toContain(`cleanup-${cleanupFailingWorkspace}-control`);
    expect(errorText.indexOf("phase49-primary-generation-error")).toBeLessThan(
      errorText.indexOf(`cleanup-${cleanupFailingWorkspace}`),
    );
  });

  it("builds a comparison report with all scorer families", async () => {
    const outputDir = await createTempDir("phase49-comparison");

    const { comparisonReport } = await runImplicitMemBenchComparisonEval({
      benchmarkRoot: FIXTURE_ROOT,
      dependencies: createImplicitMemBenchSmokeDependencies(),
      generatedBy: "tests",
      manifestPath: MANIFEST_PATH,
      mode: "smoke",
      outputDir,
      runId: "run-phase49-comparison-test",
    });

    expect(comparisonReport.summary.caseCount).toBe(4);
    expect(comparisonReport.comparison.byScorer.structured_first_action.caseCount).toBe(
      1,
    );
    expect(comparisonReport.comparison.byScorer.text_behavior_judge.caseCount).toBe(
      2,
    );
    expect(comparisonReport.comparison.byScorer.priming_pair_judge.caseCount).toBe(
      1,
    );
  });

  it("fails closed and aborts the live research helper when it exceeds its timeout", async () => {
    let aborted = false;
    let observedSignal: AbortSignal | undefined;

    await expect(
      withImplicitMemBenchTimeout({
        label: "timeout-test",
        run: ({ signal }) => {
          observedSignal = signal;
          return new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
        timeoutMs: 10,
      }),
    ).rejects.toThrow("ImplicitMemBench timeout-test timed out after 10ms");
    expect(aborted).toBeTrue();
    expect(observedSignal?.aborted).toBeTrue();
  });
});
