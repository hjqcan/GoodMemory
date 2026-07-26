import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6GitHubRestToDirectory,
} from "../../scripts/codex-coding-effect/c6-github-rest-capture";
import type {
  C6GitHubFetch,
  C6GitHubRestCaptureManifest,
} from "../../scripts/codex-coding-effect/c6-github-rest-capture";

const API_ROOT = "https://api.github.com";
const TOKEN = "github-token-must-never-be-recorded";

describe("Codex coding-effect C6 GitHub REST capture", () => {
  it("captures the complete caller-declared PR and issue REST surface with strict pagination", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    const calls: FetchCall[] = [];
    const bodies = new Map<string, Uint8Array>([
      [
        `${API_ROOT}/repos/Example/Project/pulls/7`,
        jsonBytes({
          base: {
            repo: {
              full_name: "Example/Project",
              id: 42,
              name: "Project",
              owner: { login: "Example" },
            },
          },
          comments: 1,
          commits: 1,
          number: 7,
          review_comments: 2,
        }, 2),
      ],
      [
        `${API_ROOT}/repos/Example/Project/pulls/7/comments?per_page=100&page=1`,
        jsonBytes([{ id: 1 }]),
      ],
      [
        `${API_ROOT}/repositories/42/pulls/7/comments?page=2&per_page=100`,
        jsonBytes([{ id: 2 }], 2),
      ],
      [
        `${API_ROOT}/repos/Example/Project/pulls/7/reviews?per_page=100&page=1`,
        jsonBytes([{ id: 3 }]),
      ],
      [
        `${API_ROOT}/repos/Example/Project/pulls/7/commits?per_page=100&page=1`,
        jsonBytes([{ sha: "a".repeat(40) }]),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/7/comments?per_page=100&page=1`,
        jsonBytes([{ id: 4 }]),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/101`,
        jsonBytes({ comments: 1, number: 101, title: "Original issue" }),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/101/comments?per_page=100&page=1`,
        jsonBytes([{ id: 5 }]),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/101/comments?per_page=100&page=2`,
        jsonBytes([], 2),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/202`,
        jsonBytes({ comments: 0, number: 202, title: "Second original issue" }),
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/202/comments?per_page=100&page=1`,
        jsonBytes([]),
      ],
    ]);
    const links = new Map<string, string>([
      [
        `${API_ROOT}/repos/Example/Project/pulls/7/comments?per_page=100&page=1`,
        `<${API_ROOT}/repositories/42/pulls/7/comments?page=2&per_page=100>; rel="next", <${API_ROOT}/repositories/42/pulls/7/comments?page=2&per_page=100>; rel="last"`,
      ],
      [
        `${API_ROOT}/repos/Example/Project/issues/101/comments?per_page=100&page=1`,
        `<${API_ROOT}/repos/Example/Project/issues/101/comments?per_page=100&page=2>; rel="next"`,
      ],
    ]);
    const fetch = createFetch({ bodies, calls, links });

    try {
      const result = await captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "Example",
        pullNumber: 7,
        repository: "Project",
        resolvedIssueNumbers: [202, 101],
      }, { fetch });
      const manifestBytes = await readFile(result.manifestPath);
      const manifest = JSON.parse(
        manifestBytes.toString("utf8"),
      ) as C6GitHubRestCaptureManifest;

      expect(calls.map((call) => call.url)).toEqual([...bodies.keys()]);
      expect(calls.every((call) =>
        call.headers.authorization === `Bearer ${TOKEN}` &&
        call.headers.accept === "application/vnd.github+json" &&
        call.headers["x-github-api-version"] === "2022-11-28" &&
        call.headers["user-agent"] === "goodmemory-c6-github-rest-capture/1" &&
        call.redirect === "error"
      )).toBe(true);
      expect(manifest.boundary).toEqual({
        authorizationRecordedAs: "redacted",
        bearerAuthorizationHeaderSent: true,
        cryptographicPlatformReceipt: false,
        httpsUrlEnforced: true,
        platformAuthenticationCryptographicallyProven: false,
        status:
          "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt",
        tlsPeerReceiptCaptured: false,
      });
      expect(manifest.input).toEqual({
        owner: "Example",
        pullNumber: 7,
        repository: "Project",
        resolvedIssueNumbers: [101, 202],
      });
      expect(manifest.requests).toHaveLength(11);
      expect(manifest.requests[0]).toMatchObject({
        endpoint: "pull",
        page: null,
        request: {
          headers: {
            authorization: "redacted",
          },
          method: "GET",
          url: `${API_ROOT}/repos/Example/Project/pulls/7`,
        },
        response: {
          headers: {
            "content-type": "application/json; charset=utf-8",
            date: "Sat, 25 Jul 2026 12:00:00 GMT",
            etag: "\"fixture-etag\"",
            "x-github-request-id": "fixture-request-id",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
          },
          status: 200,
        },
      });
      expect(manifest.requests[2]).toMatchObject({
        endpoint: "review-comments",
        page: 2,
        request: {
          url:
            `${API_ROOT}/repositories/42/pulls/7/comments?page=2&per_page=100`,
        },
      });
      expect(manifest.requests.at(-1)).toMatchObject({
        endpoint: "issue-comments",
        issueNumber: 202,
        page: 1,
      });
      expect(manifest.responseClosureSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(manifestBytes.toString("utf8")).not.toContain(TOKEN);

      for (const request of manifest.requests) {
        const expected = bodies.get(request.request.url);
        expect(expected).toBeDefined();
        const raw = await readFile(join(
          outputDirectory,
          request.response.rawBody.path,
        ));
        expect(raw).toEqual(Buffer.from(expected!));
        expect(request.response.rawBody).toEqual({
          bytes: expected!.byteLength,
          path: request.response.rawBody.path,
          sha256: sha256(expected!),
        });
      }
      expect(await treeContains(outputDirectory, TOKEN)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a Link next target outside the exact endpoint and writes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    const fetch = createFetch({
      bodies: defaultBodies(),
      links: new Map([[
        `${API_ROOT}/repos/example/project/pulls/7/comments?per_page=100&page=1`,
        `<https://evil.invalid/repos/example/project/pulls/7/comments?per_page=100&page=2>; rel="next"`,
      ]]),
    });

    try {
      await expect(captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repository: "project",
        resolvedIssueNumbers: [101],
      }, { fetch })).rejects.toThrow(
        "GitHub pagination next URL does not match the exact endpoint",
      );
      await expect(readdir(outputDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a canonical pagination path for a different repository id", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    const fetch = createFetch({
      bodies: defaultBodies(),
      links: new Map([[
        `${API_ROOT}/repos/example/project/pulls/7/comments?per_page=100&page=1`,
        `<${API_ROOT}/repositories/43/pulls/7/comments?per_page=100&page=2>; rel="next"`,
      ]]),
    });

    try {
      await expect(captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repository: "project",
        resolvedIssueNumbers: [101],
      }, { fetch })).rejects.toThrow(
        "GitHub pagination next URL does not match the exact endpoint",
      );
      await expect(readdir(outputDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects pagination on a singleton pull or issue response", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    const fetch = createFetch({
      bodies: defaultBodies(),
      links: new Map([[
        `${API_ROOT}/repos/example/project/pulls/7`,
        `<${API_ROOT}/repos/example/project/pulls/7?page=2&per_page=100>; rel="next"`,
      ]]),
    });

    try {
      await expect(captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repository: "project",
        resolvedIssueNumbers: [101],
      }, { fetch })).rejects.toThrow(
        "GitHub REST singleton response must not contain Link next",
      );
      await expect(readdir(outputDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a non-200 response without persisting its body", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    const fetch: C6GitHubFetch = async () =>
      response(jsonBytes({ message: "rate limited" }), { status: 403 });

    try {
      await expect(captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repository: "project",
        resolvedIssueNumbers: [101],
      }, { fetch })).rejects.toThrow(
        "GitHub REST capture expected status 200 but received 403",
      );
      await expect(readdir(outputDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects missing or untrusted critical response headers before writing", async () => {
    const mutations: {
      headers: Readonly<Record<string, string | null>>;
      label: string;
    }[] = [
      { headers: { date: null }, label: "date" },
      { headers: { etag: "" }, label: "etag" },
      {
        headers: { "x-github-api-version-selected": "2022-11-27" },
        label: "api version",
      },
      {
        headers: { "x-github-request-id": null },
        label: "request id",
      },
      {
        headers: { "x-ratelimit-limit": null },
        label: "rate limit",
      },
      {
        headers: { "x-ratelimit-remaining": null },
        label: "rate remaining",
      },
      {
        headers: { "x-ratelimit-reset": null },
        label: "rate reset",
      },
      {
        headers: { "x-ratelimit-resource": "graphql" },
        label: "rate resource",
      },
      {
        headers: { "x-ratelimit-used": null },
        label: "rate used",
      },
      {
        headers: { "content-type": "text/html" },
        label: "content type",
      },
    ];

    for (const mutation of mutations) {
      const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
      const outputDirectory = join(root, "capture");
      const fetch = createFetch({
        bodies: defaultBodies(),
        responseHeaders: mutation.headers,
      });
      try {
        await expect(captureC6GitHubRestToDirectory({
          authorizationToken: TOKEN,
          outputDirectory,
          owner: "example",
          pullNumber: 7,
          repository: "project",
          resolvedIssueNumbers: [101],
        }, { fetch })).rejects.toThrow();
        await expect(readdir(outputDirectory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } catch (error) {
        throw new Error(`header mutation did not fail closed: ${mutation.label}`, {
          cause: error,
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("rejects pull and issue pagination count mismatches before writing", async () => {
    const mutations: {
      expectedMessage: string;
      mutate: (bodies: Map<string, Uint8Array>) => void;
    }[] = [
      {
        expectedMessage: "pull commits count mismatch",
        mutate: (bodies) => bodies.set(
          `${API_ROOT}/repos/example/project/pulls/7`,
          pullBytes({ commits: 1 }),
        ),
      },
      {
        expectedMessage: "pull review comments count mismatch",
        mutate: (bodies) => bodies.set(
          `${API_ROOT}/repos/example/project/pulls/7`,
          pullBytes({ review_comments: 1 }),
        ),
      },
      {
        expectedMessage: "pull discussion comments count mismatch",
        mutate: (bodies) => bodies.set(
          `${API_ROOT}/repos/example/project/pulls/7`,
          pullBytes({ comments: 1 }),
        ),
      },
      {
        expectedMessage: "issue comments count mismatch",
        mutate: (bodies) => bodies.set(
          `${API_ROOT}/repos/example/project/issues/101`,
          jsonBytes({ comments: 1, number: 101 }),
        ),
      },
    ];

    for (const mutation of mutations) {
      const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
      const outputDirectory = join(root, "capture");
      const bodies = defaultBodies();
      mutation.mutate(bodies);
      try {
        await expect(captureC6GitHubRestToDirectory({
          authorizationToken: TOKEN,
          outputDirectory,
          owner: "example",
          pullNumber: 7,
          repository: "project",
          resolvedIssueNumbers: [101],
        }, { fetch: createFetch({ bodies }) })).rejects.toThrow(
          mutation.expectedMessage,
        );
        await expect(readdir(outputDirectory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("refuses an existing output directory before making a request", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-github-rest-"));
    const outputDirectory = join(root, "capture");
    await mkdir(outputDirectory);
    let calls = 0;
    const fetch: C6GitHubFetch = async () => {
      calls += 1;
      return response(jsonBytes({}));
    };

    try {
      await expect(captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repository: "project",
        resolvedIssueNumbers: [101],
      }, { fetch })).rejects.toMatchObject({ code: "EEXIST" });
      expect(calls).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

interface FetchCall {
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
  url: string;
}

function createFetch(input: {
  bodies: ReadonlyMap<string, Uint8Array>;
  calls?: FetchCall[];
  links?: ReadonlyMap<string, string>;
  responseHeaders?: Readonly<Record<string, string | null>>;
}): C6GitHubFetch {
  return async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    input.calls?.push({
      headers,
      redirect: init.redirect,
      url,
    });
    const body = input.bodies.get(url);
    if (body === undefined) {
      return response(jsonBytes({ message: `unexpected URL ${url}` }), {
        status: 404,
      });
    }
    return response(body, {
      headers: input.responseHeaders,
      link: input.links?.get(url),
    });
  };
}

function defaultBodies(): Map<string, Uint8Array> {
  return new Map([
    [
      `${API_ROOT}/repos/example/project/pulls/7`,
      jsonBytes({
        base: {
          repo: {
            full_name: "example/project",
            id: 42,
            name: "project",
            owner: { login: "example" },
          },
        },
        comments: 0,
        commits: 0,
        number: 7,
        review_comments: 0,
      }),
    ],
    [
      `${API_ROOT}/repos/example/project/pulls/7/comments?per_page=100&page=1`,
      jsonBytes([]),
    ],
    [
      `${API_ROOT}/repos/example/project/pulls/7/reviews?per_page=100&page=1`,
      jsonBytes([]),
    ],
    [
      `${API_ROOT}/repos/example/project/pulls/7/commits?per_page=100&page=1`,
      jsonBytes([]),
    ],
    [
      `${API_ROOT}/repos/example/project/issues/7/comments?per_page=100&page=1`,
      jsonBytes([]),
    ],
    [
      `${API_ROOT}/repos/example/project/issues/101`,
      jsonBytes({ comments: 0, number: 101 }),
    ],
    [
      `${API_ROOT}/repos/example/project/issues/101/comments?per_page=100&page=1`,
      jsonBytes([]),
    ],
  ]);
}

function jsonBytes(value: unknown, spaces?: number): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, spaces)}\n`);
}

function response(
  body: Uint8Array,
  options: {
    headers?: Readonly<Record<string, string | null>>;
    link?: string;
    status?: number;
  } = {},
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    date: "Sat, 25 Jul 2026 12:00:00 GMT",
    etag: "\"fixture-etag\"",
    "x-github-api-version-selected": "2022-11-28",
    "x-github-request-id": "fixture-request-id",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1784984400",
    "x-ratelimit-resource": "core",
    "x-ratelimit-used": "1",
  });
  if (options.link !== undefined) {
    headers.set("link", options.link);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }
  const responseBody = new Uint8Array(body.byteLength);
  responseBody.set(body);
  return new Response(responseBody.buffer, {
    headers,
    status: options.status ?? 200,
  });
}

function pullBytes(
  overrides: Partial<{
    comments: number;
    commits: number;
    review_comments: number;
  }>,
): Uint8Array {
  return jsonBytes({
    base: {
      repo: {
        full_name: "example/project",
        id: 42,
        name: "project",
        owner: { login: "example" },
      },
    },
    comments: 0,
    commits: 0,
    number: 7,
    review_comments: 0,
    ...overrides,
  });
}

async function treeContains(root: string, needle: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await treeContains(path, needle)) {
        return true;
      }
    } else if ((await readFile(path, "utf8")).includes(needle)) {
      return true;
    }
  }
  return false;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
