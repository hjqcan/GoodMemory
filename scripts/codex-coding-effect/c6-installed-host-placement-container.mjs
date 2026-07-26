import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";

const gm = "/work/goodmemory/consumer/node_modules/.bin/goodmemory";
const codex = "/work/codex/consumer/node_modules/.bin/codex";
const realPath = [
  "/work/codex/consumer/node_modules/.bin",
  "/work/goodmemory/consumer/node_modules/.bin",
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
].join(":");
const runInput = JSON.parse(
  await readFile("/work/run-input.json", "utf8"),
);
const transport = JSON.parse(
  await readFile("/runner/transport.json", "utf8"),
);
if (
  await readFile("/runner/flat-summary-output.txt", "utf8") !==
    transport.flatSummaryControl?.output
) {
  throw new Error("flat-summary runner output drifted");
}
const CODEX_HOME = "/work/home/.codex";
const baseEnv = {
  CODEX_HOME,
  GOODMEMORY_BUN_BINARY: "/usr/local/bin/bun",
  GOODMEMORY_HOME: "/work/home",
  HOME: "/work/home",
  LANG: "C.UTF-8",
  NPM_CONFIG_GLOBALCONFIG: "/work/empty-global.npmrc",
  NPM_CONFIG_USERCONFIG: "/work/empty-user.npmrc",
  NO_COLOR: "1",
  PATH: realPath,
  npm_config_update_notifier: "false",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function runRequired(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? "/work/workspace",
    encoding: "utf8",
    env: options.env ?? baseEnv,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(
      `${executable} failed (${String(result.status)}): `
      + `${String(result.error ?? "")} ${String(result.stderr).trim()}`,
    );
  }
  return String(result.stdout);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function treeSha256(root) {
  const entries = [];
  async function walk(directory, prefix = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = `${directory}/${child.name}`;
      const relativePath = prefix.length === 0
        ? child.name
        : `${prefix}/${child.name}`;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          target: await readlink(path),
          type: "symlink",
        });
      } else if (stat.isDirectory()) {
        entries.push({ path: relativePath, type: "directory" });
        await walk(path, relativePath);
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          sha256: await sha256File(path),
          type: "file",
        });
      } else {
        throw new Error(`unsupported tree entry ${relativePath}`);
      }
    }
  }
  await walk(root);
  return sha256(JSON.stringify(entries));
}

async function runnerSourceSha256() {
  const [
    canaryModule,
    flatSummaryHook,
    flatSummaryOutput,
    mirrorHook,
    runScript,
  ] = await Promise.all([
    readFile("/runner/canary.mjs", "utf8"),
    readFile("/runner/flat-summary-hook.mjs", "utf8"),
    readFile("/runner/flat-summary-output.txt", "utf8"),
    readFile("/runner/mirror-hook.mjs", "utf8"),
    readFile("/runner/run.sh", "utf8"),
  ]);
  return sha256(JSON.stringify({
    canaryModule,
    flatSummaryHook,
    flatSummaryOutput,
    mirrorHook,
    runScript,
    schemaVersion: 2,
    transport,
  }));
}

const workspaceTreeSha256Before = await treeSha256(
  runInput.workspacePath,
);
if (workspaceTreeSha256Before !== sha256("[]")) {
  throw new Error("C6 placement workspace was not initially empty");
}

const goodmemoryVersionOutput = runRequired(gm, ["--version"]).trim();
const codexVersion = runRequired(codex, ["--version"]).trim();
if (
  goodmemoryVersionOutput !== "goodmemory 0.7.0" ||
  codexVersion !== "codex-cli 0.145.0"
) {
  throw new Error("installed package version drifted");
}

const setupSource = runRequired(gm, [
  "setup",
  "--recommended",
  "--host",
  "codex",
  "--user-id",
  "c6-placement-user",
  "--yes",
  "--json",
]);
const setup = parseJson(setupSource, "GoodMemory setup");
if (
  !Array.isArray(setup.hosts) ||
  setup.hosts.length !== 1 ||
  setup.hosts[0]?.host !== "codex" ||
  setup.hosts[0]?.activationMode !== "global" ||
  setup.hosts[0]?.contextMode !== "fragment" ||
  setup.hosts[0]?.writeback?.mode !== "selective" ||
  setup.hosts[0]?.writeback?.persistRawTranscript !== false
) {
  throw new Error("recommended GoodMemory setup profile drifted");
}

const profilePath = "/work/home/.goodmemory/codex.json";
const hookConfigPath = "/work/home/.codex/hooks.json";
const codexConfigPath = "/work/home/.codex/config.toml";
const setupCodexConfig = await readFile(codexConfigPath, "utf8");
if (setupCodexConfig !== transport.recommendedCodexConfigSource) {
  throw new Error("recommended GoodMemory Codex composition drifted");
}

const profile = parseJson(
  await readFile(profilePath, "utf8"),
  "GoodMemory profile",
);
if (
  profile.contextMode !== "fragment" ||
  profile.maxTokens !== 512 ||
  profile.sessionStartMaxTokens !== 1024 ||
  profile.promptInjection !== "relevance_gated"
) {
  throw new Error("recommended GoodMemory injection profile drifted");
}
profile.promptInjection = "always";
const profileSource = `${JSON.stringify(profile, null, 2)}\n`;
await writeFile(profilePath, profileSource);

const seedSource = runRequired(gm, [
  "remember",
  "--host",
  "codex",
  "--workspace-root",
  runInput.workspacePath,
  "--message",
  transport.seedMessage,
  "--role",
  "user",
  "--extraction-strategy",
  "rules-only",
  "--json",
]);
const seed = parseJson(seedSource, "GoodMemory seed");
if (
  seed.accepted !== 1 ||
  seed.rejected !== 0 ||
  !Array.isArray(seed.events) ||
  seed.events.length !== 1 ||
  seed.events[0]?.memoryType !== "fact" ||
  seed.events[0]?.outcome !== "written"
) {
  throw new Error("GoodMemory placement seed was not accepted exactly once");
}

const statusSource = runRequired(gm, [
  "status",
  "codex",
  "--workspace-root",
  runInput.workspacePath,
  "--json",
]);
const status = parseJson(statusSource, "GoodMemory status");
const statusHost = status.hosts?.[0];
if (
  statusHost?.host !== "codex" ||
  statusHost?.hookRegistered !== true ||
  statusHost?.mcpRegistered !== true ||
  statusHost?.preActionRegistered !== true ||
  statusHost?.memoryStatus !== "ok" ||
  statusHost?.workspaceStatus !== "ok" ||
  statusHost?.counts?.facts !== 1 ||
  Object.entries(statusHost?.counts ?? {}).some(
    ([name, count]) => name !== "facts" && count !== 0,
  ) ||
  statusHost?.writeback?.mode !== "selective" ||
  statusHost?.writeback?.persistRawTranscript !== false
) {
  throw new Error("GoodMemory installed-host status drifted");
}

const goodmemoryHookConfig = await readFile(hookConfigPath, "utf8");
if (transport.codexConfigSource !== runInput.codexConfigSource) {
  throw new Error("container transport config drifted");
}
await writeFile(codexConfigPath, transport.codexConfigSource);
await cp("/work/home", "/work/home-baseline", {
  recursive: true,
});
const baselineHomeTreeSha256 = await treeSha256(
  "/work/home-baseline",
);
await mkdir("/work/instrumented-bin", { recursive: true });
await writeFile(
  "/work/instrumented-bin/goodmemory",
  transport.goodmemoryWrapperSource,
);
await chmod("/work/instrumented-bin/goodmemory", 0o755);

const instrumentedEnv = {
  ...baseEnv,
  C6_MOCK_API_KEY: "c6-local-loopback-nonsecret",
  PATH: `/work/instrumented-bin:${realPath}`,
};

async function restoreHome(hookConfigSource) {
  await rm("/work/home", { force: true, recursive: true });
  await cp("/work/home-baseline", "/work/home", {
    recursive: true,
  });
  if (
    await readFile(codexConfigPath, "utf8") !==
      transport.codexConfigSource ||
    await readFile(profilePath, "utf8") !== profileSource ||
    await treeSha256("/work/home") !== baselineHomeTreeSha256 ||
    await treeSha256(runInput.workspacePath) !== sha256("[]")
  ) {
    throw new Error("C6 placement arm baseline restore drifted");
  }
  await writeFile(hookConfigPath, hookConfigSource);
  if (await readFile(hookConfigPath, "utf8") !== hookConfigSource) {
    throw new Error("C6 placement arm hook config drifted");
  }
}

async function runCodexArm(input) {
  const requestBodies = [];
  const requestMetadata = [];
  let requestBytes = 0;
  let invalidRequest = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
      requestBytes += chunk.length;
      if (requestBytes > 4 * 1024 * 1024) {
        invalidRequest = "request-too-large";
        request.destroy();
        return;
      }
    }
    const body = Buffer.concat(chunks);
    requestBodies.push(body);
    requestMetadata.push({
      method: request.method,
      path: request.url,
    });
    if (
      request.method !== "POST" ||
      request.url !== "/v1/responses" ||
      request.headers.authorization !==
        "Bearer c6-local-loopback-nonsecret"
    ) {
      invalidRequest = "unexpected-request";
      response.writeHead(400);
      response.end();
      return;
    }
    const responseId = `resp-c6-${input.arm}`;
    const events = [
      {
        response: { id: responseId },
        type: "response.created",
      },
      {
        item: {
          content: [{
            text: transport.assistantMessage,
            type: "output_text",
          }],
          id: `msg-c6-${input.arm}`,
          role: "assistant",
          type: "message",
        },
        type: "response.output_item.done",
      },
      {
        response: {
          id: responseId,
          usage: {
            input_tokens: 0,
            input_tokens_details: null,
            output_tokens: 0,
            output_tokens_details: null,
            total_tokens: 0,
          },
        },
        type: "response.completed",
      },
    ];
    const stream = events.map((event) =>
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    ).join("");
    response.writeHead(200, {
      connection: "close",
      "content-length": Buffer.byteLength(stream),
      "content-type": "text/event-stream",
    });
    response.end(stream);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(runInput.loopbackPort, "127.0.0.1", resolve);
  });

  const child = spawn(codex, input.arguments, {
    cwd: runInput.workspacePath,
    env: {
      ...instrumentedEnv,
      CODEX_HOME,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  let timedOut = false;
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  }).finally(() =>
    new Promise((resolve) => server.close(resolve))
  );
  const codexJsonl = Buffer.concat(stdout).toString("utf8");
  await writeFile(
    `/work/capture/${input.arm}.stderr.txt`,
    Buffer.concat(stderr),
  );
  if (
    exitCode !== 0 ||
    timedOut ||
    invalidRequest !== null ||
    requestBodies.length !== 1 ||
    requestMetadata.length !== 1
  ) {
    throw new Error(
      `Codex ${input.arm} capture failed: exit=${String(exitCode)} `
      + `requests=${String(requestBodies.length)} invalid=${String(invalidRequest)}`,
    );
  }
  return {
    arm: input.arm,
    codexExitCode: 0,
    codexJsonl,
    hookEvents: [],
    mockExternalRequestCount: 0,
    originalPrompt: runInput.originalPrompt,
    requestCount: 1,
    requestMethod: requestMetadata[0].method,
    requestPath: requestMetadata[0].path,
    rawRequestBody: requestBodies[0].toString("utf8"),
    stopHookEvent: null,
  };
}

await restoreHome(goodmemoryHookConfig);
const goodmemory = await runCodexArm({
  arguments: transport.goodmemoryArguments,
  arm: "goodmemory-installed",
});

async function capturedHookEvent(
  root,
  prefix,
  eventName,
  maxTokens,
  sequence,
) {
  const status = (
    await readFile(`${root}/${prefix}.status`, "utf8")
  ).trim();
  if (status !== "0") {
    throw new Error(`${eventName} hook failed`);
  }
  return {
    maxTokens,
    rawInput: await readFile(`${root}/${prefix}.stdin.json`, "utf8"),
    rawOutput: await readFile(`${root}/${prefix}.stdout.json`, "utf8"),
    sequence,
    status: 0,
  };
}

async function requireHookSequence(root, expected) {
  const source = await readFile(`${root}/sequence.txt`, "utf8");
  const observed = source.trimEnd().split("\n");
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `hook sequence drifted: ${JSON.stringify(observed)}`,
    );
  }
  return source;
}

goodmemory.hookEvents = [
  await capturedHookEvent(
    "/work/capture/goodmemory-hooks",
    "000-session-start",
    "SessionStart",
    profile.sessionStartMaxTokens,
    0,
  ),
  await capturedHookEvent(
    "/work/capture/goodmemory-hooks",
    "001-user-prompt-submit",
    "UserPromptSubmit",
    profile.maxTokens,
    1,
  ),
];
await requireHookSequence(
  "/work/capture/goodmemory-hooks",
  ["session-start", "user-prompt-submit", "session-stop"],
);
const stopStatus = (
  await readFile(
    "/work/capture/goodmemory-hooks/002-session-stop.status",
    "utf8",
  )
).trim();
if (stopStatus !== "0") {
  throw new Error("GoodMemory Stop hook failed");
}
goodmemory.stopHookEvent = {
  rawInput: await readFile(
    "/work/capture/goodmemory-hooks/002-session-stop.stdin.json",
    "utf8",
  ),
  rawOutput: await readFile(
    "/work/capture/goodmemory-hooks/002-session-stop.stdout.json",
    "utf8",
  ),
  sequence: 2,
  status: 0,
};
const sessionContext = parseJson(
  goodmemory.hookEvents[0].rawOutput,
  "SessionStart output",
).hookSpecificOutput?.additionalContext;
const promptContext = parseJson(
  goodmemory.hookEvents[1].rawOutput,
  "UserPromptSubmit output",
).hookSpecificOutput?.additionalContext;
if (
  typeof sessionContext !== "string" ||
  !sessionContext.includes(transport.sentinel) ||
  sessionContext.trim() === "Developer memory notes:" ||
  typeof promptContext !== "string" ||
  !promptContext.includes(transport.sentinel) ||
  promptContext.trim() === "Developer memory notes:"
) {
  throw new Error(
    "GoodMemory hooks did not bind the seed and prompt: "
    + JSON.stringify({ promptContext, sessionContext }),
  );
}
await writeFile("/work/capture/session-context.txt", sessionContext);
await writeFile("/work/capture/prompt-context.txt", promptContext);

const sequenceBeforeControls = await requireHookSequence(
  "/work/capture/goodmemory-hooks",
  ["session-start", "user-prompt-submit", "session-stop"],
);
await restoreHome(goodmemoryHookConfig);
const hooksDisabled = await runCodexArm({
  arguments: transport.hooksDisabledArguments,
  arm: "installed-host-hooks-disabled-control",
});
if (
  await readFile(
    "/work/capture/goodmemory-hooks/sequence.txt",
    "utf8",
  ) !== sequenceBeforeControls
) {
  throw new Error("hooks-disabled control executed a GoodMemory hook");
}

await restoreHome(transport.mirroredHookConfigSource);
const mirroredHook = await runCodexArm({
  arguments: transport.mirroredArguments,
  arm: "mirrored-hook-control",
});
await requireHookSequence(
  "/work/capture/mirrored-hooks",
  ["session-start", "user-prompt-submit"],
);
mirroredHook.hookEvents = [
  await capturedHookEvent(
    "/work/capture/mirrored-hooks",
    "000-session-start",
    "SessionStart",
    profile.sessionStartMaxTokens,
    0,
  ),
  await capturedHookEvent(
    "/work/capture/mirrored-hooks",
    "001-user-prompt-submit",
    "UserPromptSubmit",
    profile.maxTokens,
    1,
  ),
];
if (
  await readFile(
    "/work/capture/goodmemory-hooks/sequence.txt",
    "utf8",
  ) !== sequenceBeforeControls
) {
  throw new Error("mirrored control executed a GoodMemory hook");
}

await restoreHome(transport.flatSummaryHookConfigSource);
const flatSummaryHook = await runCodexArm({
  arguments: transport.flatSummaryArguments,
  arm: "flat-summary-hook-control",
});
await requireHookSequence(
  "/work/capture/flat-summary-hooks",
  ["session-start", "user-prompt-submit"],
);
flatSummaryHook.hookEvents = [
  await capturedHookEvent(
    "/work/capture/flat-summary-hooks",
    "000-session-start",
    "SessionStart",
    profile.sessionStartMaxTokens,
    0,
  ),
  await capturedHookEvent(
    "/work/capture/flat-summary-hooks",
    "001-user-prompt-submit",
    "UserPromptSubmit",
    profile.maxTokens,
    1,
  ),
];
if (
  await readFile(
    "/work/capture/goodmemory-hooks/sequence.txt",
    "utf8",
  ) !== sequenceBeforeControls
) {
  throw new Error("flat-summary control executed a GoodMemory hook");
}

const workspaceTreeSha256After = await treeSha256(
  runInput.workspacePath,
);
if (workspaceTreeSha256After !== workspaceTreeSha256Before) {
  throw new Error("C6 placement workspace changed during capture");
}
const observedRunnerSourceSha256 = await runnerSourceSha256();
if (
  observedRunnerSourceSha256 !== runInput.runnerSourceSha256
) {
  throw new Error("C6 placement runner source identity drifted");
}

const capture = {
  arms: {
    flatSummaryHook,
    goodmemory,
    hooksDisabled,
    mirroredHook,
  },
  declaredFreshRootIdentitySha256:
    runInput.declaredFreshRootIdentitySha256,
  installedHost: {
    seedMessage: transport.seedMessage,
    seedSource,
    setupSource,
    statusSource,
    workspaceTreeSha256After,
    workspaceTreeSha256Before,
  },
  observed: {
    codexLinuxTarballSha256: await sha256File(
      "/codex-tarballs/openai-codex-0.145.0-linux-x64.tgz",
    ),
    codexMainTarballSha256: await sha256File(
      "/codex-tarballs/openai-codex-0.145.0.tgz",
    ),
    codexVersion,
    goodmemoryPackageSha256: await sha256File(
      "/closure/package/goodmemory-0.7.0.tgz",
    ),
    goodmemoryVersion: "0.7.0",
    imageSha256: runInput.imageSha256,
    runnerSourceSha256: observedRunnerSourceSha256,
  },
  profile: {
    goodmemoryHookConfig,
    recommendedCodexConfigSource: setupCodexConfig,
    source: profileSource,
  },
  runId: runInput.runId,
};
await writeFile(
  "/work/capture.json",
  `${JSON.stringify(capture, null, 2)}\n`,
  { flag: "wx" },
);
