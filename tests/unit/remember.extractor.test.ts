import { describe, expect, it } from "bun:test";
import {
  createDeterministicMemoryExtractor,
} from "../../src/remember/deterministicExtractor";

describe("deterministic memory extractor", () => {
  it("separates explicit facts, profile updates, and procedural feedback", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        { role: "user", content: "My name is Lin." },
        {
          role: "user",
          content: "Remember that the robot workflow is blocked on prod migration.",
        },
        {
          role: "user",
          content: "Please keep answers concise and action-oriented.",
        },
        { role: "user", content: "Hi" },
      ],
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
      "fact",
      "feedback",
    ]);
    expect(result.candidates.map((candidate) => candidate.explicitness)).toEqual([
      "explicit",
      "explicit",
      "explicit",
    ]);
    expect(result.candidates[0]?.content).toBe("Lin");
    expect(result.candidates[1]?.content).toBe(
      "the robot workflow is blocked on prod migration.",
    );
    expect(result.candidates[2]?.metadata?.feedbackKind).toBe("do");
  });

  it("extracts multiple profile fields and project context from one identity reveal", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "My name is Felix. I'm a climate policy advisor in Austin, USA. Remember that I'm leading incident playbook refresh.",
        },
      ],
    });

    expect(result.candidates).toHaveLength(4);
    expect(
      result.candidates.map((candidate) => ({
        kindHint: candidate.kindHint,
        content: candidate.content,
        profileField: candidate.metadata?.profileField,
      })),
    ).toEqual([
      {
        kindHint: "profile",
        content: "Felix",
        profileField: "name",
      },
      {
        kindHint: "profile",
        content: "climate policy advisor",
        profileField: "role",
      },
      {
        kindHint: "profile",
        content: "Austin, USA",
        profileField: "location",
      },
      {
        kindHint: "profile",
        content: "incident playbook refresh",
        profileField: "currentProject",
      },
    ]);
  });

  it("extracts bounded English names without swallowing continuations or initials", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      scope: { userId: "u-name-grammar", sessionId: "s-name-grammar" },
      messages: [
        { role: "user", content: "My name is Nadia and my role is designer." },
        { role: "user", content: "My name is Mary Jane and she works in Toronto." },
        { role: "user", content: "My name is John Q. Public." },
      ],
    });

    expect(
      result.candidates
        .filter(({ metadata }) => metadata?.profileField === "name")
        .map(({ content }) => content),
    ).toEqual(["Nadia", "Mary Jane", "John Q. Public"]);
  });

  it("extracts common Chinese and Japanese explicit-name forms", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const chinese = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-zh-name", sessionId: "s-zh-name" },
      messages: [{ role: "user", content: "我的名字是李雷。" }],
    });
    const japanese = await extractor.extract({
      locale: "ja-JP",
      scope: { userId: "u-ja-name", sessionId: "s-ja-name" },
      messages: [{ role: "user", content: "私の名前は山田 太郎です。" }],
    });

    expect(chinese.candidates[0]).toMatchObject({
      content: "李雷",
      kindHint: "profile",
      metadata: { profileField: "name" },
    });
    expect(japanese.candidates[0]).toMatchObject({
      content: "山田 太郎",
      kindHint: "profile",
      metadata: { profileField: "name" },
    });
  });

  it("extracts lower-confidence inferred facts from future-useful user context", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "The robot workflow is still failing in production after the migration.",
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kindHint).toBe("fact");
    expect(result.candidates[0]?.explicitness).toBe("inferred");
  });

  it("does not treat arbitrary long user messages as durable facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I spent most of the afternoon reading articles and drinking coffee while thinking about unrelated ideas.",
        },
      ],
    });

    expect(result.candidates).toHaveLength(0);
  });

  it("extracts typed English facts from domain-neutral first-person grammar", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-generic-en", sessionId: "s-generic-en" },
      messages: [
        {
          role: "user",
          content: "I've been using a cobalt torque wrench from Northwind Depot.",
        },
        {
          role: "user",
          content: "I still need to calibrate the spectrometer before Thursday.",
        },
        {
          role: "user",
          content: "I recently catalogued the river-sediment samples.",
        },
        {
          role: "user",
          content: "I'm working on the orchard irrigation rollout.",
        },
        {
          role: "user",
          content: "I recently presented the irrigation rollout to the review board.",
        },
      ],
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content, explicitness, metadata }) => ({
          category: metadata?.category,
          content,
          explicitness,
          factKind: metadata?.factKind,
        })),
    ).toEqual([
      {
        category: "personal",
        content: "I use a cobalt torque wrench from Northwind Depot.",
        explicitness: "explicit",
        factKind: undefined,
      },
      {
        category: "personal",
        content: "I still need to calibrate the spectrometer before Thursday.",
        explicitness: "explicit",
        factKind: "open_loop",
      },
      {
        category: "event",
        content: "I catalogued the river-sediment samples.",
        explicitness: "explicit",
        factKind: undefined,
      },
      {
        category: "project",
        content: "I am working on the orchard irrigation rollout.",
        explicitness: "explicit",
        factKind: "generic_project",
      },
      {
        category: "project",
        content: "I presented the irrigation rollout to the review board.",
        explicitness: "explicit",
        factKind: "generic_project",
      },
    ]);
  });

  it("extracts typed Chinese facts from domain-neutral first-person grammar", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-generic-zh", sessionId: "s-generic-zh" },
      messages: [
        { role: "user", content: "我一直使用北风仓库的钴蓝扭矩扳手。" },
        { role: "user", content: "我还需要校准光谱仪。" },
        { role: "user", content: "我最近整理了河流沉积物样本。" },
        { role: "user", content: "我正在推进果园灌溉上线。" },
        { role: "user", content: "我刚汇报了灌溉上线方案。" },
      ],
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content, explicitness, metadata }) => ({
          category: metadata?.category,
          content,
          explicitness,
          factKind: metadata?.factKind,
        })),
    ).toEqual([
      {
        category: "personal",
        content: "我使用北风仓库的钴蓝扭矩扳手。",
        explicitness: "explicit",
        factKind: undefined,
      },
      {
        category: "personal",
        content: "我仍需校准光谱仪。",
        explicitness: "explicit",
        factKind: "open_loop",
      },
      {
        category: "event",
        content: "我整理了河流沉积物样本。",
        explicitness: "explicit",
        factKind: undefined,
      },
      {
        category: "project",
        content: "我正在做果园灌溉上线。",
        explicitness: "explicit",
        factKind: "generic_project",
      },
      {
        category: "project",
        content: "我汇报了灌溉上线方案。",
        explicitness: "explicit",
        factKind: "generic_project",
      },
    ]);
  });

  it("does not treat one-off polite requests as durable procedural feedback", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        { role: "user", content: "Could you please share it with me?" },
        { role: "user", content: "Please respond as the user." },
      ],
    });

    expect(result.candidates).toHaveLength(0);
  });

  it("extracts organization, timezone, and language preference into profile candidates", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I'm a staff engineer at Acme Labs. My timezone is Asia/Shanghai. My preferred language is Chinese.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        kindHint: candidate.kindHint,
        content: candidate.content,
        profileField: candidate.metadata?.profileField,
      })),
    ).toEqual([
      {
        kindHint: "profile",
        content: "staff engineer",
        profileField: "role",
      },
      {
        kindHint: "profile",
        content: "Acme Labs",
        profileField: "organization",
      },
      {
        kindHint: "profile",
        content: "Asia/Shanghai",
        profileField: "timezone",
      },
      {
        kindHint: "profile",
        content: "Chinese",
        profileField: "languagePreference",
      },
    ]);
  });

  it("extracts explicit personal attribute facts from natural user wording", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "By the way, my cat's name is Luna, and she's been such a sweetie throughout all the changes.",
        },
        {
          role: "user",
          content:
            "Do you have any recommendations for a collar brand or type that would suit a Golden Retriever like Max?",
        },
        {
          role: "user",
          content:
            "I completed my undergrad in CS from UCLA, which has a great reputation in the industry.",
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.content)).toEqual(
      expect.arrayContaining([
        "My cat's name is Luna.",
        "My dog Max is a Golden Retriever.",
        "I completed my undergraduate Computer Science degree at UCLA.",
      ]),
    );
    expect(
      result.candidates
        .filter((candidate) =>
          [
            "My cat's name is Luna.",
            "My dog Max is a Golden Retriever.",
            "I completed my undergraduate Computer Science degree at UCLA.",
          ].includes(candidate.content),
        )
        .every((candidate) => candidate.metadata?.category === "personal"),
    ).toBe(true);
  });

  it("extracts role drift and current project from moved-into wording", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Remember that I have now moved into a staff platform engineer role leading release quality program.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        kindHint: candidate.kindHint,
        content: candidate.content,
        profileField: candidate.metadata?.profileField,
      })),
    ).toEqual([
      {
        kindHint: "profile",
        content: "staff platform engineer",
        profileField: "role",
      },
      {
        kindHint: "profile",
        content: "release quality program",
        profileField: "currentProject",
      },
      {
        kindHint: "fact",
        content: "my current role is staff platform engineer leading release quality program.",
        profileField: undefined,
      },
    ]);
  });

  it("captures role drift wording as a project fact alongside profile updates", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Remember that I have now moved into a staff platform engineer role leading release quality program.",
        },
      ],
    });

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.kindHint === "fact" &&
          candidate.explicitness === "explicit" &&
          candidate.content ===
            "my current role is staff platform engineer leading release quality program." &&
          candidate.metadata?.category === "project",
      ),
    ).toBe(true);
  });

  it("classifies blockers and open loops as project facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the current blocker is vendor approval for incident playbook refresh.",
        },
        {
          role: "user",
          content:
            "Remember that the open loop is the handoff package for incident playbook refresh.",
        },
      ],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.metadata?.category).toBe("project");
    expect(result.candidates[1]?.metadata?.category).toBe("project");
  });

  it("extracts follow-up open-loop phrasing as an explicit project fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "We paused after step 2 and still have an open loop on final verification for migration rollout. Continue from there next time.",
        },
      ],
    });

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.kindHint === "fact" &&
          candidate.explicitness === "explicit" &&
          candidate.content ===
            "the open loop is final verification for migration rollout." &&
          candidate.metadata?.category === "project",
      ),
    ).toBe(true);
  });

  it("extracts explicit education background as a durable personal fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "[LongMemEval session answer_1] I graduated with a degree in Business Administration, which has helped me in my new role.",
        },
      ],
    });

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.kindHint === "fact" &&
          candidate.explicitness === "explicit" &&
          candidate.content ===
            "I graduated with a degree in Business Administration." &&
          candidate.metadata?.category === "personal" &&
          candidate.metadata.scopeKind === "identity",
      ),
    ).toBe(true);
  });

  it("extracts explicit commute and shopping coupon facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I've been listening to audiobooks during my daily commute, which takes 45 minutes each way.",
        },
        {
          role: "user",
          content:
            "I've been using the Cartwheel app from Target and it's been really helpful for saving money on household items.",
        },
        {
          role: "user",
          content:
            "I actually redeemed a $5 coupon on coffee creamer last Sunday.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        category: "personal",
        content: "My daily commute takes 45 minutes each way.",
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "I use the Cartwheel app from Target.",
        kindHint: "fact",
      },
      {
        category: "event",
        content: "I redeemed a $5 coupon on coffee creamer last Sunday.",
        kindHint: "fact",
      },
    ]);
  });

  it("extracts explicit personal events and latest achievement facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I still need to pick up my dry cleaning for the navy blue blazer.",
        },
        {
          role: "user",
          content:
            "I need to return some boots to Zara, actually.",
        },
        {
          role: "user",
          content:
            "I just helped my cousin pick out some stuff for her baby shower at Target.",
        },
        {
          role: "user",
          content:
            "I'm hoping to beat my personal best time of 25:50 this time around.",
        },
        {
          role: "user",
          content:
            "I'm trying to learn more about some advanced settings for video editing with Adobe Premiere Pro, which I enjoy to use.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        explicitness: candidate.explicitness,
        factKind: candidate.metadata?.factKind,
        kindHint: candidate.kindHint,
        scopeKind: candidate.metadata?.scopeKind,
      })),
    ).toEqual([
      {
        category: "personal",
        content: "I still need to pick up my dry cleaning for the navy blue blazer.",
        explicitness: "explicit",
        factKind: "open_loop",
        kindHint: "fact",
        scopeKind: "identity",
      },
      {
        category: "personal",
        content: "I need to return some boots to Zara.",
        explicitness: "explicit",
        factKind: "open_loop",
        kindHint: "fact",
        scopeKind: "identity",
      },
      {
        category: "event",
        content:
          "I helped my cousin pick out some stuff for her baby shower at Target.",
        explicitness: "explicit",
        factKind: undefined,
        kindHint: "fact",
        scopeKind: "identity",
      },
      {
        category: "personal",
        content: "My personal best time is 25:50.",
        explicitness: "explicit",
        factKind: undefined,
        kindHint: "fact",
        scopeKind: "identity",
      },
      {
        category: "personal",
        content:
          "I use Adobe Premiere Pro for advanced settings for video editing.",
        explicitness: "explicit",
        factKind: undefined,
        kindHint: "fact",
        scopeKind: "identity",
      },
    ]);
  });

  it("uses generic recent-event and active-work grammar without domain normalization", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I recently finished a ceramic glaze sample that still needs firing.",
        },
        {
          role: "user",
          content:
            "I recently catalogued a river sediment core for the archive.",
        },
        {
          role: "user",
          content:
            "By the way, I just acquired a kiln controller at the reuse center.",
        },
        {
          role: "user",
          content:
            "I also started working on the orchard irrigation dashboard.",
        },
        {
          role: "user",
          content:
            "Have you tried any of the samples? I've tried four different ones so far.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        category: "event",
        content: "I finished a ceramic glaze sample that still needs firing.",
        kindHint: "fact",
      },
      {
        category: "event",
        content: "I catalogued a river sediment core for the archive.",
        kindHint: "fact",
      },
      {
        category: "event",
        content: "I acquired a kiln controller at the reuse center.",
        kindHint: "fact",
      },
      {
        category: "project",
        content: "I am working on the orchard irrigation dashboard.",
        kindHint: "fact",
      },
    ]);
  });

  it("keeps future tasks and direct personal-best claims domain-neutral", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I think I'll take a break and calibrate the pressure gauge before Thursday.",
        },
        {
          role: "user",
          content:
            "I'm hoping to beat my personal best time of 25:50 this time around.",
        },
      ],
    });

    expect(
      result.candidates
        .filter((candidate) => candidate.kindHint === "fact")
        .map((candidate) => ({
          category: candidate.metadata?.category,
          content: candidate.content,
          factKind: candidate.metadata?.factKind,
          kindHint: candidate.kindHint,
        })),
    ).toEqual([
      {
        category: "personal",
        content:
          "I still need to take a break and calibrate the pressure gauge before Thursday.",
        factKind: "open_loop",
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "My personal best time is 25:50.",
        factKind: undefined,
        kindHint: "fact",
      },
    ]);
  });

  it("extracts academic and professional project involvement facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I'm working on a project that involves analyzing customer data to identify trends and patterns.",
        },
        {
          role: "user",
          content:
            "I've had some experience with data analysis from my Marketing Research class project, where I led the data analysis team and we did a comprehensive market analysis.",
        },
        {
          role: "user",
          content:
            "I recently participated in an accessibility review workshop.",
        },
        {
          role: "user",
          content:
            "I recently presented the indexing migration proposal to the architecture council.",
        },
        {
          role: "user",
          content:
            "I've been working on the archive digitization rollout.",
        },
      ],
    });

    expect(
      result.candidates
        .filter((candidate) => candidate.kindHint === "fact")
        .map((candidate) => ({
          category: candidate.metadata?.category,
          content: candidate.content,
          factKind: candidate.metadata?.factKind,
          kindHint: candidate.kindHint,
        })),
    ).toEqual([
      {
        category: "project",
        content:
          "I am working on a project that involves analyzing customer data to identify trends and patterns.",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content:
          "I led the data analysis team for my Marketing Research class project.",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content: "I participated in an accessibility review workshop.",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content:
          "I presented the indexing migration proposal to the architecture council.",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content: "I am working on the archive digitization rollout.",
        factKind: "generic_project",
        kindHint: "fact",
      },
    ]);
  });

  it("extracts relationship relocation updates as durable facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "I'm also thinking about visiting my friend Rachel who recently moved to a new apartment in the city.",
        },
        {
          role: "user",
          content:
            "My friend Rachel actually just moved back to the suburbs again.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        claimKey: candidate.metadata?.attributes?.claimKey,
        category: candidate.metadata?.category,
        content: candidate.content,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        claimKey: "relationship.location",
        category: "relationship",
        content: "Rachel moved to a new apartment in the city.",
        kindHint: "fact",
      },
      {
        claimKey: "relationship.location",
        category: "relationship",
        content: "Rachel moved back to the suburbs again.",
        kindHint: "fact",
      },
    ]);
  });

  it("does not infer identity from domain questions and keeps explicit user identity", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Can you recommend some options compatible with my KX-4 controller?",
        },
        {
          role: "user",
          content:
            "What's the best way to clean a tungsten nozzle?",
        },
        {
          role: "user",
          content:
            "As a ceramic kiln user, I've been thinking about upgrading the vent.",
        },
        {
          role: "user",
          content:
            "Can you give me an overview of the recent advancements in this field of deep learning for medical image analysis? Skip the basics as I am working in the field.",
        },
        {
          role: "user",
          content:
            "I'd like to explore some more research papers and articles on the topic of explainable AI in medical image analysis.",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        category: "personal",
        content: "I am a ceramic kiln user.",
        kindHint: "fact",
      },
    ]);
  });

  it("does not classify scoped carry-over avoidance rules as project facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Remember that for productivity tasks, I avoid irrelevant carry-over from hobby preferences.",
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kindHint).toBe("fact");
    expect(result.candidates[0]?.metadata?.category).toBe("personal");
  });

  it("classifies plural project nouns as project facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        { role: "user", content: "Remember that workflows are unstable." },
        { role: "user", content: "Remember that runbooks need revision." },
        { role: "user", content: "Remember that playbooks are outdated." },
        { role: "user", content: "Remember that projects are blocked." },
      ],
    });

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.every((candidate) => candidate.metadata?.category === "project")).toBe(
      true,
    );
  });

  it("does not duplicate pure profile remember-that clauses as explicit facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const nameResult = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that my name is Felix." }],
    });
    const roleResult = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that I'm a climate policy advisor in Austin, USA.",
        },
      ],
    });

    expect(nameResult.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
    ]);
    expect(nameResult.candidates[0]?.metadata?.profileField).toBe("name");
    expect(roleResult.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
      "profile",
    ]);
    expect(roleResult.candidates.every((candidate) => candidate.kindHint !== "fact")).toBe(
      true,
    );
  });

  it("extracts Chinese profile, fact, preference, reference, and feedback candidates", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh" },
      messages: [
        {
          role: "user",
          content:
            "我叫李雷。我在Acme工作。我是后端工程师。我的时区是Asia/Shanghai。我常用语言是中文。",
        },
        {
          role: "user",
          content: "请记住工作流目前仍然被生产迁移阻塞。",
        },
        {
          role: "user",
          content: "我偏好用要点回复。",
        },
        {
          role: "user",
          content: "以docs/runbook.md为准。",
        },
        {
          role: "user",
          content: "请以后优先给我简洁回答。",
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
      "profile",
      "profile",
      "profile",
      "profile",
      "fact",
      "preference",
      "reference",
      "feedback",
    ]);
    expect(result.candidates[0]?.content).toBe("李雷");
    expect(result.candidates[4]?.content).toBe("中文");
    expect(result.candidates[5]?.content).toContain("生产迁移阻塞");
    expect(result.candidates[6]?.metadata?.preferenceValue).toBe("用要点回复");
    expect(result.candidates[7]?.metadata?.referencePointer).toBe("docs/runbook.md");
    expect(result.candidates[8]?.metadata?.feedbackKind).toBe("prefer");
  });

  it("extracts the same durable memory families from Traditional Chinese", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-TW",
      scope: { userId: "u-hant", sessionId: "s-hant" },
      messages: [
        { role: "user", content: "請記住我叫陳美玲。" },
        { role: "user", content: "請記住目前專案的阻塞是審批。" },
        { role: "user", content: "我偏好使用繁體中文回覆。" },
        { role: "user", content: "現在以 docs/runtime.md 為準。" },
        { role: "user", content: "請以條列式回答。" },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
      "fact",
      "preference",
      "reference",
      "feedback",
    ]);
    expect(result.candidates[0]?.content).toBe("陳美玲");
    expect(result.candidates[3]?.metadata?.referencePointer).toBe(
      "docs/runtime.md",
    );
  });

  it("extracts profile, fact, preference, reference, and feedback in Japanese", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "ja-JP",
      scope: { userId: "u-ja", sessionId: "s-ja" },
      messages: [
        { role: "user", content: "私の現在の役割はプラットフォームエンジニアです。" },
        { role: "user", content: "覚えておいて、現在のブロッカーは承認待ちです。" },
        { role: "user", content: "私は簡潔な回答が好きです。" },
        { role: "user", content: "docs/runbook.mdを正とする。" },
        { role: "user", content: "今後は箇条書きを優先してください。" },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.kindHint)).toEqual([
      "profile",
      "fact",
      "preference",
      "reference",
      "feedback",
    ]);
    expect(result.candidates[0]?.content).toBe(
      "プラットフォームエンジニア",
    );
    expect(result.candidates[3]?.metadata?.referencePointer).toBe(
      "docs/runbook.md",
    );
  });

  it("uses generic Chinese personal, open-loop, event, and learning grammar", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh-phase62-personal" },
      messages: [
        {
          role: "user",
          content: "我毕业于工商管理专业，这对我的新工作有帮助。",
        },
        {
          role: "user",
          content: "我的日常通勤需要45分钟。",
        },
        {
          role: "user",
          content: "我还需要校准压力计。",
        },
        {
          role: "user",
          content: "我需要归档观测记录。",
        },
        {
          role: "user",
          content: "我刚整理了河流沉积物样本。",
        },
        {
          role: "user",
          content: "我这次陶艺评比的个人最佳成绩是95分。",
        },
        {
          role: "user",
          content: "我正在学习光谱分析，使用开源工具箱。",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        factKind: candidate.metadata?.factKind,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        category: "personal",
        content: "我毕业于工商管理专业。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我的日常通勤需要45分钟。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我仍需校准压力计。",
        factKind: "open_loop",
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我仍需归档观测记录。",
        factKind: "open_loop",
        kindHint: "fact",
      },
      {
        category: "event",
        content: "我整理了河流沉积物样本。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我在陶艺评比的个人最好成绩是95分。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我用开源工具箱学习光谱分析。",
        factKind: undefined,
        kindHint: "fact",
      },
    ]);
  });

  it("extracts Chinese explicit personal attribute facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh-attributes" },
      messages: [
        {
          role: "user",
          content: "顺便说一下，我的猫的名字是露娜。",
        },
        {
          role: "user",
          content: "我家狗Max是金毛，想给它买个新项圈。",
        },
        {
          role: "user",
          content: "我本科在UCLA读计算机，之后一直在科技行业工作。",
        },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.content)).toEqual(
      expect.arrayContaining([
        "我的猫叫露娜。",
        "我的狗Max是金毛。",
        "我的计算机本科学校是UCLA。",
      ]),
    );
  });

  it("uses generic Chinese event, project, and relationship grammar", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh-phase62-hobby" },
      messages: [
        {
          role: "user",
          content: "我最近完成了陶瓷釉料样本。",
        },
        {
          role: "user",
          content: "我刚入手了便携式湿度传感器。",
        },
        {
          role: "user",
          content: "我正在推进社区花园灌溉上线。",
        },
        {
          role: "user",
          content: "我主导了数据清洗和演示。",
        },
        {
          role: "user",
          content: "我的朋友小王最近搬到了杭州。",
        },
      ],
    });

    expect(
      result.candidates
        .filter((candidate) => candidate.kindHint === "fact")
        .map((candidate) => ({
          category: candidate.metadata?.category,
          content: candidate.content,
          factKind: candidate.metadata?.factKind,
          kindHint: candidate.kindHint,
        })),
    ).toEqual([
      {
        category: "event",
        content: "我完成了陶瓷釉料样本。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "event",
        content: "我入手了便携式湿度传感器。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "project",
        content: "我正在做社区花园灌溉上线。",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content: "我主导了数据清洗和演示。",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "relationship",
        content: "小王搬到了杭州。",
        factKind: undefined,
        kindHint: "fact",
      },
    ]);
  });

  it("uses generic Chinese use, event, open-loop, identity, and project grammar", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh-phase62-retail" },
      messages: [
        {
          role: "user",
          content: "我一直用北风仓库的库存应用。",
        },
        {
          role: "user",
          content: "我上周登记了5份土壤样本。",
        },
        {
          role: "user",
          content: "我会休息一下再校准光谱仪。",
        },
        {
          role: "user",
          content: "作为陶瓷窑用户，我想升级排气口。",
        },
        {
          role: "user",
          content: "我最近参加了可访问性评审。",
        },
        {
          role: "user",
          content: "我展示了灌溉上线方案。",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        category: candidate.metadata?.category,
        content: candidate.content,
        factKind: candidate.metadata?.factKind,
        kindHint: candidate.kindHint,
      })),
    ).toEqual([
      {
        category: "personal",
        content: "我使用北风仓库的库存应用。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "event",
        content: "我登记了5份土壤样本。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我仍需休息一下再校准光谱仪。",
        factKind: "open_loop",
        kindHint: "fact",
      },
      {
        category: "personal",
        content: "我是陶瓷窑用户。",
        factKind: undefined,
        kindHint: "fact",
      },
      {
        category: "project",
        content: "我参加了可访问性评审。",
        factKind: "generic_project",
        kindHint: "fact",
      },
      {
        category: "project",
        content: "我展示了灌溉上线方案。",
        factKind: "generic_project",
        kindHint: "fact",
      },
    ]);
  });

  it("treats common Chinese workplace location phrasing as location, not organization", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-1", sessionId: "s-zh-location" },
      messages: [
        {
          role: "user",
          content: "我在北京工作。我是后端工程师。",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        kindHint: candidate.kindHint,
        content: candidate.content,
        profileField: candidate.metadata?.profileField,
      })),
    ).toEqual([
      {
        kindHint: "profile",
        content: "北京",
        profileField: "location",
      },
      {
        kindHint: "profile",
        content: "后端工程师",
        profileField: "role",
      },
    ]);
  });

  it("does not force ambiguous Chinese work subjects into organization memory", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-zh-ambiguous" },
      messages: [
        {
          role: "user",
          content: "我在凤凰工作。我是记者。",
        },
      ],
    });

    expect(
      result.candidates.map((candidate) => ({
        kindHint: candidate.kindHint,
        content: candidate.content,
        profileField: candidate.metadata?.profileField,
      })),
    ).toEqual([
      {
        kindHint: "profile",
        content: "记者",
        profileField: "role",
      },
    ]);
  });

  it("extracts mixed-language user batches without dropping one language", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-mixed-lang" },
      messages: [
        {
          role: "user",
          content: "请记住我喜欢中文回复。",
        },
        {
          role: "user",
          content: "Use docs/runbook.md as the source of truth.",
        },
      ],
    });

    expect(
      result.candidates.some(
        (candidate) =>
          candidate.kindHint === "reference" &&
          candidate.content === "docs/runbook.md",
      ),
    ).toBe(true);
    expect(
      result.candidates.some(
        (candidate) =>
          (candidate.kindHint === "fact" || candidate.kindHint === "preference") &&
          candidate.content.includes("中文回复"),
      ),
    ).toBe(true);
    expect(result.ignoredMessageCount).toBe(0);
  });

  it("extracts English project-state candidates from next-milestone wording", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-project-state-next" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next milestone is cutover readiness for release quality program.",
        },
      ],
    });

    const factCandidate = result.candidates.find(
      (candidate) => candidate.kindHint === "fact",
    );

    expect(factCandidate?.metadata?.factKind).toBe("project_state");
    expect(factCandidate?.metadata?.category).toBe("project");
    expect(factCandidate?.metadata?.subject).toBe("release quality program");
  });

  it("does not classify service or feature project-state facts as personal", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-category-consistency" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next step for the service that has to stay online is vendor validation.",
        },
        {
          role: "user",
          content:
            "Remember that owner review is still pending for the feature that has review dependencies.",
        },
      ],
    });

    const categories = result.candidates
      .filter((candidate) => candidate.kindHint === "fact")
      .map((candidate) => candidate.metadata?.category);

    expect(categories).not.toContain("personal");
  });

  it("trims English fact subjects before trailing predicate detail", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-subject-trim" },
      messages: [
        {
          role: "user",
          content:
            "Remember that my current focus is runtime reliability for release quality program and driving runtime reliability.",
        },
      ],
    });

    const factCandidate = result.candidates.find(
      (candidate) => candidate.kindHint === "fact",
    );

    expect(factCandidate?.metadata?.subject).toBe("release quality program");
  });

  it("preserves English subjects that contain 'to' as part of the project name", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-subject-to-project" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next milestone is cutover readiness for migration to Bun.",
        },
        {
          role: "user",
          content:
            "Remember that owner review is still pending for A to B migration.",
        },
      ],
    });

    const factSubjects = result.candidates
      .filter((candidate) => candidate.kindHint === "fact")
      .map((candidate) => candidate.metadata?.subject);

    expect(factSubjects).toContain("migration to bun");
    expect(factSubjects).toContain("a to b migration");
  });

  it("stops English scoped subjects at the predicate boundary instead of swallowing the whole clause", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-scoped-subject-boundary" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next step for migration rollout is vendor validation.",
        },
        {
          role: "user",
          content:
            "Remember that owner signoff for A to B migration is still pending.",
        },
      ],
    });

    const factSubjects = result.candidates
      .filter((candidate) => candidate.kindHint === "fact")
      .map((candidate) => candidate.metadata?.subject);

    expect(factSubjects).toContain("migration rollout");
    expect(factSubjects).toContain("a to b migration");
  });

  it("preserves English subjects that contain relative clauses instead of truncating them into fragments", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-relative-clause-subject" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next milestone is cutover readiness for the service that has to stay online.",
        },
        {
          role: "user",
          content:
            "Remember that owner review is still pending for the feature that has review dependencies.",
        },
      ],
    });

    const factSubjects = result.candidates
      .filter((candidate) => candidate.kindHint === "fact")
      .map((candidate) => candidate.metadata?.subject);

    expect(factSubjects).toContain("service that has to stay online");
    expect(factSubjects).toContain("feature that has review dependencies");
  });

  it("stops at the outer predicate after a relative clause instead of returning the whole sentence tail", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-relative-clause-outer-boundary" },
      messages: [
        {
          role: "user",
          content:
            "Remember that the next step for the feature that has review dependencies is vendor validation.",
        },
      ],
    });

    const factCandidate = result.candidates.find(
      (candidate) => candidate.kindHint === "fact",
    );

    expect(factCandidate?.metadata?.subject).toBe(
      "feature that has review dependencies",
    );
  });

  it("uses the same bounded subject extraction for English references", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-reference-subject-boundary" },
      messages: [
        {
          role: "user",
          content:
            "Use docs/service-runbook.md as the source of truth for the service that has to stay online.",
        },
      ],
    });

    const referenceCandidate = result.candidates.find(
      (candidate) => candidate.kindHint === "reference",
    );

    expect(referenceCandidate?.metadata?.subject).toBe(
      "service that has to stay online",
    );
  });

  it("preserves superseded pointer metadata for corrected Chinese references", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-zh-correction" },
      messages: [
        {
          role: "user",
          content: "现在以docs/new.md为准，不再以docs/old.md为准。",
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kindHint).toBe("reference");
    expect(result.candidates[0]?.metadata?.referencePointer).toBe("docs/new.md");
    expect(result.candidates[0]?.metadata?.supersedesPointer).toBe("docs/old.md");
  });

  it("extracts Chinese project subjects for explicitly named facts and references", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-zh-subjects" },
      messages: [
        {
          role: "user",
          content: "请记住当前阻塞是迁移流程的供应商审批。",
        },
        {
          role: "user",
          content: "迁移流程以docs/migration-runbook.md为准。",
        },
      ],
    });

    expect(
      result.candidates.find((candidate) => candidate.kindHint === "fact")?.metadata?.subject,
    ).toBe("迁移流程");
    expect(
      result.candidates.find((candidate) => candidate.kindHint === "reference")?.metadata?.subject,
    ).toBe("迁移流程");
  });

  it("keeps Chinese reference subjects unknown when only temporal or directive wording precedes the pointer", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      scope: { userId: "u-1", sessionId: "s-zh-reference-noise" },
      messages: [
        {
          role: "user",
          content: "以后都以docs/old-runbook.md为准。",
        },
      ],
    });

    const referenceCandidate = result.candidates.find(
      (candidate) => candidate.kindHint === "reference",
    );

    expect(referenceCandidate).toBeDefined();
    expect(referenceCandidate?.metadata?.subject).toBe("unknown");
  });
});
