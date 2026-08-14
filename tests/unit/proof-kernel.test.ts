import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  canonicalJson,
  parseCanonicalJson,
} from "../../scripts/proof/canonical";
import {
  buildProofFileRef,
  buildProofFileClosure,
  verifyProofFileClosure,
} from "../../scripts/proof/files";
import {
  resolveCleanGitSourceIdentity,
  resolveGitSourceIdentity,
  verifyGitSourceAnchor,
  verifyGitSourceStability,
  withGitSourceCheckout,
} from "../../scripts/proof/git";
import {
  proofIdentity,
} from "../../scripts/proof/identity";

const execFileAsync = promisify(execFile);

describe("repo-only proof kernel", () => {
  it("serializes one canonical UTF-8 JSON representation", () => {
    const serialized = canonicalJson({ z: 1, a: { y: 2, x: 3 } });
    expect(serialized).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(parseCanonicalJson(serialized)).toEqual({
      a: { x: 3, y: 2 },
      z: 1,
    });
    expect(() => parseCanonicalJson(`${serialized}\n`)).toThrow(
      "not canonical",
    );
    const invalidUtf8 = Buffer.concat([
      Buffer.from('{"value":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    expect(() => parseCanonicalJson(invalidUtf8)).toThrow("valid UTF-8");
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(
      "non-finite",
    );

    const prototypeKey = JSON.parse(
      '{"__proto__":{"admin":true}}',
    ) as unknown;
    expect(canonicalJson(prototypeKey)).toBe(
      '{"__proto__":{"admin":true}}',
    );
    expect(proofIdentity(prototypeKey)).not.toEqual(proofIdentity({}));
  });

  it("detects missing, extra, changed, and symlinked closure entries", async () => {
    await withTemporaryRoot("goodmemory-proof-files-", async (root) => {
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "a.json"), "{\"a\":1}");
      await writeFile(join(root, "nested", "b.txt"), "b");
      const closure = await buildProofFileClosure(root);
      expect(closure.map((file) => file.path)).toEqual([
        "a.json",
        "nested/b.txt",
      ]);
      await expect(verifyProofFileClosure(root, closure)).resolves.toEqual(
        closure,
      );
      await expect(buildProofFileRef(root, "../outside")).rejects.toThrow(
        "invalid proof-relative path",
      );

      await writeFile(join(root, "a.json"), "{\"a\":2}");
      await expect(verifyProofFileClosure(root, closure)).rejects.toThrow(
        "byte identity mismatch",
      );
      await writeFile(join(root, "a.json"), "{\"a\":1}");
      await writeFile(join(root, "extra.txt"), "extra");
      await expect(verifyProofFileClosure(root, closure)).rejects.toThrow(
        "path set mismatch",
      );
      await rm(join(root, "extra.txt"));
      await rm(join(root, "nested", "b.txt"));
      await symlink(join(root, "a.json"), join(root, "nested", "b.txt"));
      await expect(verifyProofFileClosure(root, closure)).rejects.toThrow(
        "rejects symlink",
      );
    });
  });

  it("resolves source identity without ambient Git path overrides", async () => {
    const { stdout: expectedCommit } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { encoding: "utf8" },
    );
    const previousGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = "/definitely/not/a/git/directory";
    try {
      const identity = await resolveGitSourceIdentity(process.cwd());
      expect(identity.commit).toBe(expectedCommit.trim());
      expect(identity.tree).toMatch(/^[a-f0-9]{40}$/u);
      await expect(
        verifyGitSourceAnchor(process.cwd(), identity),
      ).resolves.toBeUndefined();
      await expect(
        verifyGitSourceAnchor(process.cwd(), {
          ...identity,
          tree: "0".repeat(40),
        }),
      ).rejects.toThrow("Git source anchor mismatch");
    } finally {
      if (previousGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previousGitDir;
      }
    }
  });

  it("binds executable proof code only from a clean Git worktree", async () => {
    await withTemporaryRoot("goodmemory-proof-git-", async (root) => {
      await execFileAsync("git", ["-C", root, "init", "--quiet"]);
      await writeFile(join(root, "verifier.ts"), "export const version = 1;\n");
      await execFileAsync("git", ["-C", root, "add", "verifier.ts"]);
      await execFileAsync("git", [
        "-C",
        root,
        "-c",
        "user.name=GoodMemory Test",
        "-c",
        "user.email=test@goodmemory.local",
        "commit",
        "--quiet",
        "-m",
        "proof source",
      ]);

      const identity = await resolveCleanGitSourceIdentity(root);
      expect(identity.commit).toMatch(/^[a-f0-9]{40}$/u);
      expect(identity.tree).toMatch(/^[a-f0-9]{40}$/u);

      await writeFile(join(root, "verifier.ts"), "export const version = 2;\n");
      await expect(resolveCleanGitSourceIdentity(root)).rejects.toThrow(
        "clean Git worktree",
      );
    });
  });

  it("executes against a complete historical checkout and detects terminal source drift", async () => {
    await withTemporaryRoot("goodmemory-proof-source-checkout-", async (root) => {
      await execFileAsync("git", ["-C", root, "init", "--quiet"]);
      await writeFile(join(root, "dynamic-input.txt"), "historical\n");
      await commitAll(root, "historical source");
      const historical = await resolveCleanGitSourceIdentity(root);

      await writeFile(join(root, "dynamic-input.txt"), "current\n");
      await commitAll(root, "current source");
      const execution = await resolveCleanGitSourceIdentity(root);
      let checkoutRoot: string | undefined;
      await withGitSourceCheckout(root, historical, async (checkout) => {
        checkoutRoot = checkout;
        expect(checkout).not.toBe(root);
        expect(
          await Bun.file(
            join(checkout, ".git", "objects", "info", "alternates"),
          ).exists(),
        ).toBe(false);
        expect(await readFile(join(checkout, "dynamic-input.txt"), "utf8"))
          .toBe("historical\n");
        expect(await resolveCleanGitSourceIdentity(checkout)).toEqual(
          historical,
        );
      });
      expect(checkoutRoot).toBeDefined();
      expect(await Bun.file(checkoutRoot!).exists()).toBe(false);

      let failedCheckoutRoot: string | undefined;
      await expect(
        withGitSourceCheckout(root, historical, async (checkout) => {
          failedCheckoutRoot = checkout;
          throw new Error("expected callback failure");
        }),
      ).rejects.toThrow("expected callback failure");
      expect(failedCheckoutRoot).toBeDefined();
      expect(await Bun.file(failedCheckoutRoot!).exists()).toBe(false);
      await expect(
        verifyGitSourceStability(root, execution),
      ).resolves.toBeUndefined();

      await writeFile(join(root, "dynamic-input.txt"), "drifted\n");
      await commitAll(root, "execution source drift");
      await expect(
        verifyGitSourceStability(root, execution),
      ).rejects.toThrow("proof execution source changed");
    });
  });

  it("does not inherit an alternate object store from the source repository", async () => {
    await withTemporaryRoot("goodmemory-proof-alternates-", async (root) => {
      const origin = join(root, "origin");
      const sharedSource = join(root, "shared-source");
      await mkdir(origin);
      await execFileAsync("git", ["-C", origin, "init", "--quiet"]);
      await writeFile(join(origin, "verifier.ts"), "export const version = 1;\n");
      await commitAll(origin, "proof source");
      const identity = await resolveCleanGitSourceIdentity(origin);
      await execFileAsync("git", [
        "clone",
        "--quiet",
        "--shared",
        origin,
        sharedSource,
      ]);
      expect(
        await Bun.file(
          join(sharedSource, ".git", "objects", "info", "alternates"),
        ).exists(),
      ).toBe(true);

      await withGitSourceCheckout(sharedSource, identity, async (checkout) => {
        expect(
          await Bun.file(
            join(checkout, ".git", "objects", "info", "alternates"),
          ).exists(),
        ).toBe(false);
      });
    });
  });
});

async function commitAll(root: string, message: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "add", "--all"]);
  await execFileAsync("git", [
    "-C",
    root,
    "-c",
    "user.name=GoodMemory Test",
    "-c",
    "user.email=test@goodmemory.local",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

async function withTemporaryRoot(
  prefix: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
