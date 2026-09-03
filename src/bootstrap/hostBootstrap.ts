import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveWorkspaceId,
  writeManagedFile,
  writeMarkerManagedFile,
} from "../host/managedFiles";

export type BootstrapHostKind = "claude" | "codex";

export interface BootstrapHostWorkspaceInput {
  host: BootstrapHostKind;
  userId: string;
  workspaceId?: string;
  workspaceRoot?: string;
}

export interface BootstrapHostWorkspaceFileChange {
  action: "created" | "unchanged" | "updated";
  path: string;
  relativePath: string;
}

export interface BootstrapHostWorkspaceResult {
  changes: BootstrapHostWorkspaceFileChange[];
  exportRootPath: string;
  host: BootstrapHostKind;
  instructionPath: string;
  scriptPath: string;
  userId: string;
  workspaceId: string;
  workspaceRoot: string;
}

interface HostBootstrapBlueprint {
  actionGateScriptFileName?: string;
  artifactHints: string[];
  exportRootRelativePath: string;
  host: BootstrapHostKind;
  hostKindLiteral: BootstrapHostKind;
  hooksConfigFileRelativePath?: string;
  hooksConfigRelativePath?: string;
  instructionFileName: string;
  instructionMarker: {
    end: string;
    start: string;
  };
  readableArtifactTypes: string[];
  requiresSessionId: boolean;
  rulesFileRelativePath?: string;
  runtimeDefault: boolean;
  scriptFileName: string;
}

const HOST_BLUEPRINTS: Record<BootstrapHostKind, HostBootstrapBlueprint> = {
  codex: {
    artifactHints: [
      "./.goodmemory/hosts/codex/session-memory/current.md",
      "./.goodmemory/hosts/codex/MEMORY.md",
      "./.goodmemory/hosts/codex/playbooks/*.md",
    ],
    exportRootRelativePath: ".goodmemory/hosts/codex",
    host: "codex",
    hostKindLiteral: "codex",
    hooksConfigFileRelativePath: ".codex/config.toml",
    hooksConfigRelativePath: ".codex/hooks.json",
    instructionFileName: "AGENTS.md",
    instructionMarker: {
      end: "<!-- GOODMEMORY-BOOTSTRAP:CODEX END -->",
      start: "<!-- GOODMEMORY-BOOTSTRAP:CODEX START -->",
    },
    readableArtifactTypes: ["memory_index", "session_memory", "playbook", "topic_page"],
    requiresSessionId: true,
    rulesFileRelativePath: "codex/rules/goodmemory.rules",
    runtimeDefault: true,
    actionGateScriptFileName: "codex-action.mjs",
    scriptFileName: "codex-export.mjs",
  },
  claude: {
    artifactHints: [
      "./.goodmemory/hosts/claude/MEMORY.md",
      "./.goodmemory/hosts/claude/user.md",
      "./.goodmemory/hosts/claude/playbooks/*.md",
    ],
    exportRootRelativePath: ".goodmemory/hosts/claude",
    host: "claude",
    hostKindLiteral: "claude",
    instructionFileName: "CLAUDE.md",
    instructionMarker: {
      end: "<!-- GOODMEMORY-BOOTSTRAP:CLAUDE END -->",
      start: "<!-- GOODMEMORY-BOOTSTRAP:CLAUDE START -->",
    },
    readableArtifactTypes: ["memory_index", "playbook", "user_memory", "topic_page"],
    requiresSessionId: false,
    runtimeDefault: false,
    scriptFileName: "claude-export.mjs",
  },
};

const CODEX_PRE_TOOL_USE_EVENT = "PreToolUse";
const CODEX_PRE_TOOL_USE_MATCHER = "Bash";
const CODEX_PRE_TOOL_USE_COMMAND =
  '/bin/sh -lc \'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; /usr/bin/env bun "$ROOT/.goodmemory/bootstrap/codex-action.mjs" --hook-pre-tool-use\'';
const CODEX_PRE_TOOL_USE_STATUS = "Checking GoodMemory pre-action policy";
const CODEX_HOOKS_FEATURE_HEADER = "[features]";
const CODEX_HOOKS_FEATURE_FLAG = "hooks = true";

export async function bootstrapHostWorkspace(
  input: BootstrapHostWorkspaceInput,
): Promise<BootstrapHostWorkspaceResult> {
  const blueprint = HOST_BLUEPRINTS[input.host];
  const workspaceRoot = resolve(input.workspaceRoot ?? ".");
  const workspaceId = resolveWorkspaceId(workspaceRoot, input.workspaceId);
  const exportRootPath = join(workspaceRoot, blueprint.exportRootRelativePath);
  const scriptPath = join(
    workspaceRoot,
    ".goodmemory",
    "bootstrap",
    blueprint.scriptFileName,
  );
  const instructionPath = join(workspaceRoot, blueprint.instructionFileName);

  const changes: BootstrapHostWorkspaceFileChange[] = [];
  changes.push(
    await writeManagedFile(
      scriptPath,
      workspaceRoot,
      buildBootstrapScript({
        blueprint,
        userId: input.userId,
        workspaceId,
      }),
    ),
  );
  if (blueprint.host === "codex") {
    changes.push(
      ...(await writeCodexRuntimePolicyFiles({
        blueprint,
        userId: input.userId,
        workspaceId,
        workspaceRoot,
      })),
    );
  }
  changes.unshift(
    await writeMarkerManagedFile(
      instructionPath,
      workspaceRoot,
      blueprint.instructionMarker,
      buildInstructionBlock(blueprint),
    ),
  );

  return {
    changes,
    exportRootPath,
    host: blueprint.host,
    instructionPath,
    scriptPath,
    userId: input.userId,
    workspaceId,
    workspaceRoot,
  };
}

async function writeMergedManagedFile(input: {
  merge(existing: string | null): string;
  path: string;
  workspaceRoot: string;
}): Promise<BootstrapHostWorkspaceFileChange> {
  const existing = await readFileIfPresent(input.path);
  return writeManagedFile(
    input.path,
    input.workspaceRoot,
    input.merge(existing),
    { existingContent: existing },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderManagedJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function createCodexManagedHook(): Record<string, string> {
  return {
    type: "command",
    command: CODEX_PRE_TOOL_USE_COMMAND,
    statusMessage: CODEX_PRE_TOOL_USE_STATUS,
  };
}

function buildInvalidManagedConfigError(path: string, detail: string): Error {
  return new Error(
    `Refusing to overwrite existing ${path}: ${detail}. Remove or fix the repo-local Codex config, then rerun bootstrap.`,
  );
}

function mergeCodexHooksConfig(existing: string | null): string {
  if (existing === null || existing.trim().length === 0) {
    return buildCodexHooksConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(".codex/hooks.json", "file is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      ".codex/hooks.json",
      "root value must be a JSON object",
    );
  }

  const hooksValue = parsed.hooks;
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw buildInvalidManagedConfigError(
      ".codex/hooks.json",
      "`hooks` must stay a JSON object",
    );
  }

  const hooks: Record<string, unknown> = hooksValue ? { ...hooksValue } : {};
  const preToolUseValue = hooks[CODEX_PRE_TOOL_USE_EVENT];
  if (preToolUseValue !== undefined && !Array.isArray(preToolUseValue)) {
    throw buildInvalidManagedConfigError(
      ".codex/hooks.json",
      "`hooks.PreToolUse` must stay an array",
    );
  }

  const preToolUseHooks = [...((preToolUseValue as unknown[] | undefined) ?? [])];
  let bashMatcherMerged = false;
  for (const [index, entry] of preToolUseHooks.entries()) {
    if (!isRecord(entry) || entry.matcher !== CODEX_PRE_TOOL_USE_MATCHER) {
      continue;
    }

    const matcherHooks = entry.hooks;
    if (!Array.isArray(matcherHooks)) {
      throw buildInvalidManagedConfigError(
        ".codex/hooks.json",
        "`hooks.PreToolUse[*].hooks` must stay an array for the Bash matcher",
      );
    }

    let managedHookMerged = false;
    const mergedMatcherHooks = matcherHooks.map((hook) => {
      if (!isRecord(hook) || hook.command !== CODEX_PRE_TOOL_USE_COMMAND) {
        return hook;
      }

      managedHookMerged = true;
      return {
        ...hook,
        ...createCodexManagedHook(),
      };
    });

    if (!managedHookMerged) {
      mergedMatcherHooks.push(createCodexManagedHook());
    }

    preToolUseHooks[index] = {
      ...entry,
      hooks: mergedMatcherHooks,
    };
    bashMatcherMerged = true;
    break;
  }

  if (!bashMatcherMerged) {
    preToolUseHooks.push({
      matcher: CODEX_PRE_TOOL_USE_MATCHER,
      hooks: [createCodexManagedHook()],
    });
  }

  return renderManagedJson({
    ...parsed,
    hooks: {
      ...hooks,
      [CODEX_PRE_TOOL_USE_EVENT]: preToolUseHooks,
    },
  });
}

function isTomlSectionHeader(line: string): boolean {
  return /^\s*\[[^\]]+\]\s*(?:#.*)?$/u.test(line)
    || /^\s*\[\[[^\]]+\]\]\s*(?:#.*)?$/u.test(line);
}

function isCodexHooksFeatureLine(line: string): boolean {
  return /^\s*(?:hooks|codex_hooks)\s*=\s*(?:true|false)\s*(?:#.*)?$/u.test(line);
}

function mergeCodexHooksToml(existing: string | null): string {
  if (existing === null || existing.trim().length === 0) {
    return buildCodexHooksToml();
  }

  if (/^\s*\[\[\s*features\s*\]\]\s*(?:#.*)?$/mu.test(existing)) {
    throw buildInvalidManagedConfigError(
      ".codex/config.toml",
      "`[[features]]` is unsupported for Codex feature flags",
    );
  }

  const lines = existing.replace(/\r\n/gu, "\n").split("\n");
  const featuresHeaderIndex = lines.findIndex((line) =>
    /^\s*\[\s*features\s*\]\s*(?:#.*)?$/u.test(line)
  );

  if (featuresHeaderIndex < 0) {
    const trimmed = existing.trimEnd();
    const separator = trimmed.length === 0 ? "" : "\n\n";
    return `${trimmed}${separator}${CODEX_HOOKS_FEATURE_HEADER}\n${CODEX_HOOKS_FEATURE_FLAG}\n`;
  }

  let featuresSectionEnd = lines.length;
  for (let index = featuresHeaderIndex + 1; index < lines.length; index += 1) {
    if (isTomlSectionHeader(lines[index]!)) {
      featuresSectionEnd = index;
      break;
    }
  }

  const featureBody = lines.slice(featuresHeaderIndex + 1, featuresSectionEnd);
  let replacedExistingFlag = false;
  const updatedFeatureBody = featureBody.map((line) => {
    if (!isCodexHooksFeatureLine(line)) {
      return line;
    }

    replacedExistingFlag = true;
    return CODEX_HOOKS_FEATURE_FLAG;
  });

  if (!replacedExistingFlag) {
    let insertionIndex = 0;
    while (
      insertionIndex < updatedFeatureBody.length
      && /^\s*(?:#.*)?$/u.test(updatedFeatureBody[insertionIndex]!)
    ) {
      insertionIndex += 1;
    }
    updatedFeatureBody.splice(insertionIndex, 0, CODEX_HOOKS_FEATURE_FLAG);
  }

  const merged = [
    ...lines.slice(0, featuresHeaderIndex + 1),
    ...updatedFeatureBody,
    ...lines.slice(featuresSectionEnd),
  ].join("\n");
  return merged.endsWith("\n") ? merged : `${merged}\n`;
}

async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function writeCodexRuntimePolicyFiles(input: {
  blueprint: HostBootstrapBlueprint;
  userId: string;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<BootstrapHostWorkspaceFileChange[]> {
  const actionGateScriptPath = join(
    input.workspaceRoot,
    ".goodmemory",
    "bootstrap",
    input.blueprint.actionGateScriptFileName!,
  );
  const hooksConfigPath = join(
    input.workspaceRoot,
    input.blueprint.hooksConfigRelativePath!,
  );
  const hooksConfigFilePath = join(
    input.workspaceRoot,
    input.blueprint.hooksConfigFileRelativePath!,
  );
  const rulesPath = join(
    input.workspaceRoot,
    input.blueprint.rulesFileRelativePath!,
  );

  return [
    await writeManagedFile(
      actionGateScriptPath,
      input.workspaceRoot,
      buildCodexActionGateScript({
        userId: input.userId,
        workspaceId: input.workspaceId,
      }),
    ),
    await writeMergedManagedFile({
      path: hooksConfigPath,
      workspaceRoot: input.workspaceRoot,
      merge: mergeCodexHooksConfig,
    }),
    await writeMergedManagedFile({
      path: hooksConfigFilePath,
      workspaceRoot: input.workspaceRoot,
      merge: mergeCodexHooksToml,
    }),
    await writeManagedFile(
      rulesPath,
      input.workspaceRoot,
      buildCodexRulesFile(),
    ),
  ];
}

function buildInstructionBlock(blueprint: HostBootstrapBlueprint): string {
  const scriptRelativePath = `./${join(
    ".goodmemory",
    "bootstrap",
    blueprint.scriptFileName,
  )}`;
  const commandSuffix = blueprint.requiresSessionId
    ? " --session-id <session-id>"
    : "";
  const artifactHintLines = blueprint.artifactHints
    .map((artifactPath) => `- \`${artifactPath}\``)
    .join("\n");
  const hostLabel = blueprint.host === "codex" ? "Codex" : "Claude Code";
  const sessionRequirementLine = blueprint.requiresSessionId
    ? `Use the real active session id so \`session-memory/current.md\` maps to a real handoff.`
    : undefined;
  const codexPolicyLines = blueprint.host === "codex"
    ? [
        `For risky Bash commands, route execution through \`bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command "<command>"\` instead of invoking the raw command directly.`,
        `Treat the action-gate wrapper above as the canonical enforced path; the repo-local Codex hook at \`.codex/hooks.json\` and the outside-sandbox rules at \`./codex/rules/goodmemory.rules\` are generated as parity scaffolds when the current Codex runtime supports them.`,
      ]
    : [];

  return [
    `## GoodMemory ${hostLabel} Bootstrap`,
    "",
    `This workspace uses GoodMemory through the installed package surface.`,
    "",
    `Refresh the exported ${hostLabel} artifacts with:`,
    `\`bun ${scriptRelativePath}${commandSuffix}\``,
    "",
    ...(sessionRequirementLine ? [sessionRequirementLine, ""] : []),
    `Read these compiled files when present before repeating a failed procedure or reconstructing context:`,
    artifactHintLines,
    "",
    ...(codexPolicyLines.length > 0 ? [...codexPolicyLines, ""] : []),
    `Treat exported files as compiled guidance, not canonical truth. Update canonical memory through your app or the public GoodMemory APIs, then rerun the export script.`,
  ].join("\n");
}

function buildCodexActionGateScript(input: {
  userId: string;
  workspaceId: string;
}): string {
  const defaultScopeLiteral = `{
  userId: ${JSON.stringify(input.userId)},
  workspaceId: ${JSON.stringify(input.workspaceId)},
}`;

  return `#!/usr/bin/env bun
import { accessSync, constants } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGoodMemory } from "goodmemory";
import {
  createHostAdapter,
  ingestHostAgentEvent,
  resolveHostActionExecutionPlan,
} from "goodmemory/host";

const DEFAULT_SCOPE = ${defaultScopeLiteral};
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, "..", "..");
const ACTION_WRAPPER_RELATIVE_PATH = "./.goodmemory/bootstrap/codex-action.mjs";
const SHELL_BINARY_CANDIDATES = ["/bin/bash", "/bin/sh", "/bin/zsh"];
process.chdir(WORKSPACE_ROOT);

function resolveShellBinary() {
  for (const candidate of SHELL_BINARY_CANDIDATES) {
    if (!candidate || candidate.trim().length === 0) {
      continue;
    }

    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Codex action gate could not resolve a supported shell. Install /bin/bash, /bin/sh, or /bin/zsh.",
  );
}

const SHELL_BINARY = resolveShellBinary();

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const inlineSeparator = token.indexOf("=");
    if (inlineSeparator >= 0) {
      flags[token.slice(2, inlineSeparator)] = token.slice(inlineSeparator + 1);
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      flags[key] = value;
      index += 1;
      continue;
    }

    flags[key] = "true";
  }

  return { flags, positionals };
}

function readTextFlag(flags, name) {
  const value = flags[name];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "true" ? trimmed : undefined;
}

function readIntegerFlag(flags, name, fallback) {
  const value = readTextFlag(flags, name);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function flagEnabled(flags, name) {
  return flags[name] === "true";
}

function shellEscape(value) {
  return \`'\${value.replace(/'/g, "'\\\\''")}'\`;
}

function trimTrailingPeriod(value) {
  return value.replace(/[.\\s]+$/u, "");
}

function buildHookDenial(reason, wrapperCommand) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: \`\${trimTrailingPeriod(reason)}. Run this instead: \${wrapperCommand}\`,
    },
  };
}

function clipText(value, maxLength = 280) {
  if (!value || value.trim().length === 0) {
    return "";
  }

  return value.length <= maxLength
    ? value
    : \`\${value.slice(0, Math.max(0, maxLength - 3))}...\`;
}

function resolveExecutableCommand(step) {
  if (!step) {
    return undefined;
  }

  switch (step.kind) {
    case "warning":
      return undefined;
    case "command":
      return step.command;
    case "tool_call":
      return step.raw?.trim() || undefined;
    case "file_edit":
      return undefined;
  }
}

function summarizeStep(step) {
  if (!step) {
    return undefined;
  }

  switch (step.kind) {
    case "warning":
      return step.message;
    case "command":
      return step.command;
    case "tool_call":
      return step.raw?.trim() || step.toolName;
    case "file_edit":
      return \`\${step.operation} \${step.relativePath}\`;
  }
}

function isManagedCommand(command) {
  return (
    command.includes(".goodmemory/bootstrap/codex-action.mjs") ||
    command.includes(".goodmemory/bootstrap/codex-export.mjs")
  );
}

function buildWrapperCommand(input) {
  return [
    "bun",
    ACTION_WRAPPER_RELATIVE_PATH,
    "--session-id",
    shellEscape(input.sessionId),
    "--command",
    shellEscape(input.command),
  ].join(" ");
}

function resolveCommandToolName(command) {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return "Bash";
  }

  const firstToken = trimmed.split(/\\s+/u)[0];
  return firstToken ? basename(firstToken) : "Bash";
}

function emitStructuredPayload(payload, jsonEnabled) {
  const output = JSON.stringify(payload, null, 2);
  if (jsonEnabled) {
    console.log(output);
  } else {
    console.error(output);
  }
}

function buildNonExecutableRewriteReason(reason, step) {
  const detail = step?.kind === "tool_call"
    ? \`The recommended \${step.toolName} tool call has no shell-equivalent raw command for the Codex action-gate bridge.\`
    : "The recommended first step is not executable on the Codex action-gate bridge.";
  return \`\${reason} \${detail}\`.trim();
}

function classifyToolResultOutcome(exitCode, timedOut) {
  if (timedOut) {
    return "timeout";
  }
  return exitCode === 0 ? "success" : "failure";
}

function createScope(sessionId, flags) {
  return {
    userId: readTextFlag(flags, "user-id") ?? DEFAULT_SCOPE.userId,
    workspaceId: readTextFlag(flags, "workspace-id") ?? DEFAULT_SCOPE.workspaceId,
    ...(sessionId
      ? {
          sessionId,
        }
      : {}),
  };
}

async function runCommand(command) {
  const child = Bun.spawn({
    cmd: [SHELL_BINARY, "-lc", command],
    cwd: WORKSPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return {
    exitCode,
    stderr,
    stdout,
  };
}

async function executeFileEdit(step) {
  const absolutePath = resolve(WORKSPACE_ROOT, step.relativePath);

  if (step.operation === "delete") {
    await rm(absolutePath, { force: true, recursive: true });
    return {
      summary: \`Deleted \${step.relativePath}\`,
    };
  }

  if (step.operation === "create") {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "", "utf8");
    return {
      summary: \`Created \${step.relativePath}\`,
    };
  }

  const existing = await readFile(absolutePath, "utf8").catch(() => "");
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, existing, "utf8");
  return {
    summary: \`Touched \${step.relativePath}\`,
  };
}

async function handleHookMode(flags) {
  const rawInput = await new Response(Bun.stdin.stream()).text();
  const payload = rawInput.trim().length > 0 ? JSON.parse(rawInput) : {};

  if (payload.hook_event_name !== "PreToolUse" || payload.tool_name !== "Bash") {
    return;
  }

  const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
  const turnId =
    typeof payload.turn_id === "string" && payload.turn_id.trim().length > 0
      ? payload.turn_id
      : "goodmemory-hook-turn";
  const command =
    typeof payload.tool_input?.command === "string"
      ? payload.tool_input.command.trim()
      : "";

  if (!sessionId || command.length === 0 || isManagedCommand(command)) {
    return;
  }

  const scope = createScope(sessionId, flags);
  const memory = createGoodMemory({});
  const adapter = createHostAdapter({
    id: "goodmemory-codex-hook",
    hostKind: "codex",
    memory,
  });
  const actionId = \`goodmemory-hook-\${turnId}\`;
  const assessment = await adapter.assessAction({
    actionId,
    runId: "goodmemory-codex-hook",
    turnId,
    sequence: 0,
    occurredAt: new Date().toISOString(),
    hostKind: "codex",
    scope,
    action: {
      kind: "command",
      command,
    },
  });

  if (assessment.decision === "allow" || assessment.decision === "allow_with_guidance") {
    return;
  }

  console.log(
    JSON.stringify(
      buildHookDenial(
        assessment.reason,
        buildWrapperCommand({
          command,
          sessionId,
        }),
      ),
      null,
      2,
    ),
  );
}

async function handleActionMode(flags, positionals) {
  const sessionId = readTextFlag(flags, "session-id");
  if (!sessionId) {
    console.error(
      "Codex action gate requires --session-id <session-id> to bind memory-backed policy to a real host session.",
    );
    process.exit(1);
  }

  const command = readTextFlag(flags, "command") ?? positionals.join(" ").trim();
  if (!command) {
    console.error(
      "Codex action gate requires --command <command> or command tokens after --.",
    );
    process.exit(1);
  }

  const scope = createScope(sessionId, flags);
  const actionId = readTextFlag(flags, "action-id") ?? crypto.randomUUID();
  const turnId = readTextFlag(flags, "turn-id") ?? \`goodmemory-action-\${actionId}\`;
  const sequence = readIntegerFlag(flags, "sequence", 0);
  const occurredAt = new Date().toISOString();
  const memory = createGoodMemory({});
  const adapter = createHostAdapter({
    id: "goodmemory-codex-action",
    hostKind: "codex",
    memory,
  });
  const intent = {
    actionId,
    runId: "goodmemory-codex-action",
    turnId,
    sequence,
    occurredAt,
    hostKind: "codex",
    scope,
    action: {
      kind: "command",
      command,
    },
  };
  const assessment = await adapter.assessAction(intent);
  const plan = resolveHostActionExecutionPlan({
    assessment,
    intent,
  });
  const jsonEnabled = flagEnabled(flags, "json");

  if (plan.blocked || plan.effectiveFirstStep?.kind === "warning") {
    const payload = {
      actionId,
      decision: assessment.decision,
      executed: false,
      reason: assessment.reason,
      recommendedFirstStep: summarizeStep(plan.effectiveFirstStep),
      realizedEventParentId: plan.realizedEventParentId,
      rewritten: plan.rewritten,
    };
    emitStructuredPayload(payload, jsonEnabled);
    process.exit(2);
  }

  const executedStep = plan.effectiveFirstStep;
  const executableCommand =
    executedStep.kind === "file_edit"
      ? undefined
      : resolveExecutableCommand(executedStep);
  if (executedStep.kind === "tool_call" && !executableCommand) {
    emitStructuredPayload(
      {
        actionId,
        decision: assessment.decision,
        executed: false,
        reason: buildNonExecutableRewriteReason(assessment.reason, executedStep),
        recommendedFirstStep: summarizeStep(executedStep),
        realizedEventParentId: plan.realizedEventParentId,
        rewritten: plan.rewritten,
      },
      jsonEnabled,
    );
    process.exit(2);
  }
  const eventIdBase = \`goodmemory-host-\${actionId}\`;
  const executedToolName =
    executedStep.kind === "file_edit"
      ? undefined
      : executedStep.kind === "tool_call"
        ? executedStep.toolName
        : resolveCommandToolName(executableCommand);

  if (executedStep.kind !== "file_edit") {
    await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_call",
      eventId: \`\${eventIdBase}-call\`,
      runId: "goodmemory-codex-action",
      turnId,
      sequence,
      occurredAt,
      hostKind: "codex",
      scope,
      parentEventId: plan.realizedEventParentId,
      toolName: executedToolName,
      raw: executableCommand,
      payload: {
        command: executableCommand,
        originalAction: command,
        rewritten: plan.rewritten,
        ...(executedStep.kind === "tool_call" && executedStep.payload !== undefined
          ? { structuredPayload: executedStep.payload }
          : {}),
      },
    });
  }

  let executionSummary = "";
  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  try {
    if (executedStep.kind === "file_edit") {
      const result = await executeFileEdit(executedStep);
      executionSummary = result.summary;
      await ingestHostAgentEvent(memory, {
        surface: "host",
        kind: "file_edit",
        eventId: \`\${eventIdBase}-file\`,
        runId: "goodmemory-codex-action",
        turnId,
        sequence: sequence + 1,
        occurredAt: new Date().toISOString(),
        hostKind: "codex",
        scope,
        parentEventId: plan.realizedEventParentId,
        operation: executedStep.operation,
        relativePath: executedStep.relativePath,
        summary: result.summary,
      });
    } else {
      const result = await runCommand(executableCommand);
      exitCode = result.exitCode;
      stdout = result.stdout;
      stderr = result.stderr;
      executionSummary = clipText(
        [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\\n"),
      );
      await ingestHostAgentEvent(memory, {
        surface: "host",
        kind: "tool_result",
        eventId: \`\${eventIdBase}-result\`,
        runId: "goodmemory-codex-action",
        turnId,
        sequence: sequence + 1,
        occurredAt: new Date().toISOString(),
        hostKind: "codex",
        scope,
        parentEventId: plan.realizedEventParentId,
        toolName: executedToolName,
        outcome: classifyToolResultOutcome(result.exitCode, false),
        excerpt: executionSummary || \`Command exited with code \${result.exitCode}.\`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    executionSummary = clipText(message);
    exitCode = 1;
    if (executedStep.kind !== "file_edit") {
      await ingestHostAgentEvent(memory, {
        surface: "host",
        kind: "tool_result",
        eventId: \`\${eventIdBase}-result\`,
        runId: "goodmemory-codex-action",
        turnId,
        sequence: sequence + 1,
        occurredAt: new Date().toISOString(),
        hostKind: "codex",
        scope,
        parentEventId: plan.realizedEventParentId,
        toolName: executedToolName,
        outcome: "failure",
        excerpt: executionSummary || "Codex action gate execution failed.",
      });
    }
    const output = JSON.stringify(
      {
        actionId,
        decision: assessment.decision,
        error: message,
        executed: false,
        executedStep: summarizeStep(executedStep),
        realizedEventParentId: plan.realizedEventParentId,
        rewritten: plan.rewritten,
      },
      null,
      2,
    );
    if (jsonEnabled) {
      console.log(output);
    } else {
      console.error(output);
    }
    process.exit(exitCode);
  }

  const output = JSON.stringify(
    {
      actionId,
      decision: assessment.decision,
      executed: true,
      executedStep: summarizeStep(executedStep),
      executionSummary,
      originalAction: command,
      realizedEventParentId: plan.realizedEventParentId,
      rewritten: plan.rewritten,
      originalActionDeferred: plan.rewritten,
      exitCode,
      ...(stdout.trim().length > 0 ? { stdout: stdout.trim() } : {}),
      ...(stderr.trim().length > 0 ? { stderr: stderr.trim() } : {}),
    },
    null,
    2,
  );

  console.log(output);
  process.exit(exitCode);
}

const { flags, positionals } = parseArgs(process.argv.slice(2));

if (flagEnabled(flags, "hook-pre-tool-use")) {
  await handleHookMode(flags);
} else {
  await handleActionMode(flags, positionals);
}
`;
}

function buildCodexHooksConfig(): string {
  return JSON.stringify(
    {
      hooks: {
        [CODEX_PRE_TOOL_USE_EVENT]: [
          {
            matcher: CODEX_PRE_TOOL_USE_MATCHER,
            hooks: [createCodexManagedHook()],
          },
        ],
      },
    },
    null,
    2,
  ) + "\n";
}

function buildCodexHooksToml(): string {
  return [
    CODEX_HOOKS_FEATURE_HEADER,
    CODEX_HOOKS_FEATURE_FLAG,
    "",
  ].join("\n");
}

function buildCodexRulesFile(): string {
  return [
    "# GoodMemory Codex pre-action policy for outside-sandbox commands.",
    "",
    "prefix_rule(",
    '    pattern = ["deploy"],',
    '    decision = "forbidden",',
    '    justification = "Route deploy commands through `bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command \\"deploy ...\\"` so GoodMemory can assess or rewrite the first step.",',
    '    match = ["deploy production"],',
    "    not_match = [\"./scripts/deploy-helper.sh\"],",
    ")",
    "",
    "prefix_rule(",
    '    pattern = ["DeepAnalyzer"],',
    '    decision = "forbidden",',
    '    justification = "Route DeepAnalyzer through the GoodMemory Codex action gate. The policy may require `QuickCheck` first.",',
    '    match = ["DeepAnalyzer --detailed"],',
    '    not_match = ["QuickCheck --network"],',
    ")",
    "",
    "prefix_rule(",
    '    pattern = ["rm", "-rf"],',
    '    decision = "forbidden",',
    '    justification = "Route destructive deletes through `bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command \\"rm -rf ...\\"` so GoodMemory can veto or redirect them.",',
    '    match = ["rm -rf AGENTS.md"],',
    '    not_match = ["rm AGENTS.md"],',
    ")",
    "",
  ].join("\n");
}

function buildBootstrapScript(input: {
  blueprint: HostBootstrapBlueprint;
  userId: string;
  workspaceId: string;
}): string {
  const { blueprint, userId, workspaceId } = input;
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const packageIndexUrl = pathToFileURL(join(packageRoot, "dist", "index.js")).href;
  const packageHostUrl = pathToFileURL(
    join(packageRoot, "dist", "host", "index.js"),
  ).href;
  const artifactTypesLiteral = JSON.stringify(blueprint.readableArtifactTypes);
  const exportRootLiteral = JSON.stringify(blueprint.exportRootRelativePath);
  const packageIndexUrlLiteral = JSON.stringify(packageIndexUrl);
  const packageHostUrlLiteral = JSON.stringify(packageHostUrl);
  const defaultScopeLiteral = `{
  userId: ${JSON.stringify(userId)},
  workspaceId: ${JSON.stringify(workspaceId)},
}`;
  const sessionIdRequiredLiteral = blueprint.requiresSessionId ? "true" : "false";
  const sessionIdRequiredMessageLiteral = JSON.stringify(
    `${blueprint.host === "codex" ? "Codex" : "Claude Code"} export requires --session-id <session-id> to target a real session handoff.`,
  );

  return `#!/usr/bin/env bun
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCOPE = ${defaultScopeLiteral};
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, "..", "..");
process.chdir(WORKSPACE_ROOT);
const OUTPUT_ROOT = resolve(WORKSPACE_ROOT, ${exportRootLiteral});
const READABLE_ARTIFACT_TYPES = ${artifactTypesLiteral};
const INCLUDE_RUNTIME_BY_DEFAULT = ${blueprint.runtimeDefault ? "true" : "false"};
const SESSION_ID_REQUIRED = ${sessionIdRequiredLiteral};
const PACKAGE_INDEX_URL = ${packageIndexUrlLiteral};
const PACKAGE_HOST_URL = ${packageHostUrlLiteral};

function parseArgs(argv) {
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const inlineSeparator = token.indexOf("=");
    if (inlineSeparator >= 0) {
      flags[token.slice(2, inlineSeparator)] = token.slice(inlineSeparator + 1);
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      flags[key] = value;
      index += 1;
      continue;
    }

    flags[key] = "true";
  }

  return flags;
}

function flagEnabled(flags, name) {
  return flags[name] === "true";
}

function readTextFlag(flags, name) {
  const value = flags[name];

  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "true" ? trimmed : undefined;
}

function isPackageResolutionError(error) {
  const message = String(error?.message ?? "");
  return message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("while resolving package 'goodmemory'");
}

async function importGoodMemoryPackages() {
  try {
    return await Promise.all([
      import("goodmemory"),
      import("goodmemory/host"),
    ]);
  } catch (error) {
    if (!isPackageResolutionError(error)) {
      throw error;
    }
    return Promise.all([
      import(PACKAGE_INDEX_URL),
      import(PACKAGE_HOST_URL),
    ]);
  }
}

const flags = parseArgs(process.argv.slice(2));
const sessionId = readTextFlag(flags, "session-id");

if (SESSION_ID_REQUIRED && !sessionId) {
  console.error(${sessionIdRequiredMessageLiteral});
  process.exit(1);
}

const scope = {
  userId: readTextFlag(flags, "user-id") ?? DEFAULT_SCOPE.userId,
  workspaceId: readTextFlag(flags, "workspace-id") ?? DEFAULT_SCOPE.workspaceId,
  ...(sessionId
    ? {
        sessionId,
      }
    : {}),
};

const [{ createGoodMemory }, { createHostAdapter }] =
  await importGoodMemoryPackages();

const memory = createGoodMemory({});
const adapter = createHostAdapter({
  id: "goodmemory-${blueprint.host}-bootstrap",
  hostKind: ${JSON.stringify(blueprint.hostKindLiteral)},
  memory,
  readableArtifactTypes: READABLE_ARTIFACT_TYPES,
});
const result = await adapter.readArtifacts({
  scope,
  includeRuntime: flagEnabled(flags, "include-runtime") || INCLUDE_RUNTIME_BY_DEFAULT,
});

await rm(OUTPUT_ROOT, { recursive: true, force: true });

for (const artifact of result.artifacts) {
  const artifactPath = resolve(OUTPUT_ROOT, artifact.relativePath);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, artifact.content, "utf8");

  if (artifact.artifactType === "session_memory") {
    const currentPath = resolve(OUTPUT_ROOT, "session-memory/current.md");
    await mkdir(dirname(currentPath), { recursive: true });
    await writeFile(currentPath, artifact.content, "utf8");
  }
}

const manifestArtifacts = result.artifacts.flatMap((artifact) =>
  artifact.artifactType === "session_memory"
    ? [
        {
          artifactType: artifact.artifactType,
          relativePath: artifact.relativePath,
        },
        {
          artifactType: artifact.artifactType,
          relativePath: "session-memory/current.md",
        },
      ]
    : [
        {
          artifactType: artifact.artifactType,
          relativePath: artifact.relativePath,
        },
      ]
);

const manifest = {
  artifactCount: manifestArtifacts.length,
  artifacts: manifestArtifacts,
  exportedAt: new Date().toISOString(),
  host: ${JSON.stringify(blueprint.host)},
  outputRoot: OUTPUT_ROOT,
  scope,
};

await mkdir(OUTPUT_ROOT, { recursive: true });
await writeFile(
  resolve(OUTPUT_ROOT, "export-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\\n",
  "utf8",
);

console.log(JSON.stringify(manifest, null, 2));
`;
}
