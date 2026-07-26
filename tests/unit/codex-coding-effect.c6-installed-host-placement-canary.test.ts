import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE,
  C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_HISTORY_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
  C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE,
  C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
  C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
  buildC6InstalledHostPlacementFlatSummaryControl,
  buildC6InstalledHostPlacementFlatSummaryHookConfig,
  buildC6InstalledHostPlacementCodexArguments,
  buildC6InstalledHostPlacementCodexConfig,
  buildC6InstalledHostPlacementMirrorHookConfig,
  buildC6InstalledHostPlacementRecommendedCodexConfig,
  buildC6InstalledHostRequestPlacement,
  verifyC6InstalledHostPlacementCanary,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-canary";
import type {
  C6InstalledHostPlacementCanary,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-canary";
import {
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  countC6InjectedTokens,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import {
  C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
  C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
  C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
  C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
  C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256,
  verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-linux";

const MODEL = "c6-placement-loopback";
const PROMPT =
  "What blocks the c6 workspace deployment? "
  + "Reply using the remembered blocker.";
const SESSION_CONTEXT =
  `Developer memory notes:\nEvidence: ${C6_INSTALLED_HOST_PLACEMENT_SENTINEL} session`;
const PROMPT_CONTEXT =
  `Developer memory notes:\nFacts: ${C6_INSTALLED_HOST_PLACEMENT_SENTINEL} prompt`;

describe("Codex coding-effect C6 installed-host placement canary", () => {
  it("projects the exact native request positions around the original prompt", () => {
    const rawRequestBody = requestBody({
      root: "/work/run-a",
      withContexts: true,
    });

    expect(buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody,
    })).toEqual({
      baseRequestSha256: sha256(canonicalJson(JSON.parse(requestBody({
        root: "/work/run-a",
        withContexts: false,
      })))),
      contextSegments: [
        {
          additionalContextSha256: sha256(SESSION_CONTEXT),
          eventName: "SessionStart",
          injectedTokenCount: countC6InjectedTokens(SESSION_CONTEXT),
          jsonPointer: "/input/2/content/0/text",
          messageIndex: 2,
          relativeToOriginalPrompt: "immediately-before",
          role: "developer",
          text: SESSION_CONTEXT,
        },
        {
          additionalContextSha256: sha256(PROMPT_CONTEXT),
          eventName: "UserPromptSubmit",
          injectedTokenCount: countC6InjectedTokens(PROMPT_CONTEXT),
          jsonPointer: "/input/4/content/0/text",
          messageIndex: 4,
          relativeToOriginalPrompt: "immediately-after",
          role: "developer",
          text: PROMPT_CONTEXT,
        },
      ],
      model: MODEL,
      originalPromptIndex: 3,
      originalPromptJsonPointer: "/input/3/content/0/text",
      originalPromptSha256: sha256(PROMPT),
      rawRequestBodySha256: sha256(rawRequestBody),
    });
  });

  it("accepts two structural capture envelopes without promoting C6 readiness", () => {
    const artifact = fixture();

    expect(verifyC6InstalledHostPlacementCanary(artifact)).toEqual({
      captureEnvelopeCount: 2,
      c6T003Complete: false,
      codexRunReady: false,
      finalInstalledHostProfileProven: false,
      flatSummaryPlacementParityProven: false,
      flatSummaryHookProjectionStructurallyBound: true,
      goodMemoryHookProjectionStructurallyBound: true,
      mirroredHookProjectionStructurallyBound: true,
      rawCaptureBytesStructurallyIncluded: true,
      requestCount: 8,
      semanticProjectionStableAcrossTwoCaptureEnvelopes: true,
    });
  });

  it("requires persisted captures to bind the current Linux runner", () => {
    const artifact = fixture();
    expect(verifyC6InstalledHostPlacementCanary(artifact)).toBeDefined();
    expect(() =>
      verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner(
        artifact,
      )
    ).toThrow("current runner");

    artifact.frozen.runnerSourceSha256 =
      C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256;
    for (const capture of artifact.captures) {
      capture.observed.runnerSourceSha256 =
        C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256;
    }
    expect(
      verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner(
        artifact,
      ),
    ).toEqual(verifyC6InstalledHostPlacementCanary(artifact));

    const identityMutations: Array<
      (forged: C6InstalledHostPlacementCanary) => void
    > = [
      (forged) => {
        const value = sha256("forged-package");
        forged.frozen.goodmemory.packageSha256 = value;
        for (const capture of forged.captures) {
          capture.observed.goodmemoryPackageSha256 = value;
        }
      },
      (forged) => {
        const value = sha256("forged-image");
        forged.frozen.imageSha256 = value;
        for (const capture of forged.captures) {
          capture.observed.imageSha256 = value;
        }
      },
      (forged) => {
        const value = sha256("forged-codex-main");
        forged.frozen.codex.mainTarballSha256 = value;
        for (const capture of forged.captures) {
          capture.observed.codexMainTarballSha256 = value;
        }
      },
      (forged) => {
        const value = sha256("forged-codex-linux");
        forged.frozen.codex.linuxTarballSha256 = value;
        for (const capture of forged.captures) {
          capture.observed.codexLinuxTarballSha256 = value;
        }
      },
      (forged) => {
        forged.frozen.codex.version = "codex-cli 0.146.0";
        for (const capture of forged.captures) {
          capture.observed.codexVersion = "codex-cli 0.146.0";
        }
      },
      (forged) => {
        forged.frozen.goodmemory.version = "0.8.0";
        for (const capture of forged.captures) {
          capture.observed.goodmemoryVersion = "0.8.0";
        }
      },
    ];
    for (const mutateIdentity of identityMutations) {
      const forged = structuredClone(artifact);
      mutateIdentity(forged);
      expect(
        verifyC6InstalledHostPlacementCanary(forged),
      ).toBeDefined();
      expect(() =>
        verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner(
          forged,
        )
      ).toThrow("current runner");
    }
  });

  it("normalizes only internally consistent Codex transport identities", () => {
    const first = buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody: requestBody({
        root: "/work/run-a",
        transport: {
          installationId: "installation-a",
          threadId: "thread-a",
          turnId: "turn-a",
          turnStartedAtUnixMs: 100,
        },
        withContexts: true,
      }),
    });
    const second = buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody: requestBody({
        root: "/work/run-a",
        transport: {
          installationId: "installation-b",
          threadId: "thread-b",
          turnId: "turn-b",
          turnStartedAtUnixMs: 200,
        },
        withContexts: true,
      }),
    });
    expect(first.baseRequestSha256).toBe(second.baseRequestSha256);
    expect(first.rawRequestBodySha256).not.toBe(
      second.rawRequestBodySha256,
    );

    const inconsistent = JSON.parse(requestBody({
      root: "/work/run-a",
      withContexts: true,
    })) as {
      client_metadata: { thread_id: string };
    };
    inconsistent.client_metadata.thread_id = "forged-thread";
    expect(() => buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody: JSON.stringify(inconsistent),
    })).toThrow("transport identity");
  });

  it("rejects request placement, hook, identity, isolation, and replay drift", () => {
    const mutations: Array<
      (artifact: C6InstalledHostPlacementCanary) => void
    > = [
      (artifact) => {
        artifact.captures[0].arms.goodmemory.rawRequestBody = requestBody({
          root: "/work/run-a",
          withContexts: true,
          wrongSessionRole: true,
        });
      },
      (artifact) => {
        const request = JSON.parse(
          artifact.captures[0].arms.goodmemory.rawRequestBody,
        ) as {
          input: Array<{ content: Array<{ text: string }> }>;
        };
        request.input[2]!.content[0]!.text = PROMPT_CONTEXT;
        artifact.captures[0].arms.goodmemory.rawRequestBody =
          JSON.stringify(request);
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.hookEvents.reverse();
      },
      (artifact) => {
        artifact.captures[0].arms.mirroredHook.hookEvents[1]!.rawOutput =
          hookOutput("UserPromptSubmit", `${PROMPT_CONTEXT} drift`);
      },
      (artifact) => {
        const flat = artifact.captures[0].arms.flatSummaryHook;
        const drifted = `${C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT} drift`;
        flat.hookEvents[1]!.rawOutput =
          hookOutput("UserPromptSubmit", drifted);
        const request = JSON.parse(flat.rawRequestBody) as {
          input: Array<{ content: Array<{ text: string }> }>;
        };
        request.input[4]!.content[0]!.text = drifted;
        flat.rawRequestBody = JSON.stringify(request);
      },
      (artifact) => {
        artifact.captures[0].arms.flatSummaryHook
          .hookEvents[1]!.maxTokens = 1024;
      },
      (artifact) => {
        const flat = artifact.captures[0].arms.flatSummaryHook;
        const request = JSON.parse(flat.rawRequestBody) as {
          input: Array<{
            content: Array<{ text: string }>;
            role: string;
          }>;
        };
        request.input[2]!.role = "user";
        flat.rawRequestBody = JSON.stringify(request);
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.flatSummaryHook.hookEvents[1]!;
        const input = JSON.parse(event.rawInput) as {
          prompt: string;
        };
        input.prompt = "different prompt";
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        artifact.transport.flatSummaryHookConfigSource =
          artifact.transport.flatSummaryHookConfigSource.replace(
            "flat-summary-hook.mjs SessionStart",
            "forged-hook.mjs SessionStart",
          );
        artifact.transport.flatSummaryHookConfigSourceSha256 =
          sha256(artifact.transport.flatSummaryHookConfigSource);
      },
      (artifact) => {
        artifact.transport.flatSummaryHookRunnerSource +=
          "\n// drift";
        artifact.transport.flatSummaryHookRunnerSourceSha256 =
          sha256(artifact.transport.flatSummaryHookRunnerSource);
      },
      (artifact) => {
        artifact.flatSummaryControl.eventBudgets[1]!
          .budgetReceipt.contentSha256 = sha256("forged output");
      },
      (artifact) => {
        artifact.captures[0].arms.flatSummaryHook.stopHookEvent =
          structuredClone(
            artifact.captures[0].arms.goodmemory.stopHookEvent,
          );
      },
      (artifact) => {
        artifact.boundary.flatSummaryPlacementParityProven =
          true as unknown as false;
      },
      (artifact) => {
        artifact.flatSummaryControl.providerArtifactBound =
          true as unknown as false;
      },
      (artifact) => {
        artifact.captures[0].arms.hooksDisabled.rawRequestBody = requestBody({
          root: "/work/run-a",
          withContexts: true,
        });
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.requestCount =
          2 as unknown as 1;
      },
      (artifact) => {
        artifact.captures[0].environment.networkMode =
          "bridge" as unknown as "none";
      },
      (artifact) => {
        artifact.captures[1].declaredFreshRootIdentitySha256 =
          artifact.captures[0].declaredFreshRootIdentitySha256;
      },
      (artifact) => {
        artifact.captures[1].observed.codexVersion = "codex-cli 0.146.0";
      },
      (artifact) => {
        artifact.profile.maxTokens = 1 as unknown as 512;
      },
      (artifact) => {
        const source = JSON.parse(artifact.profile.source) as {
          maxTokens: number;
          sessionStartMaxTokens: number;
        };
        source.maxTokens = 768;
        source.sessionStartMaxTokens = 1536;
        artifact.profile.maxTokens = 768 as unknown as 512;
        artifact.profile.sessionStartMaxTokens =
          1536 as unknown as 1024;
        artifact.profile.source = `${JSON.stringify(source, null, 2)}\n`;
        artifact.profile.sourceSha256 =
          sha256(artifact.profile.source);
        artifact.profile.normalizedSha256 =
          sha256(canonicalJson(source));
        artifact.flatSummaryControl.eventBudgets[0]!
          .budgetReceipt.maxInjectedTokens = 1536;
        artifact.flatSummaryControl.eventBudgets[1]!
          .budgetReceipt.maxInjectedTokens = 768;
        for (const capture of artifact.captures) {
          for (const arm of [
            capture.arms.flatSummaryHook,
            capture.arms.goodmemory,
            capture.arms.mirroredHook,
          ]) {
            arm.hookEvents[0]!.maxTokens = 1536;
            arm.hookEvents[1]!.maxTokens = 768;
          }
        }
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.rawRequestBody =
          JSON.stringify({
            ...JSON.parse(
              artifact.captures[0].arms.goodmemory.rawRequestBody,
            ) as object,
            model: "other-model",
          });
      },
      (artifact) => {
        artifact.boundary.codexRunReady =
          true as unknown as false;
      },
      (artifact) => {
        for (const run of artifact.captures) {
          run.arms.hooksDisabled.originalPrompt = "different prompt";
          run.arms.hooksDisabled.rawRequestBody =
            run.arms.hooksDisabled.rawRequestBody.replace(
              PROMPT,
              "different prompt",
            );
        }
      },
      (artifact) => {
        const parsed = JSON.parse(
          artifact.captures[0].arms.hooksDisabled.rawRequestBody,
        ) as { input: Array<{ content: Array<{ text: string }> }> };
        parsed.input[0]!.content[0]!.text =
          `wrapper:${SESSION_CONTEXT}`;
        artifact.captures[0].arms.hooksDisabled.rawRequestBody =
          JSON.stringify(parsed);
      },
      (artifact) => {
        const parsed = JSON.parse(
          artifact.captures[0].arms.hooksDisabled.rawRequestBody,
        ) as Record<string, unknown>;
        parsed.instructions = `${SESSION_CONTEXT}\n${PROMPT_CONTEXT}`;
        artifact.captures[0].arms.hooksDisabled.rawRequestBody =
          JSON.stringify(parsed);
      },
      (artifact) => {
        const parsed = JSON.parse(
          artifact.captures[0].arms.mirroredHook.rawRequestBody,
        ) as { input: Array<{ content: Array<{ text: string }> }> };
        parsed.input[0]!.content[0]!.text = "different built-in context";
        artifact.captures[0].arms.mirroredHook.rawRequestBody =
          JSON.stringify(parsed);
      },
      (artifact) => {
        artifact.captures[1].arms =
          structuredClone(artifact.captures[0].arms);
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.codexJsonl =
          '{"type":"turn.completed"}\n'
          + '{"type":"item.completed","item":{"type":"error"}}\n'
          + '{"type":"thread.started"}\n';
      },
      (artifact) => {
        const parsed = JSON.parse(
          artifact.captures[0].arms.goodmemory.hookEvents[0]!.rawInput,
        ) as Record<string, unknown>;
        delete parsed.cwd;
        delete parsed.session_id;
        artifact.captures[0].arms.goodmemory.hookEvents[0]!.rawInput =
          JSON.stringify(parsed);
      },
      (artifact) => {
        const source = JSON.parse(artifact.profile.source) as {
          promptInjection: string;
        };
        source.promptInjection = "relevance_gated";
        artifact.profile.source = JSON.stringify(source);
        artifact.profile.sourceSha256 = sha256(artifact.profile.source);
        artifact.profile.normalizedSha256 =
          sha256(canonicalJson(source));
      },
      (artifact) => {
        artifact.profile.sourceSha256 = sha256("other-profile");
      },
      (artifact) => {
        artifact.profile.goodmemoryHookConfig =
          artifact.profile.goodmemoryHookConfig.replace(
            "goodmemory codex hook session-start",
            "printf forged-session-start",
          );
        artifact.profile.goodmemoryHookConfigSha256 =
          sha256(artifact.profile.goodmemoryHookConfig);
      },
      (artifact) => {
        for (const arm of Object.values(artifact.captures[0].arms)) {
          const parsed = JSON.parse(arm.rawRequestBody) as
            Record<string, unknown>;
          parsed.instructions =
            `${SESSION_CONTEXT}\n${PROMPT_CONTEXT}`;
          arm.rawRequestBody = JSON.stringify(parsed);
        }
      },
      (artifact) => {
        const config = JSON.parse(
          artifact.profile.goodmemoryHookConfig,
        ) as {
          hooks: {
            SessionStart: Array<{
              hooks: Array<Record<string, unknown>>;
            }>;
          };
        };
        config.hooks.SessionStart[0]!.hooks[0]!.async = true;
        config.hooks.SessionStart[0]!.hooks[0]!.timeout = 0;
        artifact.profile.goodmemoryHookConfig =
          JSON.stringify(config);
        artifact.profile.goodmemoryHookConfigSha256 =
          sha256(artifact.profile.goodmemoryHookConfig);
      },
      (artifact) => {
        const parsed = JSON.parse(
          artifact.captures[0].arms.goodmemory.hookEvents[1]!.rawInput,
        ) as Record<string, unknown>;
        parsed.cwd = "/work/other-workspace";
        artifact.captures[0].arms.goodmemory.hookEvents[1]!.rawInput =
          JSON.stringify(parsed);
      },
      (artifact) => {
        const threadId =
          "run-a-goodmemory-installed";
        artifact.captures[0].arms.goodmemory.codexJsonl =
          `{"type":"thread.started","thread_id":"${threadId}"}\n`
          + '{"type":"turn.started"}\n'
          + '{"type":"error","message":"failed"}\n'
          + '{"type":"turn.completed"}\n';
      },
      (artifact) => {
        artifact.captures[1].arms =
          structuredClone(artifact.captures[0].arms);
        artifact.captures[1].arms.goodmemory.codexJsonl =
          artifact.captures[1].arms.goodmemory.codexJsonl.replace(
            "run-a-goodmemory-installed",
            "run-b-goodmemory-installed",
          );
      },
      (artifact) => {
        for (const event of
          artifact.captures[0].arms.mirroredHook.hookEvents) {
          const parsed = JSON.parse(event.rawInput) as
            Record<string, unknown>;
          parsed.cwd = "/work/other-workspace";
          event.rawInput = JSON.stringify(parsed);
        }
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.goodmemory.hookEvents[0]!;
        const parsed = JSON.parse(event.rawInput) as
          Record<string, unknown>;
        parsed.source = "compact";
        event.rawInput = JSON.stringify(parsed);
      },
      (artifact) => {
        const arm = artifact.captures[0].arms.goodmemory;
        arm.codexJsonl = arm.codexJsonl.replace(
          '{"type":"turn.completed"',
          '{"type":"transport.error"}\n{"type":"turn.completed"',
        );
      },
      (artifact) => {
        artifact.transport.codexConfigSource =
          artifact.transport.codexConfigSource.replace(
            "[mcp_servers.goodmemory]",
            "[mcp_servers.removed]",
          );
        artifact.transport.codexConfigSourceSha256 =
          sha256(artifact.transport.codexConfigSource);
      },
      (artifact) => {
        artifact.transport.hooksDisabledArguments[0] = "--enable";
      },
      (artifact) => {
        artifact.transport.mirroredHookConfigSource =
          artifact.transport.mirroredHookConfigSource.replace(
            "mirror-hook.mjs SessionStart",
            "forged-hook.mjs SessionStart",
          );
        artifact.transport.mirroredHookConfigSourceSha256 =
          sha256(artifact.transport.mirroredHookConfigSource);
      },
      (artifact) => {
        artifact.transport.mirroredHookRunnerSource +=
          "\n// drift";
        artifact.transport.mirroredHookRunnerSourceSha256 =
          sha256(artifact.transport.mirroredHookRunnerSource);
      },
      (artifact) => {
        artifact.transport.goodmemoryWrapperSource +=
          "\n# drift";
        artifact.transport.goodmemoryWrapperSourceSha256 =
          sha256(artifact.transport.goodmemoryWrapperSource);
      },
      (artifact) => {
        const arm = artifact.captures[0].arms.goodmemory;
        arm.codexJsonl = arm.codexJsonl.replace(
          '{"type":"turn.completed"',
          '{"message":"silent malformed error"}\n'
          + '{"type":"turn.completed"',
        );
      },
      (artifact) => {
        const source = JSON.parse(artifact.profile.source) as {
          activationMode: string;
        };
        source.activationMode = "disabled";
        artifact.profile.source = JSON.stringify(source);
        artifact.profile.sourceSha256 = sha256(artifact.profile.source);
        artifact.profile.normalizedSha256 =
          sha256(canonicalJson(source));
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.goodmemory.hookEvents[0]!;
        const input = JSON.parse(event.rawInput) as
          Record<string, unknown>;
        delete input.transcript_path;
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.goodmemory.hookEvents[1]!;
        const input = JSON.parse(event.rawInput) as
          Record<string, unknown>;
        input.permission_mode = "default";
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.mirroredHook.hookEvents[0]!;
        const input = JSON.parse(event.rawInput) as
          Record<string, unknown>;
        input.forged = true;
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.goodmemory.hookEvents[1]!;
        const input = JSON.parse(event.rawInput) as {
          session_id: string;
          transcript_path: string;
        };
        input.transcript_path = input.transcript_path.replace(
          `-${input.session_id}.jsonl`,
          `-other-${input.session_id}.jsonl`,
        );
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        const event =
          artifact.captures[0].arms.mirroredHook.hookEvents[0]!;
        const input = JSON.parse(event.rawInput) as
          Record<string, unknown>;
        input.transcript_path =
          "/work/forged-codex/sessions/rollout-forged.jsonl";
        event.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.stopHookEvent = null;
      },
      (artifact) => {
        const stop =
          artifact.captures[0].arms.goodmemory.stopHookEvent!;
        stop.status = 1 as unknown as 0;
      },
      (artifact) => {
        const stop =
          artifact.captures[0].arms.goodmemory.stopHookEvent!;
        const input = JSON.parse(stop.rawInput) as
          Record<string, unknown>;
        input.session_id = "forged-session";
        stop.rawInput = JSON.stringify(input);
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.stopHookEvent!.rawOutput =
          '{"continue":true}\n';
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.stopHookEvent!.sequence =
          1 as unknown as 2;
      },
      (artifact) => {
        const run = artifact.captures[0];
        const header = "Developer memory notes:";
        for (const arm of [
          run.arms.goodmemory,
          run.arms.mirroredHook,
        ]) {
          for (const event of arm.hookEvents) {
            const parsed = JSON.parse(event.rawOutput) as {
              hookSpecificOutput: { additionalContext: string };
            };
            parsed.hookSpecificOutput.additionalContext = header;
            event.rawOutput = JSON.stringify(parsed);
          }
          const request = JSON.parse(arm.rawRequestBody) as {
            input: Array<{ content: Array<{ text: string }> }>;
          };
          request.input[2]!.content[0]!.text = header;
          request.input[4]!.content[0]!.text = header;
          arm.rawRequestBody = JSON.stringify(request);
        }
      },
      (artifact) => {
        const seed = JSON.parse(
          artifact.captures[0].installedHost.seedSource,
        ) as { accepted: number };
        seed.accepted = 0;
        artifact.captures[0].installedHost.seedSource =
          JSON.stringify(seed);
      },
      (artifact) => {
        artifact.captures[0].installedHost.workspaceTreeSha256After =
          sha256("mutated-workspace");
      },
      (artifact) => {
        const status = JSON.parse(
          artifact.captures[0].installedHost.statusSource,
        ) as { hosts: Array<{ counts: { facts: number } }> };
        status.hosts[0]!.counts.facts = 0;
        artifact.captures[0].installedHost.statusSource =
          JSON.stringify(status);
      },
      (artifact) => {
        artifact.profile.recommendedCodexConfigSource =
          artifact.profile.recommendedCodexConfigSource.replace(
            "hooks = true",
            "hooks = false",
          );
        artifact.profile.recommendedCodexConfigSourceSha256 = sha256(
          artifact.profile.recommendedCodexConfigSource,
        );
      },
      (artifact) => {
        artifact.captures[0].arms.goodmemory.codexJsonl =
          artifact.captures[0].arms.goodmemory.codexJsonl.replace(
            "Model metadata for",
            "transport failed for",
          );
      },
      (artifact) => {
        const arm = artifact.captures[0].arms.goodmemory;
        arm.codexJsonl = arm.codexJsonl.replace(
          '{"type":"turn.completed"',
          `{"type":"item.completed","item":{"id":"forged","type":"agent_message","text":"${C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE}"}}\n`
          + '{"type":"turn.completed"',
        );
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const artifact = structuredClone(fixture());
      mutate(artifact);
      expect(
        () => verifyC6InstalledHostPlacementCanary(artifact),
        `mutation ${index} must fail closed`,
      ).toThrow();
    }
  });

  it("rejects ambiguous prompts and non-message hook placement", () => {
    const duplicatePromptBody = JSON.parse(requestBody({
      root: "/work/run-a",
      withContexts: true,
    })) as {
      input: unknown[];
    };
    duplicatePromptBody.input.push(message("user", PROMPT));
    expect(() => buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody: JSON.stringify(duplicatePromptBody),
    })).toThrow("exactly one original prompt");

    const misplacedBody = JSON.parse(requestBody({
      root: "/work/run-a",
      withContexts: true,
    })) as {
      input: unknown[];
    };
    misplacedBody.input.splice(3, 0, message("developer", "interposed"));
    expect(() => buildC6InstalledHostRequestPlacement({
      expectedModel: MODEL,
      originalPrompt: PROMPT,
      rawRequestBody: JSON.stringify(misplacedBody),
    })).toThrow("native hook placement");
  });
});

function fixture(): C6InstalledHostPlacementCanary {
  const profileSource = `${JSON.stringify({
    activationMode: "global",
    contextMode: "fragment",
    debug: false,
    host: "codex",
    maintenance: {
      auto: true,
    },
    maxTokens: 512,
    promptInjection: "always",
    sessionStartMaxTokens: 1024,
    retrieval: {
      bm25Ranking: true,
    },
    retrievalProfile: "coding_agent",
    storage: {
      path: "/work/home/.goodmemory/memory.sqlite",
      provider: "sqlite",
    },
    userId: "c6-placement-user",
    version: 1,
    writeback: {
      allowAssistantOutput: "confirmed_or_verified",
      dryRun: false,
      maxChars: 12000,
      maxMessages: 12,
      minConfidence: 0.7,
      mode: "selective",
      persistRawTranscript: false,
    },
  }, null, 2)}\n`;
  const goodmemoryHome = "/work/home";
  const goodmemoryHookConfig = managedHookConfig(goodmemoryHome);
  const workspacePath = "/work/workspace";
  const codexConfigSource =
    buildC6InstalledHostPlacementCodexConfig({
      goodmemoryHome,
      model: MODEL,
    });
  const recommendedCodexConfigSource =
    buildC6InstalledHostPlacementRecommendedCodexConfig({
      goodmemoryHome,
    });
  const mirroredHookConfigSource =
    buildC6InstalledHostPlacementMirrorHookConfig();
  const flatSummaryHookConfigSource =
    buildC6InstalledHostPlacementFlatSummaryHookConfig();
  const enabledArguments =
    buildC6InstalledHostPlacementCodexArguments({
      hookMode: "enabled",
      model: MODEL,
      originalPrompt: PROMPT,
      workspacePath,
    });
  const hooksDisabledArguments =
    buildC6InstalledHostPlacementCodexArguments({
      hookMode: "disabled",
      model: MODEL,
      originalPrompt: PROMPT,
      workspacePath,
    });
  return {
    boundary: {
      c6T003Complete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      executionAuthenticated: false,
      experimentalNoMemoryArmIncluded: false,
      externalIndependentAttestation: false,
      finalInstalledHostProfileProven: false,
      flatSummaryPlacementParityProven: false,
      liveProviderExecution: false,
    },
    frozen: {
      codex: {
        linuxTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
        mainTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
        version: "codex-cli 0.145.0",
      },
      goodmemory: {
        packageSha256:
          C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
        version: "0.7.0",
      },
      imageSha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
      model: MODEL,
      runnerSourceSha256: sha256("placement-runner"),
      workspacePath,
    },
    flatSummaryControl:
      buildC6InstalledHostPlacementFlatSummaryControl(),
    kind: "c6-installed-host-placement-canary",
    profile: {
      contextMode: "fragment",
      goodmemoryHome,
      goodmemoryHookConfig,
      goodmemoryHookConfigSha256: sha256(goodmemoryHookConfig),
      maxTokens: 512,
      normalizedSha256:
        sha256(canonicalJson(JSON.parse(profileSource))),
      promptInjection: "always",
      recommendedCodexConfigSource,
      recommendedCodexConfigSourceSha256:
        sha256(recommendedCodexConfigSource),
      sessionStartMaxTokens: 1024,
      source: profileSource,
      sourceSha256: sha256(profileSource),
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    transport: {
      codexConfigSource,
      codexConfigSourceSha256: sha256(codexConfigSource),
      goodmemoryArguments: enabledArguments,
      goodmemoryWrapperSource:
        C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
      goodmemoryWrapperSourceSha256: sha256(
        C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
      ),
      hooksDisabledArguments,
      flatSummaryArguments: enabledArguments,
      flatSummaryHookConfigSource,
      flatSummaryHookConfigSourceSha256:
        sha256(flatSummaryHookConfigSource),
      flatSummaryHookRunnerSource:
        C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
      flatSummaryHookRunnerSourceSha256: sha256(
        C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
      ),
      mirroredArguments: enabledArguments,
      mirroredHookConfigSource,
      mirroredHookConfigSourceSha256:
        sha256(mirroredHookConfigSource),
      mirroredHookRunnerSource:
        C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
      mirroredHookRunnerSourceSha256: sha256(
        C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
      ),
    },
    captures: [
      runFixture("run-a", "/work/run-a"),
      runFixture("run-b", "/work/run-b"),
    ],
    schemaVersion: 2,
  };
}

function runFixture(
  runId: string,
  freshRoot: string,
): C6InstalledHostPlacementCanary["captures"][number] {
  const root = "/work";
  const goodmemory = armCapture({
    arm: "goodmemory-installed",
    captureId: runId,
    codexHome: "/work/home/.codex",
    root,
    withContexts: true,
  });
  const mirroredHook = armCapture({
    arm: "mirrored-hook-control",
    captureId: runId,
    codexHome: "/work/home/.codex",
    root,
    withContexts: true,
  });
  const flatSummaryHook = armCapture({
    arm: "flat-summary-hook-control",
    captureId: runId,
    codexHome: "/work/home/.codex",
    contextTexts: [
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
    ],
    root,
    withContexts: true,
  });
  return {
    arms: {
      flatSummaryHook,
      goodmemory,
      hooksDisabled: armCapture({
        arm: "installed-host-hooks-disabled-control",
        captureId: runId,
        codexHome: "/work/hooks-disabled-codex",
        root,
        withContexts: false,
      }),
      mirroredHook,
    },
    environment: {
      architecture: "x86_64",
      capabilitiesDropped: "ALL",
      credentialsMounted: false,
      networkMode: "none",
      noNewPrivileges: true,
      operatingSystem: "linux",
      readOnlyRootFilesystem: true,
      sourceCheckoutMounted: false,
    },
    installedHost: installedHostReceipt(root),
    declaredFreshRootIdentitySha256: sha256(freshRoot),
    observed: {
      codexLinuxTarballSha256:
        C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
      codexMainTarballSha256:
        C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
      codexVersion: "codex-cli 0.145.0",
      goodmemoryPackageSha256:
        C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
      goodmemoryVersion: "0.7.0",
      imageSha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
      runnerSourceSha256: sha256("placement-runner"),
    },
    runId,
  };
}

function installedHostReceipt(root: string) {
  return {
    seedMessage: C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE,
    seedSource: JSON.stringify({
      accepted: 1,
      events: [{
        candidateId: "candidate-0001",
        evidenceIds: ["evidence-0001"],
        extractionSources: ["rules-only"],
        memoryId: "memory-0001",
        memoryType: "fact",
        outcome: "written",
        presetId: "coding_agent",
        profileId: "installed-host-codex-writeback",
        reason: "explicit_fact",
        sourceMethod: "explicit",
      }],
      metadata: {
        analysisMode: "rules-only",
        requestedExtractionStrategy: "rules-only",
        resolvedExtractionStrategy: "rules-only",
      },
      rejected: 0,
      scope: {
        agentId: "codex",
        userId: "c6-placement-user",
        workspaceId: "workspace",
      },
      storage: {
        location:
          "/work/home/.goodmemory/memory.sqlite",
        provider: "sqlite",
      },
    }),
    setupSource: JSON.stringify({
      hosts: [{
        activationMode: "global",
        contextMode: "fragment",
        host: "codex",
        userId: "c6-placement-user",
        writeback: {
          mode: "selective",
          persistRawTranscript: false,
        },
      }],
    }),
    statusSource: JSON.stringify({
      hosts: [{
        activationMode: "global",
        config: "ok",
        contextMode: "fragment",
        counts: {
          archives: 0,
          episodes: 0,
          facts: 1,
          feedback: 0,
          preferences: 0,
          profile: 0,
          references: 0,
        },
        hookRegistered: true,
        host: "codex",
        mcpRegistered: true,
        memoryStatus: "ok",
        preActionRegistered: true,
        workspaceRoot: `${root}/workspace`,
        workspaceStatus: "ok",
        writeback: {
          mode: "selective",
          persistRawTranscript: false,
        },
      }],
    }),
    workspaceTreeSha256After: sha256("[]"),
    workspaceTreeSha256Before: sha256("[]"),
  };
}

function armCapture(input: {
  arm:
    | "goodmemory-installed"
    | "flat-summary-hook-control"
    | "installed-host-hooks-disabled-control"
    | "mirrored-hook-control";
  captureId: string;
  codexHome: string;
  contextTexts?: readonly [string, string];
  root: string;
  withContexts: boolean;
}): C6InstalledHostPlacementCanary["captures"][number]["arms"]["goodmemory"] {
  const threadId = `${input.captureId}-${input.arm}`;
  return {
    arm: input.arm,
    codexExitCode: 0,
    codexJsonl: codexLifecycle(input.arm, threadId),
    hookEvents: input.withContexts
      ? [
          hookEvent(
            "SessionStart",
            0,
            input.contextTexts?.[0] ?? SESSION_CONTEXT,
            1024,
            input.codexHome,
            input.root,
            threadId,
          ),
          hookEvent(
            "UserPromptSubmit",
            1,
            input.contextTexts?.[1] ?? PROMPT_CONTEXT,
            512,
            input.codexHome,
            input.root,
            threadId,
          ),
        ]
      : [],
    mockExternalRequestCount: 0,
    originalPrompt: PROMPT,
    requestCount: 1,
    requestMethod: "POST",
    requestPath: "/v1/responses",
    rawRequestBody: requestBody({
      root: input.root,
      transport: {
        installationId:
          `${input.captureId}-${input.arm}-installation`,
        threadId,
        turnId: `${threadId}-turn`,
        turnStartedAtUnixMs:
          input.captureId === "run-a" ? 100 : 200,
      },
      withContexts: input.withContexts,
      contextTexts: input.contextTexts,
    }),
    stopHookEvent: input.arm === "goodmemory-installed"
      ? stopHookEvent({
          codexHome: input.codexHome,
          root: input.root,
          sessionId: threadId,
        })
      : null,
  };
}

function codexLifecycle(
  arm:
    | "goodmemory-installed"
    | "flat-summary-hook-control"
    | "installed-host-hooks-disabled-control"
    | "mirrored-hook-control",
  threadId: string,
): string {
  const hookWarning =
    "`--dangerously-bypass-hook-trust` is enabled. "
    + "Enabled hooks may run without review for this invocation.";
  const modelWarning =
    `Model metadata for \`${MODEL}\` not found. `
    + "Defaulting to fallback metadata; this can degrade performance "
    + "and cause issues.";
  const events = [
    { thread_id: threadId, type: "thread.started" },
    {
      item: {
        id: `${arm}-warning-hook-1`,
        message: hookWarning,
        type: "error",
      },
      type: "item.completed",
    },
    {
      item: {
        id: `${arm}-warning-hook-2`,
        message: hookWarning,
        type: "error",
      },
      type: "item.completed",
    },
    {
      item: {
        id: `${arm}-warning-model`,
        message: modelWarning,
        type: "error",
      },
      type: "item.completed",
    },
    { type: "turn.started" },
    {
      item: {
        id: `${arm}-agent-message`,
        text: C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE,
        type: "agent_message",
      },
      type: "item.completed",
    },
    {
      type: "turn.completed",
      usage: {
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
      },
    },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function hookEvent(
  eventName: "SessionStart" | "UserPromptSubmit",
  sequence: number,
  context: string,
  maxTokens: number,
  codexHome: string,
  root: string,
  sessionId: string,
) {
  return {
    maxTokens,
    rawInput: JSON.stringify({
      cwd: `${root}/workspace`,
      hook_event_name: eventName,
      model: MODEL,
      permission_mode: "bypassPermissions",
      ...(eventName === "UserPromptSubmit" ? { prompt: PROMPT } : {}),
      session_id: sessionId,
      ...(eventName === "SessionStart" ? { source: "startup" } : {}),
      transcript_path:
        `${codexHome}/sessions/2026/07/25/rollout-${sessionId}.jsonl`,
      ...(eventName === "UserPromptSubmit"
        ? { turn_id: `${sessionId}-turn` }
        : {}),
    }),
    rawOutput: hookOutput(eventName, context),
    sequence,
    status: 0 as const,
  };
}

function stopHookEvent(input: {
  codexHome: string;
  root: string;
  sessionId: string;
}) {
  return {
    rawInput: JSON.stringify({
      cwd: `${input.root}/workspace`,
      hook_event_name: "Stop",
      last_assistant_message:
        C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE,
      model: MODEL,
      permission_mode: "bypassPermissions",
      session_id: input.sessionId,
      stop_hook_active: false,
      transcript_path:
        `${input.codexHome}/sessions/2026/07/25/rollout-${input.sessionId}.jsonl`,
      turn_id: `${input.sessionId}-turn`,
    }),
    rawOutput: "{}\n",
    sequence: 2,
    status: 0,
  } as const;
}

function hookOutput(
  eventName: "SessionStart" | "UserPromptSubmit",
  context: string,
): string {
  return JSON.stringify({
    hookSpecificOutput: {
      additionalContext: context,
      hookEventName: eventName,
    },
  });
}

function requestBody(input: {
  root: string;
  transport?: {
    installationId: string;
    threadId: string;
    turnId: string;
    turnStartedAtUnixMs: number;
  };
  withContexts: boolean;
  contextTexts?: readonly [string, string];
  wrongSessionRole?: boolean;
}): string {
  const transport = input.transport ?? {
    installationId: "c6-normalized-installation",
    threadId: "c6-normalized-thread",
    turnId: "c6-normalized-turn",
    turnStartedAtUnixMs: 1,
  };
  const windowId = `${transport.threadId}:0`;
  const contexts = input.withContexts
    ? input.contextTexts ?? [SESSION_CONTEXT, PROMPT_CONTEXT]
    : undefined;
  return JSON.stringify({
    client_metadata: {
      thread_id: transport.threadId,
      turn_id: transport.turnId,
      "x-codex-installation-id": transport.installationId,
      "x-codex-turn-metadata": JSON.stringify({
        installation_id: transport.installationId,
        session_id: transport.threadId,
        thread_id: transport.threadId,
        turn_id: transport.turnId,
        window_id: windowId,
        request_kind: "turn",
        thread_source: "user",
        sandbox: "seccomp",
        turn_started_at_unix_ms: transport.turnStartedAtUnixMs,
      }),
      "x-codex-window-id": windowId,
      session_id: transport.threadId,
    },
    input: [
      message("developer", "built-in permissions"),
      message("user", `<environment_context>${input.root}</environment_context>`),
      ...(contexts !== undefined
        ? [
            message(
              input.wrongSessionRole ? "user" : "developer",
              contexts[0],
            ),
          ]
        : []),
      message("user", PROMPT),
      ...(contexts !== undefined
        ? [message("developer", contexts[1])]
        : []),
    ],
    model: MODEL,
    prompt_cache_key: transport.threadId,
    stream: true,
  });
}

function message(role: "developer" | "user", text: string) {
  return {
    content: [{ text, type: "input_text" }],
    role,
    type: "message",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function managedHookConfig(goodmemoryHome: string): string {
  const prefix =
    `GOODMEMORY_HOME='${goodmemoryHome}' `
    + "GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook ";
  return JSON.stringify({
    hooks: {
      PreToolUse: [{
        hooks: [{
          command: `${prefix}pre-tool-use`,
          type: "command",
        }],
        matcher: "Bash",
      }],
      SessionStart: [{
        hooks: [{
          command: `${prefix}session-start`,
          type: "command",
        }],
        matcher: "startup|resume|clear|compact",
      }],
      Stop: [{
        hooks: [{
          command: `${prefix}session-stop`,
          type: "command",
        }],
      }],
      UserPromptSubmit: [{
        hooks: [{
          command: `${prefix}user-prompt-submit`,
          type: "command",
        }],
      }],
    },
  });
}
