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

  it("v0.7.4 explicit facts C1 strips a directive colon", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const content of [
      "请记住：编辑器=Neovim",
      "请你记住：编辑器=Neovim",
      "请帮我记住：编辑器=Neovim",
      "麻烦你记住：编辑器=Neovim",
    ]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        scope: { userId: "u-explicit-c1", sessionId: "s-explicit-c1" },
        messages: [{ role: "user", content }],
      });

      expect(result.candidates.map(({ content }) => content)).toEqual([
        "编辑器=Neovim",
      ]);
    }
  });

  it("v0.7.4 explicit facts C2 strips a counted-list prefix", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-c2", sessionId: "s-explicit-c2" },
      messages: [{ role: "user", content: "请记住以下一件事：编辑器=Neovim" }],
    });

    expect(result.candidates.map(({ content }) => content)).toEqual([
      "编辑器=Neovim",
    ]);
  });

  it("v0.7.4 explicit facts C3 extracts every semicolon-delimited counted fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-c3", sessionId: "s-explicit-c3" },
      messages: [
        {
          role: "user",
          content: "两件事：编辑器=Neovim；项目代号=Tachikoma",
        },
      ],
    });

    expect(
      result.candidates.map(({ content, explicitness, kindHint }) => ({
        content,
        explicitness,
        kindHint,
      })),
    ).toEqual([
      {
        content: "编辑器=Neovim",
        explicitness: "explicit",
        kindHint: "fact",
      },
      {
        content: "项目代号=Tachikoma",
        explicitness: "explicit",
        kindHint: "fact",
      },
    ]);
  });

  it("v0.7.4 explicit facts C4 extracts every full-stop-delimited counted fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-c4", sessionId: "s-explicit-c4" },
      messages: [
        {
          role: "user",
          content: "请记住两件事：我最喜欢的编辑器是 Neovim。项目代号=Tachikoma。",
        },
      ],
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content, explicitness }) => ({ content, explicitness })),
    ).toEqual([
      {
        content: "我最喜欢的编辑器是 Neovim",
        explicitness: "explicit",
      },
      {
        content: "项目代号=Tachikoma",
        explicitness: "explicit",
      },
    ]);
  });

  it("v0.7.4 explicit facts C5 drops directives whose cleaned fact is empty", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-c5", sessionId: "s-explicit-c5" },
      messages: [
        { role: "user", content: "请记住；" },
        { role: "user", content: "请记住。" },
      ],
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not treat a negated or quoted remember directive as an explicit fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const content of [
      "不要记住项目代号=Tachikoma",
      "他说请记住项目代号=Tachikoma",
    ]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        scope: { userId: "u-explicit-boundary", sessionId: "s-explicit-boundary" },
        messages: [{ role: "user", content }],
      });

      expect(result.candidates.some(
        ({ explicitness, kindHint }) =>
          kindHint === "fact" && explicitness === "explicit",
      )).toBe(false);
    }
  });

  it("does not turn a counted task list into explicit facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const content of [
      "两件事：请修改文件；运行测试",
      "两件事：检查 foo=bar 是否正确；执行 baz=qux",
      "两件事：请设置编辑器=Neovim；运行模式=test",
    ]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        scope: { userId: "u-explicit-tasks", sessionId: "s-explicit-tasks" },
        messages: [{ role: "user", content }],
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("does not turn counted questions into explicit facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-questions", sessionId: "s-explicit-questions" },
      messages: [
        {
          role: "user",
          content: "两件事：我的编辑器是什么；我的项目代号是什么",
        },
      ],
    });

    expect(result.candidates.some(
      ({ explicitness, kindHint }) =>
        kindHint === "fact" && explicitness === "explicit",
    )).toBe(false);
  });

  it("does not extract remember questions as explicit facts", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const content of ["记住了吗？", "請記住了嗎？", "有个事实吗？"]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        scope: { userId: "u-explicit-question", sessionId: "s-explicit-question" },
        messages: [{ role: "user", content }],
      });

      expect(result.candidates.some(
        ({ explicitness, kindHint }) =>
          kindHint === "fact" && explicitness === "explicit",
      )).toBe(false);
    }
  });

  it("keeps question words as literal values in directive assignments", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const [source, expected] of [
      ["请记住字段名=是否启用", "字段名=是否启用"],
      ["请记住FAQ标题=为什么失败", "FAQ标题=为什么失败"],
    ]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        scope: { userId: "u-explicit-literal", sessionId: "s-explicit-literal" },
        messages: [{ role: "user", content: source }],
      });

      expect(result.candidates.map(({ content, kindHint }) => ({ content, kindHint }))).toEqual([
        { content: expected, kindHint: "fact" },
      ]);
    }
  });

  it("keeps typed preferences out of the generic explicit-fact lane", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-preference", sessionId: "s-explicit-preference" },
      messages: [
        {
          role: "user",
          content: "请记住两件事：我偏好简洁回复；项目代号=Tachikoma",
        },
      ],
    });

    expect(result.candidates.map(({ content, kindHint }) => ({ content, kindHint }))).toEqual([
      { content: "简洁回复", kindHint: "preference" },
      { content: "项目代号=Tachikoma", kindHint: "fact" },
    ]);
  });

  it("uses generic explicit facts only when no typed fact was extracted", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "zh-CN",
      scope: { userId: "u-explicit-typed", sessionId: "s-explicit-typed" },
      messages: [
        {
          role: "user",
          content: "请记住两件事：我在北京生活；我使用 Neovim",
        },
      ],
    });

    expect(result.candidates.filter(({ kindHint }) => kindHint === "profile")).toHaveLength(1);
    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content }) => content),
    ).toEqual(["我使用Neovim。"]);
  });

  it("does not duplicate an explicit technical reference as a generic fact", async () => {
    const extractor = createDeterministicMemoryExtractor();

    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things: reference=docs/current.md; project code=Tachikoma",
      }],
      scope: { sessionId: "typed-reference", userId: "typed-reference" },
    });

    expect(
      result.candidates.map(({ content, kindHint }) => ({ content, kindHint })),
    ).toEqual([
      { content: "docs/current.md", kindHint: "reference" },
      { content: "project code=Tachikoma", kindHint: "fact" },
    ]);
  });

  it("extracts every fact from explicit compound lists in every built-in language", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      {
        expected: ["editor=Neovim", "project code=Tachikoma"],
        locale: "en-US",
        source: "Remember two things: editor=Neovim; project code=Tachikoma",
      },
      {
        expected: ["éditeur=Neovim", "code projet=Tachikoma"],
        locale: "fr-FR",
        source: "Souviens-toi de deux choses : éditeur=Neovim ; code projet=Tachikoma",
      },
      {
        expected: ["editor=Neovim", "código de proyecto=Tachikoma"],
        locale: "es-ES",
        source: "Recuerda dos cosas: editor=Neovim; código de proyecto=Tachikoma",
      },
      {
        expected: ["エディタ=Neovim", "プロジェクトコード=Tachikoma"],
        locale: "ja-JP",
        source: "二つのことを覚えておいて：エディタ=Neovim；プロジェクトコード=Tachikoma",
      },
      {
        expected: ["편집기=Neovim", "프로젝트 코드=Tachikoma"],
        locale: "ko-KR",
        source: "두 가지를 기억해 주세요: 편집기=Neovim; 프로젝트 코드=Tachikoma",
      },
    ] as const;

    for (const fixture of fixtures) {
      const result = await extractor.extract({
        locale: fixture.locale,
        messages: [{ role: "user", content: fixture.source }],
        scope: {
          sessionId: `compound-${fixture.locale}`,
          userId: `compound-${fixture.locale}`,
        },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([...fixture.expected]);
    }
  });

  it("preserves polite leading forms of explicit remember directives", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      {
        expected: "editor=Neovim",
        locale: "en-US",
        source: "Please remember that editor=Neovim",
      },
      {
        expected: "éditeur=Neovim",
        locale: "fr-FR",
        source: "S’il te plaît, souviens-toi que éditeur=Neovim",
      },
      {
        expected: "éditeur=Neovim",
        locale: "fr-FR",
        source: "S'il vous plaît mémorise que éditeur=Neovim",
      },
      {
        expected: "editor=Neovim",
        locale: "es-ES",
        source: "Por favor, recuerda que editor=Neovim",
      },
      {
        expected: "editor=Neovim",
        locale: "es-ES",
        source: "Por favor recuerda que editor=Neovim",
      },
      {
        expected: "エディタ=Neovim",
        locale: "ja-JP",
        source: "これを覚えておいて、エディタ=Neovim",
      },
      {
        expected: "편집기=Neovim",
        locale: "ko-KR",
        source: "이것을 기억해 주세요, 편집기=Neovim",
      },
    ] as const;

    for (const fixture of fixtures) {
      const result = await extractor.extract({
        locale: fixture.locale,
        messages: [{ role: "user", content: fixture.source }],
        scope: {
          sessionId: `polite-${fixture.locale}`,
          userId: `polite-${fixture.locale}`,
        },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([fixture.expected]);
    }
  });

  it("preserves clause-leading remember directives after ordinary context", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "My name is Lin. Remember that the migration rollout is blocked on prod verification.",
      }],
      scope: { sessionId: "clause-leading", userId: "clause-leading" },
    });

    expect(result.candidates.map(({ content, explicitness, kindHint }) => ({
      content,
      explicitness,
      kindHint,
    }))).toEqual([
      { content: "Lin", explicitness: "explicit", kindHint: "profile" },
      {
        content: "the migration rollout is blocked on prod verification.",
        explicitness: "explicit",
        kindHint: "fact",
      },
    ]);
  });

  it("preserves clause-leading directives after ordinary context in every pack", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["fr-FR", "Contexte ordinaire. Souviens-toi que éditeur=Neovim", "éditeur=Neovim"],
      ["es-ES", "Contexto normal. Recuerda que editor=Neovim", "editor=Neovim"],
      ["ja-JP", "通常の文です。覚えておいて、エディタ=Neovim", "エディタ=Neovim"],
      ["ko-KR", "일반 문장입니다. 기억해 주세요, 편집기=Neovim", "편집기=Neovim"],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `clause-${locale}`, userId: `clause-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([expected]);
    }
  });

  it("preserves every nested list item after ordinary context in every pack", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Ordinary context. Remember two things: editor=Neovim; shell=zsh",
        ["editor=Neovim", "shell=zsh"],
      ],
      [
        "zh-CN",
        "普通上下文。请记住两件事：编辑器=Neovim；项目代号=Tachikoma",
        ["编辑器=Neovim", "项目代号=Tachikoma"],
      ],
      [
        "fr-FR",
        "Contexte ordinaire. Souviens-toi de deux choses : éditeur=Neovim ; shell=zsh",
        ["éditeur=Neovim", "shell=zsh"],
      ],
      [
        "es-ES",
        "Contexto normal. Recuerda dos cosas: editor=Neovim; shell=zsh",
        ["editor=Neovim", "shell=zsh"],
      ],
      [
        "ja-JP",
        "通常の文です。二つのことを覚えておいて：エディタ=Neovim；シェル=zsh",
        ["エディタ=Neovim", "シェル=zsh"],
      ],
      [
        "ko-KR",
        "일반 문장입니다. 두 가지를 기억해 주세요: 편집기=Neovim; 셸=zsh",
        ["편집기=Neovim", "셸=zsh"],
      ],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `nested-${locale}`, userId: `nested-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([...expected]);
    }
  });

  it("stops explicit propagation after the declared directive payload", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Context. Remember that editor=Neovim. The weather is pleasant.", "editor=Neovim."],
      ["zh-CN", "普通上下文。请记住编辑器=Neovim。今天天气很好。", "编辑器=Neovim"],
      ["fr-FR", "Contexte. Souviens-toi que éditeur=Neovim. Il fait beau.", "éditeur=Neovim"],
      ["es-ES", "Contexto. Recuerda que editor=Neovim. Hace buen tiempo.", "editor=Neovim"],
      ["ja-JP", "通常の文です。覚えておいて：エディタ=Neovim。今日は晴れです。", "エディタ=Neovim"],
      ["ko-KR", "일반 문장입니다. 기억해 주세요: 편집기=Neovim. 오늘은 맑습니다.", "편집기=Neovim"],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `bounded-${locale}`, userId: `bounded-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([expected]);
    }
  });

  it("drops malformed list payloads and rejects questions inside explicit lists", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["fr-FR", "Souviens-toi de deux choses"],
      ["fr-FR", "Souviens-toi ---"],
      ["fr-FR", "Souviens-toi ? code projet=Tachikoma"],
      ["es-ES", "Recuerda dos cosas"],
      ["es-ES", "Recuerda ()"],
      ["es-ES", "Recuerda? código de proyecto=Tachikoma"],
      ["ja-JP", "二つのことを覚えておいて：何が好きですか？；エディタ=Neovim"],
      ["ko-KR", "두 가지를 기억해 주세요: 무엇을 좋아하나요?; 편집기=Neovim"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `malformed-${locale}`, userId: `malformed-${locale}` },
      });

      expect(result.candidates.some(
        ({ explicitness, kindHint }) =>
          explicitness === "explicit" && kindHint === "fact",
      )).toBe(false);
    }
  });

  it("does not propagate explicit intent into an opt-out clause", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Remember two things: editor=Neovim; do not remember project code=Tachikoma",
        "editor=Neovim",
      ],
      [
        "en-US",
        "Remember two things: editor=Neovim; do not remember I am working on Tachikoma",
        "editor=Neovim",
      ],
      [
        "en-US",
        "Remember two things: editor=Neovim; don’t remember project code=Tachikoma",
        "editor=Neovim",
      ],
      [
        "zh-CN",
        "请记住两件事：编辑器=Neovim；不要记住项目代号=Tachikoma",
        "编辑器=Neovim",
      ],
      [
        "ja-JP",
        "二つのことを覚えておいて：エディタ=Neovim；プロジェクトコードは覚えないでください",
        "エディタ=Neovim",
      ],
      [
        "ko-KR",
        "두 가지를 기억해 주세요: 편집기=Neovim; 프로젝트 코드는 기억하지 마세요",
        "편집기=Neovim",
      ],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `opt-out-${locale}`, userId: `opt-out-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([expected]);
    }
  });

  it("keeps typed references closed for explicit opt-out payloads", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember two things: editor=Neovim; do not remember that use docs/secret.md as the source of truth", "editor=Neovim"],
      ["zh-CN", "请记住两件事：编辑器=Neovim；不要记住以后以 docs/secret.md 为准", "编辑器=Neovim"],
      ["fr-FR", "Souviens-toi de deux choses : éditeur=Neovim ; ne mémorise pas utilise docs/secret.md comme source de vérité", "éditeur=Neovim"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim; no recuerdes usa docs/secret.md como fuente de verdad", "editor=Neovim"],
      ["ja-JP", "二つのことを覚えておいて：エディタ=Neovim；docs/secret.mdを正とするのは覚えないでください", "エディタ=Neovim"],
      ["ko-KR", "두 가지를 기억해 주세요: 편집기=Neovim; docs/secret.md를 기준 문서로 사용한다고 기억하지 마세요", "편집기=Neovim"],
    ] as const;

    for (const [locale, source, expectedFact] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `reference-opt-out-${locale}`, userId: `reference-opt-out-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "reference")).toBe(false);
      expect(
        result.candidates
          .filter(({ kindHint }) => kindHint === "fact")
          .map(({ content }) => content),
      ).toEqual([expectedFact]);
    }
  });

  it("keeps typed memory lanes closed for explicit opt-out payloads", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Do not remember that I am working on Tachikoma"],
      ["zh-CN", "不要记住我正在做Tachikoma"],
      ["fr-FR", "Ne mémorise pas mon objectif actuel est Tachikoma"],
      ["es-ES", "No recuerdes mi objetivo actual es Tachikoma"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `typed-opt-out-${locale}`, userId: `typed-opt-out-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("fails closed when an explicit list is incomplete or starts with an invalid item", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember two things: editor=Neovim"],
      ["zh-CN", "请记住两件事：编辑器=Neovim"],
      ["fr-FR", "Souviens-toi de deux choses : éditeur=Neovim"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim"],
      ["ja-JP", "二つのことを覚えておいて：エディタ=Neovim"],
      ["ko-KR", "두 가지를 기억해 주세요: 편집기=Neovim"],
      ["en-US", "Remember two things: what is my project code; editor=Neovim"],
      ["zh-CN", "请记住两件事：我的项目代号是什么；编辑器=Neovim"],
      ["fr-FR", "Souviens-toi de deux choses : quel est mon code projet ; éditeur=Neovim"],
      ["es-ES", "Recuerda dos cosas: cuál es mi código de proyecto; editor=Neovim"],
      ["ja-JP", "二つのことを覚えておいて：プロジェクトコードは何ですか；エディタ=Neovim"],
      ["ko-KR", "두 가지를 기억해 주세요: 프로젝트 코드는 무엇인가요; 편집기=Neovim"],
      ["en-US", "Remember 0 things: editor=Neovim"],
      ["zh-CN", "请记住0件事：编辑器=Neovim"],
      ["fr-FR", "Souviens-toi de 0 choses : éditeur=Neovim"],
      ["es-ES", "Recuerda 0 cosas: editor=Neovim"],
      ["ja-JP", "0つのことを覚えておいて：エディタ=Neovim"],
      ["ko-KR", "0 가지를 기억해 주세요: 편집기=Neovim"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `fail-closed-${locale}`, userId: `fail-closed-${locale}` },
      });

      expect(result.candidates.some(
        ({ explicitness, kindHint }) =>
          explicitness === "explicit" && kindHint === "fact",
      )).toBe(false);
    }
  });

  it("fails closed on unpunctuated questions inside explicit lists", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember two things: editor=Neovim; what is my project code"],
      ["zh-CN", "请记住两件事：编辑器=Neovim；我的项目代号是什么"],
      ["fr-FR", "Souviens-toi de deux choses : éditeur=Neovim ; quel est mon code projet"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim; cuál es mi código de proyecto"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim; ¿cuál es mi código de proyecto"],
      ["ja-JP", "二つのことを覚えておいて：エディタ=Neovim；プロジェクトコードは何ですか"],
      ["ko-KR", "두 가지를 기억해 주세요: 편집기=Neovim; 프로젝트 코드는 무엇인가요"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `question-${locale}`, userId: `question-${locale}` },
      });

      expect(result.candidates.some(
        ({ explicitness, kindHint }) =>
          explicitness === "explicit" && kindHint === "fact",
      )).toBe(false);
    }
  });

  it("keeps question words inside explicit assignment values", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "zh-CN",
        "两件事：字段名=是否启用；FAQ标题=为什么失败",
        ["字段名=是否启用", "FAQ标题=为什么失败"],
      ],
      [
        "fr-FR",
        "Souviens-toi : titre FAQ=Pourquoi cela échoue ?",
        ["titre FAQ=Pourquoi cela échoue"],
      ],
      [
        "es-ES",
        "Recuerda: título FAQ=¿Por qué falla?",
        ["título FAQ=¿Por qué falla"],
      ],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `assignment-${locale}`, userId: `assignment-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([...expected]);
    }
  });

  it("recognizes common French and Spanish counted-list words", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Remember three things: editor=Neovim; shell=zsh; theme=dark",
        ["editor=Neovim", "shell=zsh", "theme=dark"],
      ],
      [
        "fr-FR",
        "Souviens-toi de trois choses : éditeur=Neovim ; shell=zsh ; thème=dark",
        ["éditeur=Neovim", "shell=zsh", "thème=dark"],
      ],
      [
        "fr-FR",
        "S’il te plaît, souviens-toi de trois choses : éditeur=Neovim ; shell=zsh ; thème=dark",
        ["éditeur=Neovim", "shell=zsh", "thème=dark"],
      ],
      [
        "es-ES",
        "Recuerda tres cosas: editor=Neovim; shell=zsh; tema=dark",
        ["editor=Neovim", "shell=zsh", "tema=dark"],
      ],
      [
        "es-ES",
        "Por favor, recuerda tres cosas: editor=Neovim; shell=zsh; tema=dark",
        ["editor=Neovim", "shell=zsh", "tema=dark"],
      ],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `counted-${locale}`, userId: `counted-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact"
          )
          .map(({ content }) => content),
      ).toEqual([...expected]);
    }
  });

  it("keeps dotted technical identifiers intact in Korean explicit lists", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "ko-KR",
      messages: [{
        role: "user",
        content:
          "두 가지를 기억해 주세요: 기준 문서=docs/current.md; 프로젝트 코드=Tachikoma",
      }],
      scope: { sessionId: "ko-dotted", userId: "ko-dotted" },
    });

    expect(
      result.candidates
        .filter(({ explicitness, kindHint }) =>
          explicitness === "explicit" && kindHint === "fact"
        )
        .map(({ content }) => content),
    ).toEqual(["기준 문서=docs/current.md", "프로젝트 코드=Tachikoma"]);
  });

  it("keeps question punctuation as an assignment value while rejecting questions", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const literal = await extractor.extract({
      locale: "en-US",
      messages: [{ role: "user", content: "Remember that FAQ title=Why does it fail?" }],
      scope: { sessionId: "en-question-literal", userId: "en-question-literal" },
    });
    const question = await extractor.extract({
      locale: "en-US",
      messages: [{ role: "user", content: "Do you remember that project code=Tachikoma?" }],
      scope: { sessionId: "en-question", userId: "en-question" },
    });

    expect(literal.candidates.map(({ content, kindHint }) => ({ content, kindHint }))).toEqual([
      { content: "FAQ title=Why does it fail?", kindHint: "fact" },
    ]);
    expect(question.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
  });

  it("splits lowercase period-delimited facts inside an English counted list", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things: editor=Neovim. project code=Tachikoma",
      }],
      scope: { sessionId: "en-period-list", userId: "en-period-list" },
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content }) => content),
    ).toEqual(["editor=Neovim", "project code=Tachikoma"]);
  });

  it("rejects empty, negated, questioned, and quoted remember directives", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      {
        locale: "en-US",
        sources: [
          "Remember that;",
          "Do not remember that project code=Tachikoma",
          "Do you remember that project code=Tachikoma?",
          'The manual says "Remember that project code=Tachikoma".',
        ],
      },
      {
        locale: "fr-FR",
        sources: [
          "Souviens-toi ;",
          "Ne mémorise pas : code projet=Tachikoma",
          "Vous souvenez-vous que le code projet=Tachikoma ?",
          "Le manuel dit « Mémorise : code projet=Tachikoma ».",
        ],
      },
      {
        locale: "es-ES",
        sources: [
          "Recuerda;",
          "No recuerdes: código de proyecto=Tachikoma",
          "¿Recuerda que el código de proyecto=Tachikoma?",
          "El manual dice «Recuerda: código de proyecto=Tachikoma».",
        ],
      },
      {
        locale: "ja-JP",
        sources: [
          "覚えておいて；",
          "これは覚えておかないで：プロジェクトコード=Tachikoma",
          "何を覚えておいてほしいですか？",
          "「覚えておいて：プロジェクトコード=Tachikoma」とは言っていません。",
        ],
      },
      {
        locale: "ko-KR",
        sources: [
          "기억해 주세요;",
          "기억해 주세요가 아니라 삭제해 주세요.",
          "무엇을 기억해 주세요?",
          "제가 ‘기억해 주세요: 프로젝트 코드=Tachikoma’라고 말했나요?",
        ],
      },
    ] as const;

    for (const fixture of fixtures) {
      for (const source of fixture.sources) {
        const result = await extractor.extract({
          locale: fixture.locale,
          messages: [{ role: "user", content: source }],
          scope: {
            sessionId: `negative-${fixture.locale}`,
            userId: `negative-${fixture.locale}`,
          },
        });

        expect(result.candidates.some(
          ({ explicitness, kindHint }) =>
            explicitness === "explicit" && kindHint === "fact",
        )).toBe(false);
      }
    }
  });

  it("uses one opt-out disposition for polite save and record synonyms", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Remember two things: editor=Neovim; please do not save project code=Tachikoma",
        "editor=Neovim",
      ],
      [
        "zh-CN",
        "请记住两件事：编辑器=Neovim；请不要记录项目代号=Tachikoma",
        "编辑器=Neovim",
      ],
      [
        "fr-FR",
        "Souviens-toi de deux choses : éditeur=Neovim ; s’il te plaît, ne mémorise pas code projet=Tachikoma",
        "éditeur=Neovim",
      ],
      [
        "es-ES",
        "Recuerda dos cosas: editor=Neovim; por favor, no guardes código de proyecto=Tachikoma",
        "editor=Neovim",
      ],
    ] as const;

    for (const [locale, source, expectedFact] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `opt-out-synonym-${locale}`, userId: `opt-out-synonym-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ kindHint }) => kindHint === "fact")
          .map(({ content }) => content),
      ).toEqual([expectedFact]);
      expect(result.candidates.some(({ kindHint }) => kindHint === "reference")).toBe(false);
      expect(
        result.candidates.filter(({ kindHint, metadata }) =>
          kindHint === "feedback" && metadata?.feedbackKind === "dont"
        ),
      ).toHaveLength(1);
    }
  });

  it("drops leading conjunctions from semicolon-delimited opt-out clauses", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember two things: editor=Neovim; and do not remember project code=Tachikoma", "editor=Neovim"],
      ["zh-CN", "请记住两件事：编辑器=Neovim；而且不要记住项目代号=Tachikoma", "编辑器=Neovim"],
      ["fr-FR", "Souviens-toi de deux choses : éditeur=Neovim ; et ne mémorise pas code=Tachikoma", "éditeur=Neovim"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim; y no recuerdes código=Tachikoma", "editor=Neovim"],
      ["ja-JP", "二つのことを覚えておいて：エディタ=Neovim；そしてプロジェクトコード=Tachikomaは覚えないでください", "エディタ=Neovim"],
      ["ko-KR", "두 가지를 기억해 주세요: 편집기=Neovim; 그리고 프로젝트 코드=Tachikoma를 기억하지 마세요", "편집기=Neovim"],
    ] as const;

    for (const [locale, source, expectedFact] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `semicolon-opt-out-${locale}`, userId: `semicolon-opt-out-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ kindHint }) => kindHint === "fact")
          .map(({ content }) => content),
      ).toEqual([expectedFact]);
      expect(result.candidates.filter(({ kindHint, metadata }) =>
        kindHint === "feedback" && metadata?.feedbackKind === "dont"
      )).toHaveLength(1);
    }
  });

  it("emits the exact opt-out target from every canonical language pack", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Remember two things: project code=Tachikoma; do not remember project code=Tachikoma",
        "Remember two things: project code=Kusanagi; do not remember project code=Tachikoma",
        "project code",
        "project code=Tachikoma",
      ],
      [
        "zh-CN",
        "请记住两件事：项目代号=Tachikoma；不要记住项目代号=Tachikoma",
        "请记住两件事：项目代号=Kusanagi；不要记住项目代号=Tachikoma",
        "项目代号",
        "项目代号=Tachikoma",
      ],
      [
        "fr-FR",
        "Souviens-toi de deux choses : code projet=Tachikoma ; ne mémorise pas code projet=Tachikoma",
        "Souviens-toi de deux choses : code projet=Kusanagi ; ne mémorise pas code projet=Tachikoma",
        "code projet",
        "code projet=Tachikoma",
      ],
      [
        "es-ES",
        "Recuerda dos cosas: código de proyecto=Tachikoma; no recuerdes código de proyecto=Tachikoma",
        "Recuerda dos cosas: código de proyecto=Kusanagi; no recuerdes código de proyecto=Tachikoma",
        "código de proyecto",
        "código de proyecto=Tachikoma",
      ],
      [
        "ja-JP",
        "二つのことを覚えておいて：プロジェクトコード=Tachikoma；プロジェクトコード=Tachikomaは覚えないでください",
        "二つのことを覚えておいて：プロジェクトコード=Kusanagi；プロジェクトコード=Tachikomaは覚えないでください",
        "プロジェクトコード",
        "プロジェクトコード=Tachikoma",
      ],
      [
        "ko-KR",
        "두 가지를 기억해 주세요: 프로젝트 코드=Tachikoma; 프로젝트 코드=Tachikoma를 기억하지 마세요",
        "두 가지를 기억해 주세요: 프로젝트 코드=Kusanagi; 프로젝트 코드=Tachikoma를 기억하지 마세요",
        "프로젝트 코드",
        "프로젝트 코드=Tachikoma",
      ],
    ] as const;

    for (const [locale, sameTarget, differentTarget, field, optOutTarget] of fixtures) {
      for (const [variant, source, positiveValue] of [
        ["same", sameTarget, "Tachikoma"],
        ["different", differentTarget, "Kusanagi"],
      ] as const) {
        const result = await extractor.extract({
          locale,
          messages: [{ role: "user", content: source }],
          scope: {
            sessionId: `opt-out-target-${variant}-${locale}`,
            userId: `opt-out-target-${variant}-${locale}`,
          },
        });
        const dont = result.candidates.find(({ kindHint, metadata }) =>
          kindHint === "feedback" && metadata?.feedbackKind === "dont"
        );

        expect(result.candidates.filter(({ kindHint }) => kindHint === "fact").map(({ content }) => content)).toContain(
          `${field}=${positiveValue}`,
        );
        expect(dont?.metadata).toEqual(expect.objectContaining({ optOutTarget }));
        expect(dont?.content).toContain(optOutTarget);
      }
    }
  });

  it("keeps polite standalone opt-outs out of fact and reference lanes", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Please do not remember that use docs/secret.md as the source of truth"],
      ["zh-CN", "请不要记录以后以 docs/secret.md 为准"],
      ["fr-FR", "S’il vous plaît, ne mémorisez pas docs/secret.md comme source de vérité"],
      ["es-ES", "Por favor, no recuerdes docs/secret.md como fuente de verdad"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `standalone-opt-out-${locale}`, userId: `standalone-opt-out-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) =>
        kindHint === "fact" || kindHint === "reference"
      )).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          kindHint: "feedback",
          metadata: expect.objectContaining({ feedbackKind: "dont" }),
        }),
      ]);
    }
  });

  it("does not let an empty directive borrow the following ordinary clause", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that.\n\ntheme=dark"],
      ["zh-CN", "请记住。\n\n主题=dark"],
      ["fr-FR", "Souviens-toi.\n\nthème=dark"],
      ["es-ES", "Recuerda.\n\ntema=dark"],
      ["ja-JP", "覚えておいて。\n\nテーマ=dark"],
      ["ko-KR", "기억해 주세요.\n\n테마=dark"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `empty-boundary-${locale}`, userId: `empty-boundary-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("continues only an explicitly counted unfinished list", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things:\n\neditor=Neovim;\n\nshell=zsh",
      }],
      scope: { sessionId: "counted-continuation", userId: "counted-continuation" },
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content }) => content),
    ).toEqual(["editor=Neovim", "shell=zsh"]);
  });

  it("consumes the full counted payload before rejecting an invalid first item", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember two things: what is my project code\n\nMy current goal is ship release."],
      ["zh-CN", "请记住两件事：我的项目代号是什么\n\n我正在做Tachikoma"],
      ["fr-FR", "Souviens-toi de deux choses : quel est mon code projet\n\nmon objectif actuel est publier"],
      ["es-ES", "Recuerda dos cosas: cuál es mi código de proyecto\n\nmi objetivo actual es publicar"],
      ["ja-JP", "二つのことを覚えておいて：プロジェクトコードは何ですか\n\n私の現在の目標はリリースです"],
      ["ko-KR", "두 가지를 기억해 주세요: 프로젝트 코드는 무엇인가요\n\n제 현재 목표는 출시입니다"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `invalid-first-newline-${locale}`, userId: `invalid-first-newline-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("distinguishes assignment literal questions from assignment confirmation questions", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      [
        "en-US",
        "Remember that FAQ title=Why does it fail?",
        "Remember that is project code=Tachikoma correct?",
      ],
      [
        "zh-CN",
        "请记住FAQ标题=为什么失败？",
        "请记住项目代号=Tachikoma正确吗？",
      ],
      [
        "fr-FR",
        "Souviens-toi : titre FAQ=Pourquoi cela échoue ?",
        "Souviens-toi : code projet=Tachikoma est correct ?",
      ],
      [
        "es-ES",
        "Recuerda: título FAQ=¿Por qué falla?",
        "Recuerda: código de proyecto=Tachikoma es correcto?",
      ],
      [
        "ja-JP",
        "覚えておいて：FAQタイトル=なぜ失敗するのか？",
        "覚えておいて：プロジェクトコード=Tachikomaで正しいですか？",
      ],
      [
        "ko-KR",
        "기억해 주세요: FAQ 제목=왜 실패하나요?",
        "기억해 주세요: 프로젝트 코드=Tachikoma가 맞나요?",
      ],
    ] as const;

    for (const [locale, literal, confirmation] of fixtures) {
      const literalResult = await extractor.extract({
        locale,
        messages: [{ role: "user", content: literal }],
        scope: { sessionId: `literal-question-${locale}`, userId: `literal-question-${locale}` },
      });
      const confirmationResult = await extractor.extract({
        locale,
        messages: [{ role: "user", content: confirmation }],
        scope: { sessionId: `confirm-question-${locale}`, userId: `confirm-question-${locale}` },
      });

      expect(literalResult.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(true);
      expect(confirmationResult.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("keeps natural Japanese and Korean question forms as assignment values", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["ja-JP", "覚えておいて：FAQタイトル=なぜ失敗する？"],
      ["ko-KR", "기억해 주세요: FAQ 제목=왜 실패해?"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: {
          sessionId: `natural-literal-question-${locale}`,
          userId: `natural-literal-question-${locale}`,
        },
      });

      expect(result.candidates).toEqual([
        expect.objectContaining({
          kindHint: "fact",
          content: expect.stringContaining("FAQ"),
        }),
      ]);
    }
  });

  it("keeps natural-order questions as structured assignment values", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that FAQ title=It fails for what reason?"],
      ["zh-CN", "请记住FAQ标题=失败原因是什么？"],
      ["fr-FR", "Souviens-toi : titre FAQ=Cela échoue pourquoi ?"],
      ["es-ES", "Recuerda: título FAQ=Falla por qué?"],
      ["ja-JP", "覚えておいて：FAQタイトル=失敗するのはなぜ？"],
      ["ja-JP", "覚えておいて：FAQタイトル=失敗した理由は何？"],
      ["ko-KR", "기억해 주세요: FAQ 제목=실패하는 이유가 뭐야?"],
      ["ko-KR", "기억해 주세요: FAQ 제목=어째서 실패해?"],
      ["en-US", "Remember that survey prompt=It fails for what reason?"],
      ["zh-CN", "请记住错误消息=失败原因是什么？"],
      ["fr-FR", "Souviens-toi : invite enquête=Cela échoue pourquoi ?"],
      ["es-ES", "Recuerda: pregunta de encuesta=Falla por qué?"],
      ["ja-JP", "覚えておいて：アンケート質問=失敗するのはなぜ？"],
      ["ko-KR", "기억해 주세요: 설문 질문=실패하는 이유가 뭐야?"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: {
          sessionId: `natural-order-question-${locale}`,
          userId: `natural-order-question-${locale}`,
        },
      });

      expect(result.candidates).toEqual([
        expect.objectContaining({ kindHint: "fact" }),
      ]);
    }
  });

  it("rejects bare interrogative assignment values", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that project code=what?"],
      ["zh-CN", "请记住项目代号=什么？"],
      ["fr-FR", "Souviens-toi : code projet=quoi ?"],
      ["es-ES", "Recuerda: código de proyecto=qué?"],
      ["ja-JP", "覚えておいて：プロジェクトコード=何？"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=뭐야?"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: {
          sessionId: `interrogative-assignment-${locale}`,
          userId: `interrogative-assignment-${locale}`,
        },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("rejects postposed assignment questions and unpunctuated wh questions", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that project code=Tachikoma, why?", "Remember that my project code is what"],
      ["zh-CN", "请记住项目代号=Tachikoma，为什么？", "请记住我的项目代号是什么"],
      ["fr-FR", "Souviens-toi : code projet=Tachikoma, pourquoi ?", "Souviens-toi : mon code projet est quoi"],
      ["es-ES", "Recuerda: código de proyecto=Tachikoma, por qué?", "Recuerda: mi código de proyecto es qué"],
      ["ja-JP", "覚えておいて：プロジェクトコード=Tachikoma、なぜ？", "覚えておいて：私のプロジェクトコードは何"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=Tachikoma, 왜?", "기억해 주세요: 내 프로젝트 코드는 뭐"],
    ] as const;

    for (const [locale, postposed, unpunctuated] of fixtures) {
      for (const source of [postposed, unpunctuated]) {
        const result = await extractor.extract({
          locale,
          messages: [{ role: "user", content: source }],
          scope: { sessionId: `postposed-question-${locale}`, userId: `postposed-question-${locale}` },
        });

        expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
      }
    }
  });

  it("rejects punctuation-only assignment confirmation questions in every pack", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that project code=Tachikoma?"],
      ["zh-CN", "请记住项目代号=Tachikoma？"],
      ["fr-FR", "Souviens-toi : code projet=Tachikoma ?"],
      ["es-ES", "Recuerda: código de proyecto=Tachikoma?"],
      ["ja-JP", "覚えておいて：プロジェクトコード=Tachikoma？"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=Tachikoma?"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: {
          sessionId: `punctuation-confirmation-${locale}`,
          userId: `punctuation-confirmation-${locale}`,
        },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("rejects unpunctuated Chinese assignment confirmation questions", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "zh-CN",
      messages: [{
        role: "user",
        content: "请记住两件事：编辑器=Neovim；项目代号=Tachikoma是否正确",
      }],
      scope: {
        sessionId: "chinese-unpunctuated-confirmation",
        userId: "chinese-unpunctuated-confirmation",
      },
    });

    expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
  });

  it("rejects Chinese A-not-A confirmations without rejecting literal values", async () => {
    const extractor = createDeterministicMemoryExtractor();

    for (const value of ["Tachikoma对不对", "Tachikoma正确不正确", "Tachikoma能不能用", "Tachikoma可不可以用", "Tachikoma可不可用"]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        messages: [{ role: "user", content: `请记住项目代号=${value}` }],
        scope: { sessionId: `a-not-a-${value}`, userId: `a-not-a-${value}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }

    for (const value of ["正确", "能用", "可用"]) {
      const result = await extractor.extract({
        locale: "zh-CN",
        messages: [{ role: "user", content: `请记住状态=${value}` }],
        scope: { sessionId: `literal-state-${value}`, userId: `literal-state-${value}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(true);
    }
  });

  it("treats French n'oublie pas as a positive remember directive", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "fr-FR",
      messages: [{ role: "user", content: "N’oublie pas : code projet=Tachikoma" }],
      scope: { sessionId: "fr-dont-forget", userId: "fr-dont-forget" },
    });

    expect(result.candidates.map(({ content, kindHint }) => ({ content, kindHint }))).toEqual([
      { content: "code projet=Tachikoma", kindHint: "fact" },
    ]);
  });

  it("keeps non-interrogative confirmation words as literal assignment values", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["en-US", "Remember that status=correct"],
      ["zh-CN", "请记住状态=正确"],
      ["fr-FR", "Souviens-toi : statut=correct"],
      ["es-ES", "Recuerda: estado=correcto"],
      ["ja-JP", "覚えておいて：状態=正しい"],
      ["ko-KR", "기억해 주세요: 상태=맞음"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `literal-confirmation-${locale}`, userId: `literal-confirmation-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(true);
    }
  });

  it("reads Romance list counts only from the directive header", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["fr-FR", "Souviens-toi : note=deux choses restent", "note=deux choses restent"],
      ["es-ES", "Recuerda: nota=dos cosas pendientes", "nota=dos cosas pendientes"],
    ] as const;

    for (const [locale, source, expected] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `header-count-${locale}`, userId: `header-count-${locale}` },
      });

      expect(
        result.candidates
          .filter(({ kindHint }) => kindHint === "fact")
          .map(({ content }) => content),
      ).toEqual([expected]);
    }
  });

  it("recognizes a contracted French singular counted-list header", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "fr-FR",
      messages: [{ role: "user", content: "Souviens-toi d’une chose : éditeur=Neovim" }],
      scope: { sessionId: "french-contracted-count", userId: "french-contracted-count" },
    });

    expect(result.candidates.filter(({ kindHint }) => kindHint === "fact").map(({ content }) => content)).toEqual([
      "éditeur=Neovim",
    ]);
  });

  it("fails closed on unsupported CJK word-form counts", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const fixtures = [
      ["zh-CN", "请记住十一件事：编辑器=Neovim"],
      ["ja-JP", "十一つのことを覚えておいて：エディタ=Neovim"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const result = await extractor.extract({
        locale,
        messages: [{ role: "user", content: source }],
        scope: { sessionId: `unsupported-count-${locale}`, userId: `unsupported-count-${locale}` },
      });

      expect(result.candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("does not split English abbreviations while finding lowercase assignment items", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things: example=e.g. use Neovim. shell=zsh",
      }],
      scope: { sessionId: "english-abbreviation", userId: "english-abbreviation" },
    });

    expect(
      result.candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ content }) => content),
    ).toEqual(["example=e.g. use Neovim", "shell=zsh"]);
  });

  it("does not treat an assignment after e.g. as the next counted item", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things: example=e.g. shell=zsh; editor=Neovim",
      }],
      scope: { sessionId: "english-abbreviation-assignment", userId: "english-abbreviation-assignment" },
    });

    expect(result.candidates.filter(({ kindHint }) => kindHint === "fact").map(({ content }) => content)).toEqual([
      "example=e.g. shell=zsh",
      "editor=Neovim",
    ]);
  });

  it("keeps an explicit Spanish negative assertion out of the feedback lane", async () => {
    const extractor = createDeterministicMemoryExtractor();
    for (const content of ["Recuerda: no hay bloqueos", "no hay bloqueos"]) {
      const result = await extractor.extract({
        locale: "es-ES",
        messages: [{ role: "user", content }],
        scope: { sessionId: "spanish-negative-fact", userId: "spanish-negative-fact" },
      });

      expect(result.candidates.map(({ content, kindHint }) => ({ content, kindHint }))).toEqual([
        { content: "no hay bloqueos", kindHint: "fact" },
      ]);
    }
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
