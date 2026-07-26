import { createHash } from "node:crypto";
import { isAbsolute, relative } from "node:path";

import { z } from "zod";

import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  buildC6InjectionBudgetReceipt,
  countC6InjectedTokens,
  validateC6InjectionBudgetReceipt,
} from "./c6-flat-summary";

export const C6_INSTALLED_HOST_PLACEMENT_LOOPBACK_PORT = 39091;
export const C6_INSTALLED_HOST_PLACEMENT_PROVIDER_ID = "c6_loopback";
export const C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE =
  "C6_LOOPBACK_DONE";
export const C6_INSTALLED_HOST_PLACEMENT_SENTINEL =
  "C6_LINUX_MEMORY_SENTINEL";
export const C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS = 512;
export const C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS =
  1024;
export const C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_HISTORY_SOURCE =
  "A deterministic Linux x64 installed-host canary must verify "
  + "the native SessionStart and UserPromptSubmit injection positions "
  + "before any formal coding-effect run.";
export const C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT =
  "Developer history summary:\n"
  + "The C6 installed-host checkpoint uses a deterministic Linux x64 "
  + "placement canary. Verify both native hook positions before a "
  + "formal coding-effect run.";
export const C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE =
  "Remember that the c6 workspace deployment is blocked on "
  + `${C6_INSTALLED_HOST_PLACEMENT_SENTINEL} smoke verification.`;
export const C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE =
  `#!/bin/sh
set -eu
event="\${3:-unknown}"
case "$event" in
  session-start|session-stop|user-prompt-submit) ;;
  *) exit 64 ;;
esac
root=/work/capture/goodmemory-hooks
mkdir -p "$root"
ordinal=0
if test -f "$root/sequence.txt"; then
  ordinal=$(wc -l < "$root/sequence.txt")
fi
prefix=$(printf '%03d-%s' "$ordinal" "$event")
test ! -e "$root/$prefix.stdin.json"
cat > "$root/$prefix.stdin.json"
set +e
/work/goodmemory/consumer/node_modules/.bin/goodmemory "$@" \
  < "$root/$prefix.stdin.json" \
  > "$root/$prefix.stdout.json" \
  2> "$root/$prefix.stderr.txt"
status=$?
set -e
printf '%s\\n' "$status" > "$root/$prefix.status"
printf '%s\\n' "$event" >> "$root/sequence.txt"
cat "$root/$prefix.stdout.json"
exit "$status"
`;
export const C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE =
  `import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

const eventName = process.argv[2];
if (eventName !== "SessionStart" && eventName !== "UserPromptSubmit") {
  throw new Error("unsupported mirrored hook event");
}
const command = eventName === "SessionStart"
  ? "session-start"
  : "user-prompt-submit";
const contextPath = eventName === "SessionStart"
  ? "/work/capture/session-context.txt"
  : "/work/capture/prompt-context.txt";
const root = "/work/capture/mirrored-hooks";
await mkdir(root, { recursive: true });
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const rawInput = Buffer.concat(chunks).toString("utf8");
const context = await readFile(contextPath, "utf8");
const rawOutput = JSON.stringify({
  hookSpecificOutput: {
    additionalContext: context,
    hookEventName: eventName,
  },
}) + "\\n";
let sequence = "";
try {
  sequence = await readFile(\`\${root}/sequence.txt\`, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
const ordinal = sequence.length === 0
  ? 0
  : sequence.trimEnd().split("\\n").length;
const prefix = \`\${String(ordinal).padStart(3, "0")}-\${command}\`;
const exclusive = { flag: "wx" };
await writeFile(\`\${root}/\${prefix}.stdin.json\`, rawInput, exclusive);
await writeFile(\`\${root}/\${prefix}.stdout.json\`, rawOutput, exclusive);
await writeFile(\`\${root}/\${prefix}.stderr.txt\`, "", exclusive);
await writeFile(\`\${root}/\${prefix}.status\`, "0\\n", exclusive);
await appendFile(\`\${root}/sequence.txt\`, \`\${command}\\n\`);
process.stdout.write(rawOutput);
`;
export const C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE =
  `import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

const eventName = process.argv[2];
if (eventName !== "SessionStart" && eventName !== "UserPromptSubmit") {
  throw new Error("unsupported flat-summary hook event");
}
const command = eventName === "SessionStart"
  ? "session-start"
  : "user-prompt-submit";
const root = "/work/capture/flat-summary-hooks";
await mkdir(root, { recursive: true });
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const rawInput = Buffer.concat(chunks).toString("utf8");
const context = await readFile("/runner/flat-summary-output.txt", "utf8");
if (context.length === 0 || context.trim() !== context) {
  throw new Error("flat-summary output bytes are invalid");
}
const rawOutput = JSON.stringify({
  hookSpecificOutput: {
    additionalContext: context,
    hookEventName: eventName,
  },
}) + "\\n";
let sequence = "";
try {
  sequence = await readFile(\`\${root}/sequence.txt\`, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
const ordinal = sequence.length === 0
  ? 0
  : sequence.trimEnd().split("\\n").length;
const prefix = \`\${String(ordinal).padStart(3, "0")}-\${command}\`;
const exclusive = { flag: "wx" };
await writeFile(\`\${root}/\${prefix}.stdin.json\`, rawInput, exclusive);
await writeFile(\`\${root}/\${prefix}.stdout.json\`, rawOutput, exclusive);
await writeFile(\`\${root}/\${prefix}.stderr.txt\`, "", exclusive);
await writeFile(\`\${root}/\${prefix}.status\`, "0\\n", exclusive);
await appendFile(\`\${root}/sequence.txt\`, \`\${command}\\n\`);
process.stdout.write(rawOutput);
`;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const injectionBudgetReceiptSchema = z.object({
  arm: z.literal("flat-summary"),
  compositionSha256: z.literal(
    C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  ),
  contentSha256: sha256Schema,
  historySourceSha256: sha256Schema,
  injectedTokenCount: z.number().int().positive(),
  injectionMode: z.literal("content-injection"),
  maxInjectedTokens: z.number().int().positive(),
  schemaVersion: z.literal(2),
  tokenCounterId: z.literal(C6_INJECTION_TOKEN_COUNTER_ID),
  tokenCounterSha256: z.literal(C6_INJECTION_TOKEN_COUNTER_SHA256),
}).strict();
const hookEventNameSchema = z.enum([
  "SessionStart",
  "UserPromptSubmit",
]);
const armNameSchema = z.enum([
  "flat-summary-hook-control",
  "goodmemory-installed",
  "installed-host-hooks-disabled-control",
  "mirrored-hook-control",
]);
const hookEventSchema = z.object({
  maxTokens: z.number().int().positive(),
  rawInput: z.string().min(1),
  rawOutput: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  status: z.literal(0),
}).strict();
const stopHookEventSchema = z.object({
  rawInput: z.string().min(1),
  rawOutput: z.string().min(1),
  sequence: z.literal(2),
  status: z.literal(0),
}).strict();
const armCaptureSchema = z.object({
  arm: armNameSchema,
  codexExitCode: z.literal(0),
  codexJsonl: z.string().min(1),
  hookEvents: z.array(hookEventSchema),
  mockExternalRequestCount: z.literal(0),
  originalPrompt: z.string().min(1),
  requestCount: z.literal(1),
  requestMethod: z.literal("POST"),
  requestPath: z.literal("/v1/responses"),
  rawRequestBody: z.string().min(1),
  stopHookEvent: stopHookEventSchema.nullable(),
}).strict();
const observedIdentitySchema = z.object({
  codexLinuxTarballSha256: sha256Schema,
  codexMainTarballSha256: sha256Schema,
  codexVersion: z.string().min(1),
  goodmemoryPackageSha256: sha256Schema,
  goodmemoryVersion: z.string().min(1),
  imageSha256: sha256Schema,
  runnerSourceSha256: sha256Schema,
}).strict();
const installedHostReceiptSchema = z.object({
  seedMessage: z.literal(
    C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE,
  ),
  seedSource: z.string().min(1),
  setupSource: z.string().min(1),
  statusSource: z.string().min(1),
  workspaceTreeSha256After: sha256Schema,
  workspaceTreeSha256Before: sha256Schema,
}).strict();
const runSchema = z.object({
  arms: z.object({
    flatSummaryHook: armCaptureSchema,
    goodmemory: armCaptureSchema,
    hooksDisabled: armCaptureSchema,
    mirroredHook: armCaptureSchema,
  }).strict(),
  environment: z.object({
    architecture: z.literal("x86_64"),
    capabilitiesDropped: z.literal("ALL"),
    credentialsMounted: z.literal(false),
    networkMode: z.literal("none"),
    noNewPrivileges: z.literal(true),
    operatingSystem: z.literal("linux"),
    readOnlyRootFilesystem: z.literal(true),
    sourceCheckoutMounted: z.literal(false),
  }).strict(),
  installedHost: installedHostReceiptSchema,
  declaredFreshRootIdentitySha256: sha256Schema,
  observed: observedIdentitySchema,
  runId: z.string().min(1),
}).strict();
const flatSummaryControlSchema = z.object({
  eventBudgets: z.tuple([
    z.object({
      budgetReceipt: injectionBudgetReceiptSchema,
      eventName: z.literal("SessionStart"),
    }).strict(),
    z.object({
      budgetReceipt: injectionBudgetReceiptSchema,
      eventName: z.literal("UserPromptSubmit"),
    }).strict(),
  ]),
  historySource: z.string().min(1),
  historySourceSha256: sha256Schema,
  injectionCompositionSha256: z.literal(
    C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  ),
  output: z.string().min(1),
  outputSha256: sha256Schema,
  providerArtifactBound: z.literal(false),
  source: z.literal("frozen-local-placement-canary-v1"),
}).strict();
const canarySchema = z.object({
  boundary: z.object({
    c6T003Complete: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    executionAuthenticated: z.literal(false),
    experimentalNoMemoryArmIncluded: z.literal(false),
    externalIndependentAttestation: z.literal(false),
    finalInstalledHostProfileProven: z.literal(false),
    flatSummaryPlacementParityProven: z.literal(false),
    liveProviderExecution: z.literal(false),
  }).strict(),
  frozen: z.object({
    codex: z.object({
      linuxTarballSha256: sha256Schema,
      mainTarballSha256: sha256Schema,
      version: z.string().min(1),
    }).strict(),
    goodmemory: z.object({
      packageSha256: sha256Schema,
      version: z.string().min(1),
    }).strict(),
    imageSha256: sha256Schema,
    model: z.string().min(1),
    runnerSourceSha256: sha256Schema,
    workspacePath: z.string().startsWith("/"),
  }).strict(),
  flatSummaryControl: flatSummaryControlSchema,
  kind: z.literal("c6-installed-host-placement-canary"),
  profile: z.object({
    contextMode: z.literal("fragment"),
    goodmemoryHome: z.string().startsWith("/"),
    goodmemoryHookConfig: z.string().min(1),
    goodmemoryHookConfigSha256: sha256Schema,
    maxTokens: z.literal(
      C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS,
    ),
    normalizedSha256: sha256Schema,
    promptInjection: z.literal("always"),
    recommendedCodexConfigSource: z.string().min(1),
    recommendedCodexConfigSourceSha256: sha256Schema,
    sessionStartMaxTokens: z.literal(
      C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
    ),
    source: z.string().min(1),
    sourceSha256: sha256Schema,
    tokenCounterId: z.literal(C6_INJECTION_TOKEN_COUNTER_ID),
    tokenCounterSha256: z.literal(C6_INJECTION_TOKEN_COUNTER_SHA256),
  }).strict(),
  transport: z.object({
    codexConfigSource: z.string().min(1),
    codexConfigSourceSha256: sha256Schema,
    goodmemoryArguments: z.array(z.string().min(1)).min(1),
    goodmemoryWrapperSource: z.string().min(1),
    goodmemoryWrapperSourceSha256: sha256Schema,
    hooksDisabledArguments: z.array(z.string().min(1)).min(1),
    flatSummaryArguments: z.array(z.string().min(1)).min(1),
    flatSummaryHookConfigSource: z.string().min(1),
    flatSummaryHookConfigSourceSha256: sha256Schema,
    flatSummaryHookRunnerSource: z.string().min(1),
    flatSummaryHookRunnerSourceSha256: sha256Schema,
    mirroredArguments: z.array(z.string().min(1)).min(1),
    mirroredHookConfigSource: z.string().min(1),
    mirroredHookConfigSourceSha256: sha256Schema,
    mirroredHookRunnerSource: z.string().min(1),
    mirroredHookRunnerSourceSha256: sha256Schema,
  }).strict(),
  captures: z.tuple([runSchema, runSchema]),
  schemaVersion: z.literal(2),
}).strict();

const requestMessageSchema = z.object({
  content: z.array(z.object({
    text: z.string(),
    type: z.literal("input_text"),
  }).passthrough()).min(1),
  role: z.enum(["assistant", "developer", "system", "user"]),
  type: z.literal("message"),
}).passthrough();
const codexTurnMetadataSchema = z.object({
  installation_id: z.string().min(1),
  request_kind: z.literal("turn"),
  sandbox: z.literal("seccomp"),
  session_id: z.string().min(1),
  thread_id: z.string().min(1),
  thread_source: z.literal("user"),
  turn_id: z.string().min(1),
  turn_started_at_unix_ms: z.number().int().positive(),
  window_id: z.string().min(1),
}).strict();
const codexClientMetadataSchema = z.object({
  thread_id: z.string().min(1),
  turn_id: z.string().min(1),
  "x-codex-installation-id": z.string().min(1),
  "x-codex-turn-metadata": z.string().min(1),
  "x-codex-window-id": z.string().min(1),
  session_id: z.string().min(1),
}).strict();
const responsesRequestSchema = z.object({
  client_metadata: codexClientMetadataSchema,
  input: z.array(requestMessageSchema).min(1),
  model: z.string().min(1),
  prompt_cache_key: z.string().min(1),
}).passthrough();
const sessionStartHookInputSchema = z.object({
  cwd: z.string().startsWith("/"),
  hook_event_name: z.literal("SessionStart"),
  model: z.string().min(1),
  permission_mode: z.literal("bypassPermissions"),
  session_id: z.string().min(1),
  source: z.literal("startup"),
  transcript_path: z.string().startsWith("/"),
}).strict();
const userPromptSubmitHookInputSchema = z.object({
  cwd: z.string().startsWith("/"),
  hook_event_name: z.literal("UserPromptSubmit"),
  model: z.string().min(1),
  permission_mode: z.literal("bypassPermissions"),
  prompt: z.string(),
  session_id: z.string().min(1),
  transcript_path: z.string().startsWith("/"),
  turn_id: z.string().min(1),
}).strict();
const stopHookInputSchema = z.object({
  cwd: z.string().startsWith("/"),
  hook_event_name: z.literal("Stop"),
  last_assistant_message:
    z.literal(C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE),
  model: z.string().min(1),
  permission_mode: z.literal("bypassPermissions"),
  session_id: z.string().min(1),
  stop_hook_active: z.literal(false),
  transcript_path: z.string().startsWith("/"),
  turn_id: z.string().min(1),
}).strict();
const rawHookInputSchema = z.discriminatedUnion(
  "hook_event_name",
  [
    sessionStartHookInputSchema,
    userPromptSubmitHookInputSchema,
  ],
);
const rawHookOutputSchema = z.object({
  hookSpecificOutput: z.object({
    additionalContext: z.string().min(1),
    hookEventName: hookEventNameSchema,
  }).strict(),
}).strict();
const profileSourceSchema = z.object({
  activationMode: z.literal("global"),
  contextMode: z.literal("fragment"),
  host: z.literal("codex"),
  maxTokens: z.literal(C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS),
  promptInjection: z.literal("always"),
  retrievalProfile: z.literal("coding_agent"),
  sessionStartMaxTokens: z.literal(
    C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
  ),
  storage: z.object({
    path: z.string().startsWith("/"),
    provider: z.literal("sqlite"),
  }).passthrough(),
  userId: z.string().min(1),
  version: z.literal(1),
  writeback: z.object({
    mode: z.literal("selective"),
    persistRawTranscript: z.literal(false),
  }).passthrough(),
}).passthrough();
const setupReceiptSourceSchema = z.object({
  hosts: z.array(z.object({
    activationMode: z.literal("global"),
    contextMode: z.literal("fragment"),
    host: z.literal("codex"),
    userId: z.string().min(1),
    writeback: z.object({
      mode: z.literal("selective"),
      persistRawTranscript: z.literal(false),
    }).passthrough(),
  }).passthrough()).length(1),
}).passthrough();
const seedReceiptSourceSchema = z.object({
  accepted: z.literal(1),
  events: z.array(z.object({
    candidateId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    extractionSources: z.tuple([z.literal("rules-only")]),
    memoryId: z.string().min(1),
    memoryType: z.literal("fact"),
    outcome: z.literal("written"),
    presetId: z.literal("coding_agent"),
    profileId: z.literal("installed-host-codex-writeback"),
    reason: z.literal("explicit_fact"),
    sourceMethod: z.literal("explicit"),
  }).passthrough()).length(1),
  metadata: z.object({
    analysisMode: z.literal("rules-only"),
    requestedExtractionStrategy: z.literal("rules-only"),
    resolvedExtractionStrategy: z.literal("rules-only"),
  }).passthrough(),
  rejected: z.literal(0),
  scope: z.object({
    agentId: z.literal("codex"),
    userId: z.string().min(1),
    workspaceId: z.literal("workspace"),
  }).passthrough(),
  storage: z.object({
    location: z.string().startsWith("/"),
    provider: z.literal("sqlite"),
  }).passthrough(),
}).passthrough();
const statusReceiptSourceSchema = z.object({
  hosts: z.array(z.object({
    activationMode: z.literal("global"),
    config: z.literal("ok"),
    contextMode: z.literal("fragment"),
    counts: z.object({
      archives: z.literal(0),
      episodes: z.literal(0),
      facts: z.literal(1),
      feedback: z.literal(0),
      preferences: z.literal(0),
      profile: z.literal(0),
      references: z.literal(0),
    }).strict(),
    hookRegistered: z.literal(true),
    host: z.literal("codex"),
    mcpRegistered: z.literal(true),
    memoryStatus: z.literal("ok"),
    preActionRegistered: z.literal(true),
    workspaceRoot: z.string().startsWith("/"),
    workspaceStatus: z.literal("ok"),
    writeback: z.object({
      mode: z.literal("selective"),
      persistRawTranscript: z.literal(false),
    }).passthrough(),
  }).passthrough()).length(1),
}).passthrough();
const commandHookSchema = z.object({
  command: z.string().min(1),
  type: z.literal("command"),
}).strict();
const hookGroupSchema = z.object({
  hooks: z.array(commandHookSchema).length(1),
  matcher: z.string().optional(),
}).strict();
const managedHookConfigSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(hookGroupSchema).length(1),
    SessionStart: z.array(hookGroupSchema).length(1),
    Stop: z.array(hookGroupSchema).length(1),
    UserPromptSubmit: z.array(hookGroupSchema).length(1),
  }).strict(),
}).strict();
const mirroredHookConfigSchema = z.object({
  hooks: z.object({
    SessionStart: z.array(hookGroupSchema).length(1),
    UserPromptSubmit: z.array(hookGroupSchema).length(1),
  }).strict(),
}).strict();

export type C6InstalledHostPlacementCanary = z.infer<
  typeof canarySchema
>;

export interface C6InstalledHostRequestPlacement {
  baseRequestSha256: string;
  contextSegments: Array<{
    additionalContextSha256: string;
    eventName: "SessionStart" | "UserPromptSubmit";
    injectedTokenCount: number;
    jsonPointer: string;
    messageIndex: number;
    relativeToOriginalPrompt:
      | "immediately-after"
      | "immediately-before";
    role: "developer";
    text: string;
  }>;
  model: string;
  originalPromptIndex: number;
  originalPromptJsonPointer: string;
  originalPromptSha256: string;
  rawRequestBodySha256: string;
}

export interface C6InstalledHostPlacementCanaryVerification {
  captureEnvelopeCount: 2;
  c6T003Complete: false;
  codexRunReady: false;
  finalInstalledHostProfileProven: false;
  flatSummaryHookProjectionStructurallyBound: true;
  flatSummaryPlacementParityProven: false;
  goodMemoryHookProjectionStructurallyBound: true;
  mirroredHookProjectionStructurallyBound: true;
  rawCaptureBytesStructurallyIncluded: true;
  requestCount: 8;
  semanticProjectionStableAcrossTwoCaptureEnvelopes: true;
}

export function buildC6InstalledHostPlacementCodexConfig(input: {
  goodmemoryHome: string;
  model: string;
}): string {
  if (
    !input.goodmemoryHome.startsWith("/") ||
    input.goodmemoryHome.includes("\n") ||
    input.model.trim() !== input.model ||
    input.model.length === 0 ||
    input.model.includes("\n")
  ) {
    throw new Error("C6 placement Codex config input is invalid");
  }
  const recommended =
    buildC6InstalledHostPlacementRecommendedCodexConfig({
      goodmemoryHome: input.goodmemoryHome,
    });
  return `model = ${JSON.stringify(input.model)}
model_provider = ${JSON.stringify(C6_INSTALLED_HOST_PLACEMENT_PROVIDER_ID)}

${recommended}
[model_providers.${C6_INSTALLED_HOST_PLACEMENT_PROVIDER_ID}]
name = "C6 local loopback mock"
base_url = "http://127.0.0.1:${C6_INSTALLED_HOST_PLACEMENT_LOOPBACK_PORT}/v1"
env_key = "C6_MOCK_API_KEY"
wire_api = "responses"
requires_openai_auth = false
`;
}

export function buildC6InstalledHostPlacementRecommendedCodexConfig(
  input: { goodmemoryHome: string },
): string {
  if (
    !input.goodmemoryHome.startsWith("/") ||
    input.goodmemoryHome.includes("\n")
  ) {
    throw new Error(
      "C6 placement recommended Codex config input is invalid",
    );
  }
  return `[mcp_servers.goodmemory]
command = "goodmemory-mcp"
args = ["--host", "codex"]
[mcp_servers.goodmemory.env]
GOODMEMORY_HOME = ${JSON.stringify(input.goodmemoryHome)}
GOODMEMORY_MANAGED_BY = "goodmemory"

[features]
# goodmemory-managed-hooks-section
hooks = true # goodmemory-managed-hooks
`;
}

export function buildC6InstalledHostPlacementMirrorHookConfig(): string {
  return `${JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          command:
            "node /runner/mirror-hook.mjs SessionStart",
          type: "command",
        }],
        matcher: "startup|resume|clear|compact",
      }],
      UserPromptSubmit: [{
        hooks: [{
          command:
            "node /runner/mirror-hook.mjs UserPromptSubmit",
          type: "command",
        }],
      }],
    },
  }, null, 2)}\n`;
}

export function buildC6InstalledHostPlacementFlatSummaryHookConfig(): string {
  return `${JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          command:
            "node /runner/flat-summary-hook.mjs SessionStart",
          type: "command",
        }],
        matcher: "startup|resume|clear|compact",
      }],
      UserPromptSubmit: [{
        hooks: [{
          command:
            "node /runner/flat-summary-hook.mjs UserPromptSubmit",
          type: "command",
        }],
      }],
    },
  }, null, 2)}\n`;
}

export function buildC6InstalledHostPlacementFlatSummaryControl() {
  const historySource =
    C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_HISTORY_SOURCE;
  const output = C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT;
  const historySourceSha256 = sha256(historySource);
  const receipt = (maxInjectedTokens: number) =>
    buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256,
      injectedText: output,
      injectionMode: "content-injection",
      maxInjectedTokens,
    });
  return flatSummaryControlSchema.parse({
    eventBudgets: [
      {
        budgetReceipt: receipt(
          C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
        ),
        eventName: "SessionStart",
      },
      {
        budgetReceipt: receipt(
          C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS,
        ),
        eventName: "UserPromptSubmit",
      },
    ],
    historySource,
    historySourceSha256,
    injectionCompositionSha256:
      C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
    output,
    outputSha256: sha256(output),
    providerArtifactBound: false,
    source: "frozen-local-placement-canary-v1",
  });
}

export function buildC6InstalledHostPlacementCodexArguments(input: {
  hookMode: "disabled" | "enabled";
  model: string;
  originalPrompt: string;
  workspacePath: string;
}): string[] {
  return [
    input.hookMode === "enabled" ? "--enable" : "--disable",
    "hooks",
    "--dangerously-bypass-hook-trust",
    "--disable",
    "memories",
    "--ask-for-approval",
    "never",
    "exec",
    "--strict-config",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    input.model,
    "--cd",
    input.workspacePath,
    input.originalPrompt,
  ];
}

export function buildC6InstalledHostRequestPlacement(input: {
  expectedModel: string;
  originalPrompt: string;
  rawRequestBody: string;
}): C6InstalledHostRequestPlacement {
  const request = parseJson(
    input.rawRequestBody,
    responsesRequestSchema,
    "Responses request",
  );
  if (request.model !== input.expectedModel) {
    throw new Error("C6 placement request model drifted");
  }
  const promptMatches = request.input.flatMap((message, messageIndex) =>
    message.content.flatMap((content, contentIndex) =>
      content.text === input.originalPrompt
        ? [{ contentIndex, message, messageIndex }]
        : []
    )
  );
  if (promptMatches.length !== 1) {
    throw new Error(
      "C6 placement request must contain exactly one original prompt",
    );
  }
  const promptMatch = promptMatches[0]!;
  if (
    promptMatch.message.role !== "user" ||
    promptMatch.message.content.length !== 1
  ) {
    throw new Error("C6 placement original prompt message is invalid");
  }
  const beforeIndex = promptMatch.messageIndex - 1;
  const afterIndex = promptMatch.messageIndex + 1;
  const before = readSingleDeveloperText(
    request.input[beforeIndex],
    "SessionStart",
  );
  const after = readSingleDeveloperText(
    request.input[afterIndex],
    "UserPromptSubmit",
  );
  if (
    request.input[beforeIndex - 1]?.role === "developer" ||
    request.input[afterIndex + 1]?.role === "developer"
  ) {
    throw new Error("C6 native hook placement is ambiguous");
  }
  const normalizedRequest = normalizeResponsesRequest(request);

  return {
    baseRequestSha256: sha256(canonicalJson({
      ...normalizedRequest,
      input: normalizedRequest.input.filter((_, index) =>
        index !== beforeIndex && index !== afterIndex
      ),
    })),
    contextSegments: [
      buildContextSegment({
        eventName: "SessionStart",
        messageIndex: beforeIndex,
        relativeToOriginalPrompt: "immediately-before",
        text: before,
      }),
      buildContextSegment({
        eventName: "UserPromptSubmit",
        messageIndex: afterIndex,
        relativeToOriginalPrompt: "immediately-after",
        text: after,
      }),
    ],
    model: request.model,
    originalPromptIndex: promptMatch.messageIndex,
    originalPromptJsonPointer:
      `/input/${promptMatch.messageIndex}/content/${promptMatch.contentIndex}/text`,
    originalPromptSha256: sha256(input.originalPrompt),
    rawRequestBodySha256: sha256(input.rawRequestBody),
  };
}

export function verifyC6InstalledHostPlacementCanary(
  value: unknown,
): C6InstalledHostPlacementCanaryVerification {
  const canary = canarySchema.parse(value);
  verifyProfile(canary);
  verifyFlatSummaryControl(canary);
  verifyTransportSources(canary);
  const runIds = new Set(canary.captures.map((run) => run.runId));
  const declaredFreshRoots = new Set(
    canary.captures.map((run) =>
      run.declaredFreshRootIdentitySha256
    ),
  );
  if (runIds.size !== 2 || declaredFreshRoots.size !== 2) {
    throw new Error(
      "C6 placement capture declarations must be distinct",
    );
  }

  let expectedSemanticProjection: string | undefined;
  const threadIds = new Set<string>();
  let expectedPrompt: string | undefined;
  for (const run of canary.captures) {
    verifyObservedIdentity(canary, run.observed);
    verifyInstalledHostReceipt(canary, run.installedHost);
    if (
      run.arms.flatSummaryHook.arm !==
        "flat-summary-hook-control" ||
      run.arms.goodmemory.arm !== "goodmemory-installed" ||
      run.arms.hooksDisabled.arm !==
        "installed-host-hooks-disabled-control" ||
      run.arms.mirroredHook.arm !== "mirrored-hook-control"
    ) {
      throw new Error("C6 placement arm identity drifted");
    }
    if (
      run.arms.goodmemory.stopHookEvent === null ||
      run.arms.flatSummaryHook.stopHookEvent !== null ||
      run.arms.hooksDisabled.stopHookEvent !== null ||
      run.arms.mirroredHook.stopHookEvent !== null
    ) {
      throw new Error("C6 placement Stop hook boundary drifted");
    }
    const prompts = [
      run.arms.flatSummaryHook.originalPrompt,
      run.arms.goodmemory.originalPrompt,
      run.arms.hooksDisabled.originalPrompt,
      run.arms.mirroredHook.originalPrompt,
    ];
    if (
      new Set(prompts).size !== 1 ||
      (expectedPrompt !== undefined && prompts[0] !== expectedPrompt)
    ) {
      throw new Error("C6 placement arm prompts drifted");
    }
    expectedPrompt = prompts[0];
    const goodmemory = verifyInjectedArm({
      arm: run.arms.goodmemory,
      canary,
    });
    const mirrored = verifyInjectedArm({
      arm: run.arms.mirroredHook,
      canary,
    });
    const flatSummary = verifyInjectedArm({
      arm: run.arms.flatSummaryHook,
      canary,
      expectedContexts: [
        canary.flatSummaryControl.output,
        canary.flatSummaryControl.output,
      ],
    });
    verifyHookInputParity(
      run.arms.goodmemory,
      run.arms.mirroredHook,
    );
    verifyHookInputParity(
      run.arms.goodmemory,
      run.arms.flatSummaryHook,
    );
    if (
      JSON.stringify(stripRequestCommitment(goodmemory)) !==
        JSON.stringify(stripRequestCommitment(mirrored))
    ) {
      throw new Error(
        "C6 mirrored hook control does not reproduce native placement",
      );
    }
    if (
      JSON.stringify(placementGeometry(goodmemory)) !==
        JSON.stringify(placementGeometry(flatSummary))
    ) {
      throw new Error(
        "C6 flat-summary hook control does not reproduce placement geometry",
      );
    }
    verifyFlatSummaryPlacementReceipts(canary, flatSummary);
    verifyHooksDisabledArm({
      arm: run.arms.hooksDisabled,
      expectedBaseRequestSha256: goodmemory.baseRequestSha256,
      canary,
      forbiddenContexts: [
        ...goodmemory.contextSegments.map((segment) => segment.text),
        canary.flatSummaryControl.output,
      ],
    });
    for (const arm of [
      run.arms.flatSummaryHook,
      run.arms.goodmemory,
      run.arms.hooksDisabled,
      run.arms.mirroredHook,
    ]) {
      const threadId = verifyCodexLifecycle(
        arm.codexJsonl,
        arm.arm,
        canary.frozen.model,
      );
      if (threadIds.has(threadId)) {
        throw new Error("C6 placement replay reused a Codex thread");
      }
      threadIds.add(threadId);
    }
    const semanticProjection = JSON.stringify({
      flatSummary: stripRequestCommitment(flatSummary),
      flatSummaryControl: canary.flatSummaryControl,
      goodmemory: stripRequestCommitment(goodmemory),
      mirrored: stripRequestCommitment(mirrored),
      hooksDisabledPromptSha256:
        sha256(run.arms.hooksDisabled.originalPrompt),
      observed: run.observed,
      profile: canary.profile,
    });
    if (
      expectedSemanticProjection !== undefined &&
      semanticProjection !== expectedSemanticProjection
    ) {
      throw new Error(
        "C6 placement capture semantic projection drifted",
      );
    }
    expectedSemanticProjection = semanticProjection;
  }
  verifyTransportArguments(canary, expectedPrompt!);

  return {
    captureEnvelopeCount: 2,
    c6T003Complete: false,
    codexRunReady: false,
    finalInstalledHostProfileProven: false,
    flatSummaryHookProjectionStructurallyBound: true,
    flatSummaryPlacementParityProven: false,
    goodMemoryHookProjectionStructurallyBound: true,
    mirroredHookProjectionStructurallyBound: true,
    rawCaptureBytesStructurallyIncluded: true,
    requestCount: 8,
    semanticProjectionStableAcrossTwoCaptureEnvelopes: true,
  };
}

function verifyTransportSources(
  canary: C6InstalledHostPlacementCanary,
): void {
  const transport = canary.transport;
  if (
    sha256(transport.codexConfigSource) !==
      transport.codexConfigSourceSha256 ||
    sha256(transport.goodmemoryWrapperSource) !==
      transport.goodmemoryWrapperSourceSha256 ||
    sha256(transport.flatSummaryHookConfigSource) !==
      transport.flatSummaryHookConfigSourceSha256 ||
    sha256(transport.flatSummaryHookRunnerSource) !==
      transport.flatSummaryHookRunnerSourceSha256 ||
    sha256(transport.mirroredHookConfigSource) !==
      transport.mirroredHookConfigSourceSha256 ||
    sha256(transport.mirroredHookRunnerSource) !==
      transport.mirroredHookRunnerSourceSha256
  ) {
    throw new Error("C6 placement transport source bytes drifted");
  }
  if (
    transport.codexConfigSource !==
      buildC6InstalledHostPlacementCodexConfig({
        goodmemoryHome: canary.profile.goodmemoryHome,
        model: canary.frozen.model,
      }) ||
    transport.goodmemoryWrapperSource !==
      C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE ||
    transport.flatSummaryHookConfigSource !==
      buildC6InstalledHostPlacementFlatSummaryHookConfig() ||
    transport.flatSummaryHookRunnerSource !==
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE ||
    transport.mirroredHookConfigSource !==
      buildC6InstalledHostPlacementMirrorHookConfig() ||
    transport.mirroredHookRunnerSource !==
      C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE
  ) {
    throw new Error("C6 placement transport source identity drifted");
  }
  const mirrorHooks = parseJson(
    transport.mirroredHookConfigSource,
    mirroredHookConfigSchema,
    "mirrored hook config",
  ).hooks;
  const flatSummaryHooks = parseJson(
    transport.flatSummaryHookConfigSource,
    mirroredHookConfigSchema,
    "flat-summary hook config",
  ).hooks;
  if (
    mirrorHooks.SessionStart[0]!.matcher !==
      "startup|resume|clear|compact" ||
    mirrorHooks.SessionStart[0]!.hooks[0]!.command !==
      "node /runner/mirror-hook.mjs SessionStart" ||
    mirrorHooks.UserPromptSubmit[0]!.matcher !== undefined ||
    mirrorHooks.UserPromptSubmit[0]!.hooks[0]!.command !==
      "node /runner/mirror-hook.mjs UserPromptSubmit"
  ) {
    throw new Error("C6 placement mirrored hook config drifted");
  }
  if (
    flatSummaryHooks.SessionStart[0]!.matcher !==
      "startup|resume|clear|compact" ||
    flatSummaryHooks.SessionStart[0]!.hooks[0]!.command !==
      "node /runner/flat-summary-hook.mjs SessionStart" ||
    flatSummaryHooks.UserPromptSubmit[0]!.matcher !== undefined ||
    flatSummaryHooks.UserPromptSubmit[0]!.hooks[0]!.command !==
      "node /runner/flat-summary-hook.mjs UserPromptSubmit"
  ) {
    throw new Error("C6 placement flat-summary hook config drifted");
  }
}

function verifyTransportArguments(
  canary: C6InstalledHostPlacementCanary,
  originalPrompt: string,
): void {
  const common = {
    model: canary.frozen.model,
    originalPrompt,
    workspacePath: canary.frozen.workspacePath,
  };
  if (
    JSON.stringify(canary.transport.goodmemoryArguments) !==
      JSON.stringify(buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      })) ||
    JSON.stringify(canary.transport.flatSummaryArguments) !==
      JSON.stringify(buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      })) ||
    JSON.stringify(canary.transport.mirroredArguments) !==
      JSON.stringify(buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      })) ||
    JSON.stringify(canary.transport.hooksDisabledArguments) !==
      JSON.stringify(buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "disabled",
      }))
  ) {
    throw new Error("C6 placement Codex invocation arguments drifted");
  }
}

function verifyProfile(
  canary: C6InstalledHostPlacementCanary,
): void {
  if (
    sha256(canary.profile.source) !== canary.profile.sourceSha256 ||
    sha256(canary.profile.goodmemoryHookConfig) !==
      canary.profile.goodmemoryHookConfigSha256 ||
    sha256(canary.profile.recommendedCodexConfigSource) !==
      canary.profile.recommendedCodexConfigSourceSha256
  ) {
    throw new Error("C6 placement profile source bytes drifted");
  }
  if (
    canary.profile.recommendedCodexConfigSource !==
      buildC6InstalledHostPlacementRecommendedCodexConfig({
        goodmemoryHome: canary.profile.goodmemoryHome,
      })
  ) {
    throw new Error(
      "C6 placement recommended Codex config drifted",
    );
  }
  const source = parseJson(
    canary.profile.source,
    profileSourceSchema,
    "GoodMemory profile",
  );
  if (
    source.contextMode !== canary.profile.contextMode ||
    source.maxTokens !== canary.profile.maxTokens ||
    source.promptInjection !== canary.profile.promptInjection ||
    source.sessionStartMaxTokens !==
      canary.profile.sessionStartMaxTokens ||
    sha256(canonicalJson(
      parseUnknownJson(
        canary.profile.source,
        "GoodMemory profile",
      ),
    )) !== canary.profile.normalizedSha256
  ) {
    throw new Error("C6 placement normalized profile drifted");
  }

  const hooks = parseJson(
    canary.profile.goodmemoryHookConfig,
    managedHookConfigSchema,
    "GoodMemory managed hook config",
  ).hooks;
  const commandPrefix =
    `GOODMEMORY_HOME=${shellQuote(canary.profile.goodmemoryHome)} `
    + "GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook ";
  const expected = {
    PreToolUse: {
      command: `${commandPrefix}pre-tool-use`,
      matcher: "Bash",
    },
    SessionStart: {
      command: `${commandPrefix}session-start`,
      matcher: "startup|resume|clear|compact",
    },
    Stop: {
      command: `${commandPrefix}session-stop`,
      matcher: undefined,
    },
    UserPromptSubmit: {
      command: `${commandPrefix}user-prompt-submit`,
      matcher: undefined,
    },
  } as const;
  for (const eventName of Object.keys(expected) as Array<
    keyof typeof expected
  >) {
    const group = hooks[eventName][0]!;
    const hook = group.hooks[0]!;
    if (
      group.matcher !== expected[eventName].matcher ||
      hook.command !== expected[eventName].command
    ) {
      throw new Error("C6 placement managed hook config drifted");
    }
  }
}

function verifyFlatSummaryControl(
  canary: C6InstalledHostPlacementCanary,
): void {
  const expected = buildC6InstalledHostPlacementFlatSummaryControl();
  if (
    JSON.stringify(canary.flatSummaryControl) !==
      JSON.stringify(expected) ||
    canary.flatSummaryControl.output.trim() !==
      canary.flatSummaryControl.output ||
    canary.flatSummaryControl.output.includes(
      C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
    )
  ) {
    throw new Error("C6 placement flat-summary control drifted");
  }
}

function verifyInjectedArm(input: {
  arm: z.infer<typeof armCaptureSchema>;
  canary: C6InstalledHostPlacementCanary;
  expectedContexts?: readonly [string, string];
}): C6InstalledHostRequestPlacement {
  const threadId = verifyCommonArm(
    input.arm,
    input.canary.frozen.model,
  );
  if (input.arm.hookEvents.length !== 2) {
    throw new Error("C6 injected placement arm must capture two hook events");
  }
  const placement = buildC6InstalledHostRequestPlacement({
    expectedModel: input.canary.frozen.model,
    originalPrompt: input.arm.originalPrompt,
    rawRequestBody: input.arm.rawRequestBody,
  });
  if (input.expectedContexts === undefined) {
    if (
      !placement.contextSegments[0]!.text.includes(
        C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
      ) ||
      !placement.contextSegments[1]!.text.includes(
        C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
      ) ||
      placement.contextSegments.some((segment) =>
        segment.text.trim() === "Developer memory notes:"
      )
    ) {
      throw new Error(
        "C6 placement memory context does not bind the seed and prompt",
      );
    }
  } else if (
    placement.contextSegments[0]!.text !== input.expectedContexts[0] ||
    placement.contextSegments[1]!.text !== input.expectedContexts[1]
  ) {
    throw new Error("C6 placement exact hook context drifted");
  }
  const rawInputs: Array<z.infer<typeof rawHookInputSchema>> = [];
  for (const [index, hookEvent] of input.arm.hookEvents.entries()) {
    const expectedEventName = index === 0
      ? "SessionStart"
      : "UserPromptSubmit";
    if (hookEvent.sequence !== index) {
      throw new Error("C6 placement hook event sequence drifted");
    }
    const rawInput = parseJson(
      hookEvent.rawInput,
      rawHookInputSchema,
      "hook input",
    );
    rawInputs.push(rawInput);
    const rawOutput = parseJson(
      hookEvent.rawOutput,
      rawHookOutputSchema,
      "hook output",
    ).hookSpecificOutput;
    const expectedMaxTokens = expectedEventName === "SessionStart"
      ? input.canary.profile.sessionStartMaxTokens
      : input.canary.profile.maxTokens;
    const segment = placement.contextSegments[index]!;
    if (
      rawInput.hook_event_name !== expectedEventName ||
      rawInput.cwd !== input.canary.frozen.workspacePath ||
      rawInput.model !== input.canary.frozen.model ||
      rawOutput.hookEventName !== expectedEventName ||
      hookEvent.maxTokens !== expectedMaxTokens ||
      segment.eventName !== expectedEventName ||
      segment.text !== rawOutput.additionalContext ||
      segment.injectedTokenCount > expectedMaxTokens
    ) {
      throw new Error("C6 placement hook-to-request binding drifted");
    }
    if (
      expectedEventName === "UserPromptSubmit" &&
      (
        rawInput.hook_event_name !== "UserPromptSubmit" ||
        rawInput.prompt !== input.arm.originalPrompt
      )
    ) {
      throw new Error("C6 placement prompt hook input drifted");
    }
  }
  const hookSessionIds = new Set(rawInputs.map((event) =>
    event.session_id
  ));
  const hookCwds = new Set(rawInputs.map((event) => event.cwd));
  const transcriptPaths = new Set(rawInputs.map((event) =>
    event.transcript_path
  ));
  if (
    hookSessionIds.size !== 1 ||
    !hookSessionIds.has(threadId) ||
    hookCwds.size !== 1 ||
    transcriptPaths.size !== 1
  ) {
    throw new Error("C6 placement hook session identity drifted");
  }
  const transcriptPath = rawInputs[0]!.transcript_path;
  const codexHome = `${input.canary.profile.goodmemoryHome}/.codex`;
  const sessionsRoot = `${codexHome}/sessions`;
  const transcriptRelative = relative(
    sessionsRoot,
    transcriptPath,
  );
  if (
    isAbsolute(transcriptRelative) ||
    transcriptRelative === ".." ||
    transcriptRelative.startsWith("../") ||
    !transcriptRelative.endsWith(`-${threadId}.jsonl`)
  ) {
    throw new Error("C6 placement transcript identity drifted");
  }
  const requestIdentity = readResponsesTransportIdentity(
    parseJson(
      input.arm.rawRequestBody,
      responsesRequestSchema,
      "Responses request",
    ),
  );
  const promptInput = rawInputs[1];
  if (
    promptInput?.hook_event_name !== "UserPromptSubmit" ||
    requestIdentity.threadId !== threadId ||
    requestIdentity.turnId !== promptInput.turn_id
  ) {
    throw new Error(
      "C6 placement request and hook transport identity drifted",
    );
  }
  if (input.arm.arm === "goodmemory-installed") {
    verifyStopHookEvent({
      arm: input.arm,
      codexHome,
      promptInput,
      threadId,
      transcriptPath,
    });
  }
  return placement;
}

function verifyFlatSummaryPlacementReceipts(
  canary: C6InstalledHostPlacementCanary,
  placement: C6InstalledHostRequestPlacement,
): void {
  for (const [index, eventBudget] of
    canary.flatSummaryControl.eventBudgets.entries()) {
    const segment = placement.contextSegments[index]!;
    const expectedMaxTokens = index === 0
      ? canary.profile.sessionStartMaxTokens
      : canary.profile.maxTokens;
    if (
      segment.eventName !== eventBudget.eventName ||
      segment.text !== canary.flatSummaryControl.output ||
      segment.additionalContextSha256 !==
        canary.flatSummaryControl.outputSha256 ||
      segment.injectedTokenCount !==
        eventBudget.budgetReceipt.injectedTokenCount ||
      eventBudget.budgetReceipt.maxInjectedTokens !==
        expectedMaxTokens
    ) {
      throw new Error(
        "C6 placement flat-summary budget binding drifted",
      );
    }
    validateC6InjectionBudgetReceipt(
      eventBudget.budgetReceipt,
      {
        arm: "flat-summary",
        compositionSha256:
          canary.flatSummaryControl.injectionCompositionSha256,
        historySourceSha256:
          canary.flatSummaryControl.historySourceSha256,
        injectedText: canary.flatSummaryControl.output,
        injectionMode: "content-injection",
        maxInjectedTokens: expectedMaxTokens,
      },
    );
  }
}

function verifyStopHookEvent(input: {
  arm: z.infer<typeof armCaptureSchema>;
  codexHome: string;
  promptInput: z.infer<typeof userPromptSubmitHookInputSchema>;
  threadId: string;
  transcriptPath: string;
}): void {
  const stop = input.arm.stopHookEvent;
  if (stop === null) {
    throw new Error("C6 placement native Stop hook is missing");
  }
  const rawInput = parseJson(
    stop.rawInput,
    stopHookInputSchema,
    "Stop hook input",
  );
  const output = parseUnknownJson(
    stop.rawOutput,
    "Stop hook output",
  );
  const sessionsRoot = `${input.codexHome}/sessions`;
  const transcriptRelative = relative(
    sessionsRoot,
    rawInput.transcript_path,
  );
  if (
    !isRecord(output) ||
    Object.keys(output).length !== 0 ||
    stop.sequence !== 2 ||
    rawInput.session_id !== input.threadId ||
    rawInput.turn_id !== input.promptInput.turn_id ||
    rawInput.transcript_path !== input.transcriptPath ||
    rawInput.cwd !== input.promptInput.cwd ||
    rawInput.model !== input.promptInput.model ||
    isAbsolute(transcriptRelative) ||
    transcriptRelative === ".." ||
    transcriptRelative.startsWith("../")
  ) {
    throw new Error("C6 placement native Stop hook drifted");
  }
}

function verifyHookInputParity(
  goodmemory: z.infer<typeof armCaptureSchema>,
  control: z.infer<typeof armCaptureSchema>,
): void {
  const project = (arm: z.infer<typeof armCaptureSchema>) =>
    arm.hookEvents.map((event) => {
      const rawInput = parseJson(
        event.rawInput,
        rawHookInputSchema,
        "hook input",
      );
      return rawInput.hook_event_name === "SessionStart"
        ? {
            cwd: rawInput.cwd,
            hookEventName: rawInput.hook_event_name,
            model: rawInput.model,
            permissionMode: rawInput.permission_mode,
            source: rawInput.source,
          }
        : {
            cwd: rawInput.cwd,
            hookEventName: rawInput.hook_event_name,
            model: rawInput.model,
            permissionMode: rawInput.permission_mode,
            prompt: rawInput.prompt,
          };
    });
  if (
    JSON.stringify(project(goodmemory)) !==
      JSON.stringify(project(control))
  ) {
    throw new Error("C6 control hook input projection drifted");
  }
}

function verifyHooksDisabledArm(input: {
  arm: z.infer<typeof armCaptureSchema>;
  canary: C6InstalledHostPlacementCanary;
  expectedBaseRequestSha256: string;
  forbiddenContexts: readonly string[];
}): void {
  const threadId = verifyCommonArm(
    input.arm,
    input.canary.frozen.model,
  );
  if (input.arm.hookEvents.length !== 0) {
    throw new Error(
      "C6 hooks-disabled placement control must not run hooks",
    );
  }
  const request = parseJson(
    input.arm.rawRequestBody,
    responsesRequestSchema,
    "hooks-disabled Responses request",
  );
  if (request.model !== input.canary.frozen.model) {
    throw new Error("C6 hooks-disabled request model drifted");
  }
  if (
    readResponsesTransportIdentity(request).threadId !== threadId
  ) {
    throw new Error(
      "C6 hooks-disabled request transport identity drifted",
    );
  }
  if (
    sha256(canonicalJson(normalizeResponsesRequest(request))) !==
      input.expectedBaseRequestSha256
  ) {
    throw new Error(
      "C6 hooks-disabled request is not the injected-arm base request",
    );
  }
  const allTexts = collectStrings(request);
  if (
    allTexts.filter((text) => text === input.arm.originalPrompt).length !== 1 ||
    input.forbiddenContexts.some((context) =>
      allTexts.some((text) => text.includes(context))
    )
  ) {
    throw new Error(
      "C6 hooks-disabled request contains injected context",
    );
  }
  const promptMessageIndex = request.input.findIndex((message) =>
    message.content.length === 1 &&
    message.content[0]!.text === input.arm.originalPrompt
  );
  if (
    promptMessageIndex !== request.input.length - 1 ||
    request.input[promptMessageIndex]!.role !== "user"
  ) {
    throw new Error(
      "C6 hooks-disabled original prompt placement drifted",
    );
  }
}

function verifyCommonArm(
  arm: z.infer<typeof armCaptureSchema>,
  expectedModel: string,
): string {
  if (
    arm.mockExternalRequestCount !== 0 ||
    arm.requestCount !== 1 ||
    arm.requestMethod !== "POST" ||
    arm.requestPath !== "/v1/responses" ||
    arm.codexExitCode !== 0
  ) {
    throw new Error("C6 placement arm request boundary drifted");
  }
  return verifyCodexLifecycle(
    arm.codexJsonl,
    arm.arm,
    expectedModel,
  );
}

function verifyCodexLifecycle(
  codexJsonl: string,
  arm:
    | "flat-summary-hook-control"
    | "goodmemory-installed"
    | "installed-host-hooks-disabled-control"
    | "mirrored-hook-control",
  expectedModel: string,
): string {
  const events = codexJsonl.trim().split(/\r?\n/u).map((line) =>
    parseUnknownJson(line, "Codex JSONL")
  );
  const types = events.map((event) => {
    if (
      !isRecord(event) ||
      typeof event.type !== "string" ||
      event.type.length === 0
    ) {
      throw new Error("C6 placement Codex lifecycle row is malformed");
    }
    return event.type;
  });
  const hookWarningCount = 2;
  const expectedTypes = [
    "thread.started",
    ...Array.from(
      { length: hookWarningCount + 1 },
      () => "item.completed",
    ),
    "turn.started",
    "item.completed",
    "turn.completed",
  ];
  if (
    JSON.stringify(types) !== JSON.stringify(expectedTypes)
  ) {
    throw new Error(
      "C6 placement Codex lifecycle is incomplete: "
      + JSON.stringify({
        arm,
        expectedTypes,
        observed: events.map((event) => {
          const item = isRecord(event) && isRecord(event.item)
            ? event.item
            : undefined;
          return {
            itemMessage: item?.message,
            itemText: item?.text,
            itemType: item?.type,
            type: isRecord(event) ? event.type : undefined,
          };
        }),
      }),
    );
  }
  const started = events[0];
  if (
    !isRecord(started) ||
    typeof started.thread_id !== "string" ||
    started.thread_id.length === 0
  ) {
    throw new Error("C6 placement Codex thread identity is missing");
  }
  const hookWarning =
    "`--dangerously-bypass-hook-trust` is enabled. "
    + "Enabled hooks may run without review for this invocation.";
  const modelWarning =
    `Model metadata for \`${expectedModel}\` not found. `
    + "Defaulting to fallback metadata; this can degrade performance "
    + "and cause issues.";
  const expectedWarnings = [
    ...Array.from(
      { length: hookWarningCount },
      () => hookWarning,
    ),
    modelWarning,
  ];
  const itemIds = new Set<string>();
  for (const [index, expectedWarning] of expectedWarnings.entries()) {
    const event = events[index + 1];
    const item = isRecord(event) && isRecord(event.item)
      ? event.item
      : undefined;
    if (
      item === undefined ||
      item.type !== "error" ||
      item.message !== expectedWarning ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      itemIds.has(item.id)
    ) {
      throw new Error("C6 placement Codex warning sequence drifted");
    }
    itemIds.add(item.id);
  }
  const turnStartedIndex = 1 + expectedWarnings.length;
  const agentEvent = events[turnStartedIndex + 1];
  const agentItem = isRecord(agentEvent) &&
      isRecord(agentEvent.item)
    ? agentEvent.item
    : undefined;
  if (
    agentItem === undefined ||
    agentItem.type !== "agent_message" ||
    agentItem.text !==
      C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE ||
    typeof agentItem.id !== "string" ||
    agentItem.id.length === 0 ||
    itemIds.has(agentItem.id)
  ) {
    throw new Error("C6 placement Codex agent message drifted");
  }
  const completed = events[turnStartedIndex + 2];
  const usage = isRecord(completed) && isRecord(completed.usage)
    ? completed.usage
    : undefined;
  const usageFields = [
    "cached_input_tokens",
    "cache_write_input_tokens",
    "input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ] as const;
  if (
    usage === undefined ||
    usageFields.some((field) =>
      typeof usage[field] !== "number" ||
      !Number.isInteger(usage[field]) ||
      (usage[field] as number) < 0
    )
  ) {
    throw new Error("C6 placement Codex usage drifted");
  }
  return started.thread_id;
}

function verifyObservedIdentity(
  canary: C6InstalledHostPlacementCanary,
  observed: z.infer<typeof observedIdentitySchema>,
): void {
  if (
    observed.codexLinuxTarballSha256 !==
      canary.frozen.codex.linuxTarballSha256 ||
    observed.codexMainTarballSha256 !==
      canary.frozen.codex.mainTarballSha256 ||
    observed.codexVersion !== canary.frozen.codex.version ||
    observed.goodmemoryPackageSha256 !==
      canary.frozen.goodmemory.packageSha256 ||
    observed.goodmemoryVersion !== canary.frozen.goodmemory.version ||
    observed.imageSha256 !== canary.frozen.imageSha256 ||
    observed.runnerSourceSha256 !== canary.frozen.runnerSourceSha256
  ) {
    throw new Error("C6 placement observed runtime identity drifted");
  }
}

function verifyInstalledHostReceipt(
  canary: C6InstalledHostPlacementCanary,
  receipt: z.infer<typeof installedHostReceiptSchema>,
): void {
  const profile = parseJson(
    canary.profile.source,
    profileSourceSchema,
    "GoodMemory profile",
  );
  const setup = parseJson(
    receipt.setupSource,
    setupReceiptSourceSchema,
    "GoodMemory setup receipt",
  ).hosts[0]!;
  const seed = parseJson(
    receipt.seedSource,
    seedReceiptSourceSchema,
    "GoodMemory seed receipt",
  );
  const status = parseJson(
    receipt.statusSource,
    statusReceiptSourceSchema,
    "GoodMemory status receipt",
  ).hosts[0]!;
  const emptyWorkspaceTreeSha256 = sha256("[]");
  if (
    setup.userId !== profile.userId ||
    seed.scope.userId !== profile.userId ||
    seed.storage.location !== profile.storage.path ||
    status.workspaceRoot !== canary.frozen.workspacePath ||
    receipt.workspaceTreeSha256Before !== emptyWorkspaceTreeSha256 ||
    receipt.workspaceTreeSha256After !== emptyWorkspaceTreeSha256
  ) {
    throw new Error("C6 placement installed-host receipt drifted");
  }
}

function stripRequestCommitment(
  placement: C6InstalledHostRequestPlacement,
) {
  return {
    baseRequestSha256: placement.baseRequestSha256,
    contextSegments: placement.contextSegments,
    model: placement.model,
    originalPromptIndex: placement.originalPromptIndex,
    originalPromptJsonPointer: placement.originalPromptJsonPointer,
    originalPromptSha256: placement.originalPromptSha256,
  };
}

function placementGeometry(
  placement: C6InstalledHostRequestPlacement,
) {
  return {
    baseRequestSha256: placement.baseRequestSha256,
    contextSegments: placement.contextSegments.map((segment) => ({
      eventName: segment.eventName,
      jsonPointer: segment.jsonPointer,
      messageIndex: segment.messageIndex,
      relativeToOriginalPrompt: segment.relativeToOriginalPrompt,
      role: segment.role,
    })),
    model: placement.model,
    originalPromptIndex: placement.originalPromptIndex,
    originalPromptJsonPointer: placement.originalPromptJsonPointer,
    originalPromptSha256: placement.originalPromptSha256,
  };
}

function readSingleDeveloperText(
  message: z.infer<typeof requestMessageSchema> | undefined,
  eventName: "SessionStart" | "UserPromptSubmit",
): string {
  if (
    message?.role !== "developer" ||
    message.type !== "message" ||
    message.content.length !== 1
  ) {
    throw new Error(`C6 native hook placement is missing ${eventName}`);
  }
  return message.content[0]!.text;
}

function buildContextSegment(input: {
  eventName: "SessionStart" | "UserPromptSubmit";
  messageIndex: number;
  relativeToOriginalPrompt:
    | "immediately-after"
    | "immediately-before";
  text: string;
}): C6InstalledHostRequestPlacement["contextSegments"][number] {
  return {
    additionalContextSha256: sha256(input.text),
    eventName: input.eventName,
    injectedTokenCount: countC6InjectedTokens(input.text),
    jsonPointer: `/input/${input.messageIndex}/content/0/text`,
    messageIndex: input.messageIndex,
    relativeToOriginalPrompt: input.relativeToOriginalPrompt,
    role: "developer",
    text: input.text,
  };
}

function parseJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  return schema.parse(parseUnknownJson(raw, label));
}

function parseUnknownJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`C6 placement ${label} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

function readResponsesTransportIdentity(
  request: z.infer<typeof responsesRequestSchema>,
): {
  installationId: string;
  threadId: string;
  turnId: string;
  turnStartedAtUnixMs: number;
  windowId: string;
} {
  const client = request.client_metadata;
  const turn = parseJson(
    client["x-codex-turn-metadata"],
    codexTurnMetadataSchema,
    "Codex turn metadata",
  );
  const installationId = client["x-codex-installation-id"];
  const threadId = client.thread_id;
  const turnId = client.turn_id;
  const windowId = client["x-codex-window-id"];
  if (
    request.prompt_cache_key !== threadId ||
    client.session_id !== threadId ||
    windowId !== `${threadId}:0` ||
    turn.installation_id !== installationId ||
    turn.session_id !== threadId ||
    turn.thread_id !== threadId ||
    turn.turn_id !== turnId ||
    turn.window_id !== windowId
  ) {
    throw new Error("C6 placement Codex transport identity drifted");
  }
  return {
    installationId,
    threadId,
    turnId,
    turnStartedAtUnixMs: turn.turn_started_at_unix_ms,
    windowId,
  };
}

function normalizeResponsesRequest(
  request: z.infer<typeof responsesRequestSchema>,
): z.infer<typeof responsesRequestSchema> {
  readResponsesTransportIdentity(request);
  const threadId = "c6-normalized-thread";
  const turnId = "c6-normalized-turn";
  const installationId = "c6-normalized-installation";
  const windowId = `${threadId}:0`;
  return {
    ...request,
    client_metadata: {
      thread_id: threadId,
      turn_id: turnId,
      "x-codex-installation-id": installationId,
      "x-codex-turn-metadata": JSON.stringify({
        installation_id: installationId,
        session_id: threadId,
        thread_id: threadId,
        turn_id: turnId,
        window_id: windowId,
        request_kind: "turn",
        thread_source: "user",
        sandbox: "seccomp",
        turn_started_at_unix_ms: 1,
      }),
      "x-codex-window-id": windowId,
      session_id: threadId,
    },
    prompt_cache_key: threadId,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
