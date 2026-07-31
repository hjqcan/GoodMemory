import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Textual release guards for the Docker deployment artifacts. Building the
// image is user-gated (needs a daemon); these pin the invariants the artifacts
// must not lose: Bun base pinned to the CI version, external-traffic host,
// sqlite-vss native deps neutralized, healthz-based health check, no baked
// token, and the pgvector compose profile.

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(join(import.meta.dir, "../../", relativePath), "utf8");
}

describe("docker deployment artifacts", () => {
  it("pins the Dockerfile runtime and posture invariants", async () => {
    const dockerfile = await readRepoFile("Dockerfile");

    expect(dockerfile).toContain("FROM oven/bun:1.3.14");
    expect(dockerfile).toContain("GOODMEMORY_HTTP_BRIDGE_HOST=0.0.0.0");
    expect(dockerfile).toContain("GOODMEMORY_SQLITE_VECTOR_MODE=off");
    expect(dockerfile).toContain("EXPOSE 8739");
    expect(dockerfile).toContain("VOLUME /app/.goodmemory");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/healthz");
    expect(dockerfile).toContain("scripts/goodmemory-http-bridge.ts");
    // ENTRYPOINT (not CMD) so `docker run image --profile life-coach` passes
    // flags through to the bridge script.
    expect(dockerfile).toContain("ENTRYPOINT");
    // The token is never baked into the image (usage comments may mention it,
    // but no ENV/ARG line may set it).
    expect(dockerfile).not.toMatch(/^\s*(ENV|ARG)?\s*GOODMEMORY_HTTP_BRIDGE_TOKEN=/m);
  });

  it("pins the compose topology", async () => {
    const compose = await readRepoFile("docker-compose.yml");

    expect(compose).toContain("GOODMEMORY_HTTP_BRIDGE_TOKEN");
    expect(compose).toContain("/app/.goodmemory");
    expect(compose).toContain("pgvector/pgvector:pg16");
    // Postgres is an opt-in compose profile so the default `up` binds one
    // bridge service only.
    expect(compose).toContain("profiles");
    expect(compose).toContain('"8739:8739"');
    expect(compose).toContain("SERVICE_URL_GOODMEMORY-BRIDGE_8739");
  });

  it("keeps the build context whitelisted", async () => {
    const dockerignore = await readRepoFile(".dockerignore");

    // Exclude-everything line, then explicit whitelist entries.
    expect(dockerignore).toMatch(/^\*$/m);
    expect(dockerignore).toContain("!src");
    expect(dockerignore).toContain("!package.json");
    expect(dockerignore).toContain("!scripts/goodmemory-http-bridge.ts");
  });
});
