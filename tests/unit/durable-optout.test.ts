import { describe, expect, it } from "bun:test";

import { createDeterministicMemoryExtractor } from "../../src";

describe("durable opt-out disposition", () => {
  it("is emitted by every built-in language pack", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Do not remember project code=Tachikoma"],
      ["zh-CN", "不要记住项目代号=Tachikoma"],
      ["fr-FR", "Ne mémorise pas code projet=Tachikoma"],
      ["es-ES", "No recuerdes código de proyecto=Tachikoma"],
      ["ja-JP", "プロジェクトコード=Tachikomaは覚えないでください"],
      ["ko-KR", "프로젝트 코드=Tachikoma를 기억하지 마세요"],
    ] as const;

    for (const [locale, content] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content }],
        scope: { userId: `durable-opt-out-${locale}` },
      });

      expect(result.candidates).toEqual([
        expect.objectContaining({
          disposition: {
            kind: "durable_opt_out",
            target: {
              identities: [{
                slot: "assignment:project_code",
                value: "Tachikoma",
              }],
              match: "exact",
              text: expect.any(String),
            },
          },
          kindHint: "feedback",
        }),
      ]);
    }
  });

  it("emits every typed identity from a compound English target", async () => {
    const result = await createDeterministicMemoryExtractor().extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Do not remember I am a staff engineer at Acme Labs",
      }],
      scope: { userId: "compound-durable-opt-out" },
    });

    expect(result.candidates[0]?.disposition?.target.identities).toEqual([
      { slot: "profile:role", value: "staff engineer" },
      { slot: "profile:organization", value: "Acme Labs" },
    ]);
  });
});
