import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const API_ROOT = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";
const USER_AGENT = "goodmemory-c6-github-rest-capture/1";
const PAGE_SIZE = 100;
const REQUIRED_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "etag",
  "x-github-api-version-selected",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;

type CapturedResponseHeaders = Record<
  typeof REQUIRED_RESPONSE_HEADERS[number],
  string
> & {
  link: string | null;
};

type Endpoint =
  | "commits"
  | "issue"
  | "issue-comments"
  | "pull"
  | "pull-discussion-comments"
  | "review-comments"
  | "reviews";

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface CapturedRequest {
  endpoint: Endpoint;
  issueNumber: number | null;
  page: number | null;
  request: {
    headers: {
      accept: typeof ACCEPT;
      authorization: "redacted";
      "user-agent": typeof USER_AGENT;
      "x-github-api-version": typeof API_VERSION;
    };
    method: "GET";
    url: string;
  };
  response: {
    headers: CapturedResponseHeaders;
    rawBody: ArtifactReference;
    status: 200;
  };
}

interface IssueCounts {
  comments: number;
}

interface PullCounts {
  comments: number;
  commits: number;
  repositoryId: number;
  reviewComments: number;
}

interface CapturedBody {
  bytes: Buffer;
  path: string;
}

export type C6GitHubFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface C6GitHubRestCaptureInput {
  authorizationToken: string;
  outputDirectory: string;
  owner: string;
  pullNumber: number;
  repository: string;
  resolvedIssueNumbers: readonly number[];
}

export interface C6GitHubRestCaptureManifest {
  boundary: {
    authorizationRecordedAs: "redacted";
    bearerAuthorizationHeaderSent: true;
    cryptographicPlatformReceipt: false;
    httpsUrlEnforced: true;
    platformAuthenticationCryptographicallyProven: false;
    status:
      "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt";
    tlsPeerReceiptCaptured: false;
  };
  generatedBy:
    "scripts/codex-coding-effect/c6-github-rest-capture.ts";
  input: {
    owner: string;
    pullNumber: number;
    repository: string;
    resolvedIssueNumbers: number[];
  };
  requestProtocol: {
    accept: typeof ACCEPT;
    apiRoot: typeof API_ROOT;
    apiVersion: typeof API_VERSION;
    pagination:
      "per-page-100-follow-validated-link-next-until-absent";
    userAgent: typeof USER_AGENT;
  };
  requests: CapturedRequest[];
  responseClosureSha256: string;
  schemaVersion: 1;
}

export async function captureC6GitHubRestToDirectory(
  rawInput: C6GitHubRestCaptureInput,
  dependencies: {
    fetch?: C6GitHubFetch;
  } = {},
): Promise<{
  manifestPath: string;
  manifestSha256: string;
  requestCount: number;
}> {
  const input = validateInput(rawInput);
  const outputDirectory = resolve(input.outputDirectory);
  await assertOutputDoesNotExist(outputDirectory);
  const fetch = dependencies.fetch ??
    ((url, init) => globalThis.fetch(url, init));
  const requests: CapturedRequest[] = [];
  const bodies: CapturedBody[] = [];
  const repositoryRoot =
    `${API_ROOT}/repos/${input.owner}/${input.repository}`;

  const pullCounts = await captureSingleton({
    endpoint: "pull",
    fetch,
    input,
    issueNumber: null,
    path: "responses/pull.json",
    requests,
    bodies,
    url: `${repositoryRoot}/pulls/${input.pullNumber}`,
    validateBody: (body) => validatePullBody(
      body,
      input.owner,
      input.repository,
      input.pullNumber,
    ),
  });
  const reviewCommentCount = await capturePages({
    endpoint: "review-comments",
    fetch,
    input,
    issueNumber: null,
    pathRoot: "responses/review-comments",
    repositoryId: pullCounts.repositoryId,
    requests,
    bodies,
    url: `${repositoryRoot}/pulls/${input.pullNumber}/comments`,
  });
  assertCountEqual(
    "pull review comments",
    pullCounts.reviewComments,
    reviewCommentCount,
  );
  await capturePages({
    endpoint: "reviews",
    fetch,
    input,
    issueNumber: null,
    pathRoot: "responses/reviews",
    repositoryId: pullCounts.repositoryId,
    requests,
    bodies,
    url: `${repositoryRoot}/pulls/${input.pullNumber}/reviews`,
  });
  const commitCount = await capturePages({
    endpoint: "commits",
    fetch,
    input,
    issueNumber: null,
    pathRoot: "responses/commits",
    repositoryId: pullCounts.repositoryId,
    requests,
    bodies,
    url: `${repositoryRoot}/pulls/${input.pullNumber}/commits`,
  });
  assertCountEqual("pull commits", pullCounts.commits, commitCount);
  const discussionCommentCount = await capturePages({
    endpoint: "pull-discussion-comments",
    fetch,
    input,
    issueNumber: input.pullNumber,
    pathRoot: "responses/pull-discussion-comments",
    repositoryId: pullCounts.repositoryId,
    requests,
    bodies,
    url: `${repositoryRoot}/issues/${input.pullNumber}/comments`,
  });
  assertCountEqual(
    "pull discussion comments",
    pullCounts.comments,
    discussionCommentCount,
  );
  for (const issueNumber of input.resolvedIssueNumbers) {
    const issueCounts = await captureSingleton({
      endpoint: "issue",
      fetch,
      input,
      issueNumber,
      path: `responses/issues/${issueNumber}/issue.json`,
      requests,
      bodies,
      url: `${repositoryRoot}/issues/${issueNumber}`,
      validateBody: (body) => validateIssueBody(body, issueNumber),
    });
    const issueCommentCount = await capturePages({
      endpoint: "issue-comments",
      fetch,
      input,
      issueNumber,
      pathRoot: `responses/issues/${issueNumber}/comments`,
      repositoryId: pullCounts.repositoryId,
      requests,
      bodies,
      url: `${repositoryRoot}/issues/${issueNumber}/comments`,
    });
    assertCountEqual(
      "issue comments",
      issueCounts.comments,
      issueCommentCount,
      ` for issue ${issueNumber}`,
    );
  }

  const responseClosureSha256 = sha256(JSON.stringify(
    requests.map((request) => request.response.rawBody),
  ));
  const manifest: C6GitHubRestCaptureManifest = {
    boundary: {
      authorizationRecordedAs: "redacted",
      bearerAuthorizationHeaderSent: true,
      cryptographicPlatformReceipt: false,
      httpsUrlEnforced: true,
      platformAuthenticationCryptographicallyProven: false,
      status:
        "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt",
      tlsPeerReceiptCaptured: false,
    },
    generatedBy:
      "scripts/codex-coding-effect/c6-github-rest-capture.ts",
    input: {
      owner: input.owner,
      pullNumber: input.pullNumber,
      repository: input.repository,
      resolvedIssueNumbers: [...input.resolvedIssueNumbers],
    },
    requestProtocol: {
      accept: ACCEPT,
      apiRoot: API_ROOT,
      apiVersion: API_VERSION,
      pagination:
        "per-page-100-follow-validated-link-next-until-absent",
      userAgent: USER_AGENT,
    },
    requests,
    responseClosureSha256,
    schemaVersion: 1,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  assertTokenAbsent(input.authorizationToken, manifestBytes);

  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  for (const directory of new Set(
    bodies.map((body) => dirname(join(outputDirectory, body.path))),
  )) {
    await mkdir(directory, { recursive: true });
  }
  await Promise.all(bodies.map((body) =>
    writeFile(join(outputDirectory, body.path), body.bytes, { flag: "wx" })
  ));
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(manifestPath, manifestBytes, { flag: "wx" });
  return {
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    requestCount: requests.length,
  };
}

async function captureSingleton<Result>(input: {
  bodies: CapturedBody[];
  endpoint: Endpoint;
  fetch: C6GitHubFetch;
  input: ReturnType<typeof validateInput>;
  issueNumber: number | null;
  path: string;
  requests: CapturedRequest[];
  url: string;
  validateBody: (body: unknown) => Result;
}): Promise<Result> {
  const captured = await get(input.fetch, input.input, input.url);
  if (parseNextLink(captured.headers.link) !== null) {
    throw new Error(
      "GitHub REST singleton response must not contain Link next",
    );
  }
  const result = input.validateBody(parseJson(captured.body));
  input.bodies.push({ bytes: captured.body, path: input.path });
  input.requests.push(buildCapturedRequest({
    body: captured.body,
    endpoint: input.endpoint,
    headers: captured.headers,
    issueNumber: input.issueNumber,
    page: null,
    path: input.path,
    url: input.url,
  }));
  return result;
}

async function capturePages(input: {
  bodies: CapturedBody[];
  endpoint: Endpoint;
  fetch: C6GitHubFetch;
  input: ReturnType<typeof validateInput>;
  issueNumber: number | null;
  pathRoot: string;
  repositoryId: number;
  requests: CapturedRequest[];
  url: string;
}): Promise<number> {
  let page = 1;
  let itemCount = 0;
  let url = `${input.url}?per_page=${PAGE_SIZE}&page=1`;
  while (true) {
    const captured = await get(input.fetch, input.input, url);
    const parsed = parseJson(captured.body);
    if (!Array.isArray(parsed) || parsed.length > PAGE_SIZE) {
      throw new Error(
        `GitHub REST capture expected an array of at most ${PAGE_SIZE} items`,
      );
    }
    itemCount += parsed.length;
    const path = `${input.pathRoot}/page-${String(page).padStart(4, "0")}.json`;
    input.bodies.push({ bytes: captured.body, path });
    input.requests.push(buildCapturedRequest({
      body: captured.body,
      endpoint: input.endpoint,
      headers: captured.headers,
      issueNumber: input.issueNumber,
      page,
      path,
      url,
    }));
    const next = parseNextLink(captured.headers.link);
    if (next === null) {
      return itemCount;
    }
    validateNextUrl(input.url, next, page + 1, input.repositoryId);
    url = next;
    page += 1;
  }
}

async function get(
  fetch: C6GitHubFetch,
  input: ReturnType<typeof validateInput>,
  url: string,
): Promise<{
  body: Buffer;
  headers: CapturedResponseHeaders;
}> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.host !== "api.github.com") {
    throw new Error("GitHub REST capture only permits https://api.github.com");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: ACCEPT,
        Authorization: `Bearer ${input.authorizationToken}`,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": API_VERSION,
      },
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new Error("GitHub REST capture GET request failed");
  }
  if (response.status !== 200) {
    throw new Error(
      `GitHub REST capture expected status 200 but received ${response.status}`,
    );
  }
  const body = Buffer.from(await response.arrayBuffer());
  assertTokenAbsent(input.authorizationToken, body);
  return {
    body,
    headers: selectResponseHeaders(response.headers),
  };
}

function buildCapturedRequest(input: {
  body: Buffer;
  endpoint: Endpoint;
  headers: CapturedResponseHeaders;
  issueNumber: number | null;
  page: number | null;
  path: string;
  url: string;
}): CapturedRequest {
  return {
    endpoint: input.endpoint,
    issueNumber: input.issueNumber,
    page: input.page,
    request: {
      headers: {
        accept: ACCEPT,
        authorization: "redacted",
        "user-agent": USER_AGENT,
        "x-github-api-version": API_VERSION,
      },
      method: "GET",
      url: input.url,
    },
    response: {
      headers: input.headers,
      rawBody: {
        bytes: input.body.byteLength,
        path: input.path,
        sha256: sha256(input.body),
      },
      status: 200,
    },
  };
}

function selectResponseHeaders(headers: Headers): CapturedResponseHeaders {
  const required = Object.fromEntries(
    REQUIRED_RESPONSE_HEADERS.map((name) => {
      const value = headers.get(name);
      if (value === null || value.trim().length === 0) {
        throw new Error(
          `GitHub REST capture requires non-empty response header ${name}`,
        );
      }
      return [name, value];
    }),
  ) as Record<typeof REQUIRED_RESPONSE_HEADERS[number], string>;
  if (required["x-github-api-version-selected"] !== API_VERSION) {
    throw new Error(
      `GitHub REST capture requires selected API version ${API_VERSION}`,
    );
  }
  if (required["x-ratelimit-resource"] !== "core") {
    throw new Error(
      "GitHub REST capture requires x-ratelimit-resource core",
    );
  }
  const [mediaType] = required["content-type"].split(";", 1);
  if (mediaType.trim().toLowerCase() !== "application/json") {
    throw new Error(
      "GitHub REST capture requires a JSON content-type response",
    );
  }
  return {
    ...required,
    link: headers.get("link"),
  };
}

function validateNextUrl(
  endpointUrl: string,
  nextUrl: string,
  expectedPage: number,
  repositoryId: number,
): void {
  const endpoint = new URL(endpointUrl);
  const next = new URL(nextUrl);
  const keys = [...next.searchParams.keys()];
  const endpointParts = endpoint.pathname.split("/");
  const canonicalPath = endpointParts.length >= 5 &&
      endpointParts[1] === "repos"
    ? `/repositories/${repositoryId}/${endpointParts.slice(4).join("/")}`
    : "";
  if (
    next.protocol !== "https:" ||
    next.host !== "api.github.com" ||
    next.username !== "" ||
    next.password !== "" ||
    next.hash !== "" ||
    (
      next.pathname !== endpoint.pathname &&
      next.pathname !== canonicalPath
    ) ||
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    next.searchParams.get("per_page") !== String(PAGE_SIZE) ||
    next.searchParams.get("page") !== String(expectedPage)
  ) {
    throw new Error(
      "GitHub pagination next URL does not match the exact endpoint",
    );
  }
}

function parseNextLink(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  let next: string | null = null;
  for (const segment of value.split(",")) {
    const match = /^\s*<([^<>]+)>\s*;\s*rel="([a-z]+)"\s*$/u.exec(segment);
    if (match === null) {
      throw new Error("GitHub REST capture received a malformed Link header");
    }
    const [, url, relation] = match;
    if (relation === "next") {
      if (next !== null) {
        throw new Error(
          "GitHub REST capture received duplicate Link next relations",
        );
      }
      next = url;
    }
  }
  return next;
}

function validatePullBody(
  value: unknown,
  owner: string,
  repository: string,
  pullNumber: number,
): PullCounts {
  const pull = asRecord(value, "pull response");
  const base = asRecord(pull.base, "pull base");
  const repo = asRecord(base.repo, "pull base repository");
  const repoOwner = asRecord(repo.owner, "pull base repository owner");
  if (
    pull.number !== pullNumber ||
    typeof repo.full_name !== "string" ||
    repo.full_name.toLowerCase() !==
      `${owner}/${repository}`.toLowerCase() ||
    typeof repo.name !== "string" ||
    repo.name.toLowerCase() !== repository.toLowerCase() ||
    typeof repoOwner.login !== "string" ||
    repoOwner.login.toLowerCase() !== owner.toLowerCase()
  ) {
    throw new Error("GitHub REST capture pull response identity mismatch");
  }
  return {
    comments: validateNonNegativeInteger(
      pull.comments,
      "pull comments count",
    ),
    commits: validateNonNegativeInteger(
      pull.commits,
      "pull commits count",
    ),
    repositoryId: validatePositiveInteger(
      repo.id,
      "pull base repository id",
    ),
    reviewComments: validateNonNegativeInteger(
      pull.review_comments,
      "pull review comments count",
    ),
  };
}

function validateIssueBody(value: unknown, issueNumber: number): IssueCounts {
  const issue = asRecord(value, "issue response");
  if (issue.number !== issueNumber || "pull_request" in issue) {
    throw new Error("GitHub REST capture issue response identity mismatch");
  }
  return {
    comments: validateNonNegativeInteger(
      issue.comments,
      "issue comments count",
    ),
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("GitHub REST capture received invalid JSON");
  }
}

function asRecord(
  value: unknown,
  label: string,
): Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GitHub REST capture expected ${label} object`);
  }
  return value as Record<PropertyKey, unknown>;
}

function validateInput(input: C6GitHubRestCaptureInput): {
  authorizationToken: string;
  outputDirectory: string;
  owner: string;
  pullNumber: number;
  repository: string;
  resolvedIssueNumbers: number[];
} {
  const owner = validateRepositoryComponent(input.owner, "owner");
  const repository = validateRepositoryComponent(
    input.repository,
    "repository",
  );
  const pullNumber = validatePositiveInteger(input.pullNumber, "pull number");
  const resolvedIssueNumbers = input.resolvedIssueNumbers.map((number) =>
    validatePositiveInteger(number, "resolved issue number")
  );
  if (resolvedIssueNumbers.length === 0) {
    throw new Error(
      "C6 GitHub REST capture requires at least one resolved issue number",
    );
  }
  if (new Set(resolvedIssueNumbers).size !== resolvedIssueNumbers.length) {
    throw new Error("C6 GitHub REST capture resolved issue numbers must be unique");
  }
  if (resolvedIssueNumbers.includes(pullNumber)) {
    throw new Error(
      "C6 GitHub REST capture resolved issue number must differ from the pull number",
    );
  }
  const authorizationToken = input.authorizationToken;
  if (
    authorizationToken.length === 0 ||
    authorizationToken.trim() !== authorizationToken ||
    /\s/u.test(authorizationToken)
  ) {
    throw new Error(
      "C6 GitHub REST capture requires an unpadded bearer token",
    );
  }
  if (
    input.outputDirectory.length === 0 ||
    input.outputDirectory.trim() !== input.outputDirectory
  ) {
    throw new Error("C6 GitHub REST capture output directory is invalid");
  }
  return {
    authorizationToken,
    outputDirectory: input.outputDirectory,
    owner,
    pullNumber,
    repository,
    resolvedIssueNumbers: [...resolvedIssueNumbers].sort(
      (left, right) => left - right,
    ),
  };
}

function validateRepositoryComponent(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    !/^[A-Za-z0-9_.-]+$/u.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`C6 GitHub REST capture ${label} is invalid`);
  }
  return value;
}

function validatePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`C6 GitHub REST capture ${label} must be positive`);
  }
  return value;
}

function validateNonNegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`GitHub REST capture ${label} must be non-negative`);
  }
  return value;
}

function assertCountEqual(
  label: string,
  expected: number,
  captured: number,
  context = "",
): void {
  if (captured !== expected) {
    throw new Error(
      `GitHub REST capture ${label} count mismatch${context}: ` +
      `expected ${expected}, captured ${captured}`,
    );
  }
}

async function assertOutputDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    const error = new Error(
      "C6 GitHub REST capture output already exists",
    ) as Error & { code: string };
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

function assertTokenAbsent(token: string, bytes: Uint8Array): void {
  if (Buffer.from(bytes).includes(Buffer.from(token))) {
    throw new Error(
      "C6 GitHub REST capture refused output containing authorization material",
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
