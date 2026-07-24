import { describe, expect, it } from "bun:test";
import {
  buildAnswerEvidencePack,
  extractFinalAnswer,
  inferAnswerOperation,
} from "../../src/eval/protocol-reader/evidencePack";

describe("answer evidence pack", () => {
  it("infers the answer operation from question phrasing only", () => {
    expect(inferAnswerOperation("How many cards do I have in total?")).toBe(
      "count",
    );
    expect(inferAnswerOperation("What did I do before launch?")).toBe("order");
    expect(
      inferAnswerOperation("What is my current database after the update?"),
    ).toBe("conflict_update");
    expect(
      inferAnswerOperation(
        "Which new yoga pose did Deborah share a photo of?",
      ),
    ).toBe("general");
    expect(inferAnswerOperation("What is my newest database?")).toBe(
      "conflict_update",
    );
    expect(inferAnswerOperation("What is the dog's name?")).toBe("general");
  });

  it("uses optional question type metadata without expected-answer rules", () => {
    expect(
      inferAnswerOperation(
        "How many weeks did it take after planning?",
        "temporal_reasoning",
      ),
    ).toBe("count");
    expect(
      inferAnswerOperation(
        "How long did it take to reach the goal?",
        "temporal_reasoning",
      ),
    ).toBe("count");
    expect(
      inferAnswerOperation("Which topics did I mention?", "event_ordering"),
    ).toBe("order");
    expect(
      inferAnswerOperation("Did I do this?", "contradiction_resolution"),
    ).toBe("contradiction");
    expect(inferAnswerOperation("Did I do this?", "CR")).toBe(
      "conflict_update",
    );
    expect(inferAnswerOperation("What changed?", "knowledge_update")).toBe(
      "conflict_update",
    );
    expect(inferAnswerOperation("When did it happen?", "temporal")).toBe(
      "order",
    );
    expect(inferAnswerOperation("Summarize the work", "summarization")).toBe(
      "summary",
    );
    expect(
      inferAnswerOperation(
        "How did my publishing plan evolve?",
        "multi_session_reasoning",
      ),
    ).toBe("multi_session");
    expect(
      inferAnswerOperation(
        "What should the answer include?",
        "instruction_following",
      ),
    ).toBe("instruction");
    expect(
      inferAnswerOperation(
        "What tools should I use?",
        "preference_following",
      ),
    ).toBe("preference");
    expect(
      inferAnswerOperation(
        "Which deadlines did I mention for the applications?",
        "numerical_precision",
      ),
    ).toBe("extraction");
    expect(
      inferAnswerOperation(
        "What preparation steps did I plan before the meeting?",
        "Timeline Integration",
      ),
    ).toBe("extraction");
    expect(
      inferAnswerOperation(
        "What details should I include?",
        "information_extraction",
      ),
    ).toBe("extraction");
    expect(
      inferAnswerOperation(
        "How should I address the project risk?",
        "Problem-Solution Context",
      ),
    ).toBe("extraction");
    expect(inferAnswerOperation("What happened?", "abstention")).toBe(
      "abstention",
    );
    expect(inferAnswerOperation("How many modules were listed?", "abstention")).toBe(
      "abstention",
    );
  });

  it("builds a source-ordered, deduplicated, timestamped pack", () => {
    const pack = buildAnswerEvidencePack({
      question: "What is the dog's name?",
      turns: [
        {
          sourceId: 4,
          orderKey: 4,
          content: "later",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "earlier",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "dup",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });
    const earlierIdx = pack.indexOf("#2");
    const laterIdx = pack.indexOf("#4");
    expect(earlierIdx).toBeGreaterThan(-1);
    expect(laterIdx).toBeGreaterThan(earlierIdx);
    expect(pack).toContain("[t=Jan | #2 | user] earlier");
    expect(pack).toContain("[t=Mar | #4 | user] later");
    expect(pack.match(/#2/g)?.length).toBe(1);
    expect(pack).toContain("the latest entry is the current value");
  });

  it("orders evidence by explicit orderKey rather than source identity", () => {
    const pack = buildAnswerEvidencePack({
      question: "What did I mention?",
      turns: [
        {
          sourceId: 2,
          orderKey: 20,
          content: "later by order key",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 99,
          orderKey: 10,
          content: "earlier by order key",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });
    expect(pack.indexOf("#99")).toBeLessThan(pack.indexOf("#2"));
  });

  it("adds count framing only for count questions", () => {
    const count = buildAnswerEvidencePack({
      question: "How many times did I submit?",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "x",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });
    expect(count).toContain("count or total");
    expect(count).toContain("Value-bearing facts for counting:");
    expect(count).toContain("1. [t=Jan | #1 | user] x");
    expect(count).toContain("Count only distinct requested items");
    expect(count).toContain("Show the final count and name the counted items");
    expect(count).toContain("Do not count individual role names as separate security features");
    expect(count).toContain("When the question asks for concerns");
    expect(count).toContain("retry behavior");
    expect(count).toContain("group rapid or consecutive calls");
    const general = buildAnswerEvidencePack({
      question: "What is X?",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "x",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });
    expect(general).not.toContain("count or total");
    expect(general).not.toContain("order or sequence");
  });

  it("adds a date and quantity ledger for temporal count intervals", () => {
    const count = buildAnswerEvidencePack({
      question:
        "How many days passed between when I started my 30-day editing challenge and when I completed the 15-day clarity editing challenge?",
      questionType: "temporal_reasoning",
      turns: [
        {
          sourceId: 88,
          orderKey: 88,
          content:
            "I've entered a 30-day editing challenge starting April 2, and I'm sorta struggling to stay on track.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 218,
          orderKey: 218,
          content:
            "I'm worried about my writing progress after completing that 15-day clarity editing challenge from May 10 to May 25, where I reduced filler words by 20%.",
          role: "user",
          timeAnchor: "May",
        },
      ],
    });

    expect(count).toContain("Date/quantity ledger for counting:");
    expect(count).toContain("#88");
    expect(count).toContain("dates: April 2");
    expect(count).toContain(
      "duration labels (not endpoint dates by themselves): 30-day",
    );
    expect(count).toContain("#218");
    expect(count).toContain("dates: May 10; May 25");
    expect(count).toContain(
      "duration labels (not endpoint dates by themselves): 15-day",
    );
    expect(count).toContain(
      "Use start dates when the question asks between starts; use completion/end dates only when the question names completion/end.",
    );
    expect(count).toContain(
      "Do not use a duration label such as 15-day or two-week as an interval endpoint date.",
    );
    expect(count.indexOf("Date/quantity ledger for counting:")).toBeLessThan(
      count.indexOf("Value-bearing facts for counting:"),
    );
  });

  it("distinguishes duration labels from endpoint dates in count intervals", () => {
    const count = buildAnswerEvidencePack({
      question:
        "How many days do I have between scheduling the meeting and the start of the testing period?",
      questionType: "temporal_reasoning",
      turns: [
        {
          sourceId: 0,
          orderKey: 0,
          content:
            "I'm trying to schedule a meeting for March 15, 2024, at 09:00 CET.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 50,
          orderKey: 50,
          content:
            "The MVP deadline is April 5, 2024, to allow two weeks for testing and deployment.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    expect(count).toContain("dates: March 15, 2024");
    expect(count).toContain("dates: April 5, 2024");
    expect(count).toContain(
      "duration labels (not endpoint dates by themselves): two weeks",
    );
    expect(count).toContain(
      "Choose the two event dates named by the question's endpoint phrases, not unrelated intermediate dates.",
    );
    expect(count).toContain("Calendar interval candidates:");
    expect(count).toContain("March 15, 2024 -> April 5, 2024 = 21 days");
  });

  it("computes calendar interval candidates from source-backed dates", () => {
    const count = buildAnswerEvidencePack({
      question:
        "How many days passed between when I started my 30-day editing challenge and when I started the 15-day clarity editing challenge?",
      questionType: "temporal_reasoning",
      turns: [
        {
          sourceId: 88,
          orderKey: 88,
          content:
            "I started my 30-day editing challenge on April 2, 2024.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 218,
          orderKey: 218,
          content:
            "The 15-day clarity editing challenge ran from May 10, 2024 to May 25, 2024.",
          role: "user",
          timeAnchor: "May",
        },
      ],
    });

    expect(count).toContain("Calendar interval candidates:");
    expect(count).toContain("April 2, 2024 -> May 10, 2024 = 38 days");
    expect(count).toContain("May 10, 2024 -> May 25, 2024 = 15 days");
    expect(count).toContain(
      "Use the interval whose endpoint labels match the question wording",
    );
  });

  it("surfaces numeric quantity candidates for non-date counts", () => {
    const count = buildAnswerEvidencePack({
      question: "How many filming progress quantities did I mention?",
      turns: [
        {
          sourceId: 156,
          orderKey: 156,
          content:
            "The pilot episode is 75% complete by July 5, with 12 of 16 scenes filmed and 60% of post-production started.",
          role: "user",
          timeAnchor: "Jul",
        },
      ],
    });

    expect(count).toContain("other numeric quantities:");
    expect(count).toContain("75% complete");
    expect(count).toContain("12 of 16 scenes");
    expect(count).toContain("60% of post-production");
  });

  it("keeps compound word-number quantities intact in count ledgers", () => {
    const count = buildAnswerEvidencePack({
      question: "How many survey response quantities did I mention?",
      turns: [
        {
          sourceId: 44,
          orderKey: 44,
          content:
            "The first research diary mentioned twenty-one survey responses, thirty two interview notes, and forty-five tagged observations.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    expect(count).toContain(
      "other numeric quantities: twenty-one survey responses; thirty two interview notes; forty-five tagged observations",
    );
    const quantityLine = count
      .split("\n")
      .find((line) => line.includes("other numeric quantities:"));
    const quantityValues = quantityLine?.split("other numeric quantities: ")[1];
    expect(quantityValues?.split("; ")).not.toContain("one survey responses");
    expect(quantityValues?.split("; ")).not.toContain("two interview notes");
    expect(quantityValues?.split("; ")).not.toContain("five tagged observations");
  });

  it("keeps date ranges and currency quantities intact in count ledgers", () => {
    const count = buildAnswerEvidencePack({
      question: "How much event planning detail did I mention?",
      turns: [
        {
          sourceId: 205,
          orderKey: 205,
          content:
            "I planned a May 11-12 movie marathon, set a $2,000 emergency fund, and reserved $300 for warm clothing.",
          role: "user",
          timeAnchor: "May",
        },
      ],
    });

    expect(count).toContain("dates: May 11-12");
    expect(count).toContain("other numeric quantities: $2,000 emergency fund; $300 for warm clothing");
    const quantityLine = count
      .split("\n")
      .find((line) => line.includes("other numeric quantities:"));
    expect(quantityLine).not.toContain("; 000 emergency fund");
    expect(quantityLine).not.toContain("12 movie marathon");
  });

  it("adds order framing for order/sequence questions", () => {
    const order = buildAnswerEvidencePack({
      question:
        "In what order did I build the features? Mention ONLY and ONLY five items.",
      questionType: "event_ordering",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "x",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });
    expect(order).toContain("order or sequence");
    expect(order).toContain("Timeline evidence:");
    expect(order).toContain("1. [t=Jan | #1 | user] x");
    expect(order).toContain("Do not reorder evidence by topical similarity");
    expect(order).toContain("Return exactly 5 numbered items");
    expect(order).toContain("Phrase each item as the aspect or topic");
    expect(order).toContain("Prefer one milestone per source entry");
    expect(order).toContain("split later multi-topic entries before splitting earlier setup");
    expect(order).toContain("Keep paired tasks joined by the same sprint/focus phrase");
    expect(order).toContain("use the concrete implementation/action");
    expect(order).toContain("prefer high-level user-stated aspects");
    expect(order).toContain("deployment/configuration plus testing or performance themes");
  });

  it("adds source-ordered milestone cues for multi-topic order questions", () => {
    const order = buildAnswerEvidencePack({
      question:
        "Can you list the order in which I brought up handling errors and promise rejections in order? Mention ONLY and ONLY five items.",
      questionType: "event_ordering",
      turns: [
        {
          sourceId: 28,
          orderKey: 1,
          content: [
            "I'm trying to handle errors for invalid city names in my weather app, and I want to display user-friendly messages for HTTP 404 and 400 status codes.",
            "I've been using asynchronous fetch calls using `fetch()` with async/await syntax.",
            "```javascript",
            "const data = await response.json();",
            "```",
            "I want to improve this code to handle invalid city names and provide a better user experience.",
          ].join("\n"),
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 162,
          orderKey: 2,
          content:
            "I'm having trouble with the fetchWeatherData function, specifically with the Unhandled Promise Rejection warning that I've been trying to fix by adding try/catch blocks around async calls.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    expect(order).toContain("Milestone cue candidates");
    expect(order).toContain("#28 cues:");
    expect(order).toContain("user-friendly messages for HTTP 404 and 400 status codes");
    expect(order).toContain("asynchronous fetch calls");
    expect(order).toContain("#162 cues:");
    expect(order).toContain("try/catch blocks around async calls");
    expect(order).not.toContain("response.json()");
    expect(order.indexOf("#28 cues")).toBeLessThan(order.indexOf("#162 cues"));
    expect(order.indexOf("Milestone cue candidates")).toBeLessThan(
      order.indexOf("Timeline evidence:"),
    );
  });

  it("adds target-matched order anchors before noisy timeline entries", () => {
    const order = buildAnswerEvidencePack({
      question:
        "Can you list the order in which I brought up handling errors and promise rejections in order? Mention ONLY and ONLY five items.",
      questionType: "event_ordering",
      turns: [
        {
          sourceId: 10,
          orderKey: 0,
          content:
            "I configured Flask 2.3.1 with SQLite 3.39 and improved connection handling for local development.",
          role: "user",
          timeAnchor: "Setup",
        },
        {
          sourceId: 28,
          orderKey: 1,
          content:
            "I want to handle errors for invalid city names in my weather app and display user-friendly messages for HTTP 404 and 400 status codes.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 162,
          orderKey: 2,
          content:
            "I'm trying to fix an Unhandled Promise Rejection warning by adding try/catch blocks around async fetch calls.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    const anchorSection = order.slice(
      order.indexOf("Question-target timeline anchors"),
      order.indexOf("Milestone cue candidates"),
    );
    expect(anchorSection).toContain("#28");
    expect(anchorSection).toContain("#162");
    expect(anchorSection).not.toContain("#10");
    expect(anchorSection).toContain("Use these source-ordered anchors first");
    expect(order).toContain("[t=Setup | #10 | user] I configured Flask");
  });

  it("does not promote generic order words into target timeline anchors", () => {
    const order = buildAnswerEvidencePack({
      question: "In what order did I build the budget tracker features?",
      questionType: "event_ordering",
      turns: [
        {
          sourceId: 71,
          orderKey: 1,
          content: "First I set up user authentication with hashed passwords.",
          role: "user",
          timeAnchor: "2024-03-01",
        },
        {
          sourceId: 72,
          orderKey: 2,
          content: "Then I implemented transaction creation with error handling.",
          role: "user",
          timeAnchor: "2024-03-02",
        },
        {
          sourceId: 73,
          orderKey: 3,
          content: "Last I added the analytics dashboard with monthly charts.",
          role: "user",
          timeAnchor: "2024-03-03",
        },
      ],
    });

    const anchorSection = order.slice(
      order.indexOf("Question-target timeline anchors"),
      order.indexOf("Milestone cue candidates"),
    );
    expect(anchorSection).toContain("(no question-target anchors found");
    expect(anchorSection).not.toContain("target terms: the");
    expect(anchorSection).not.toContain("#73");
  });

  it("preserves formula cues while splitting order milestones", () => {
    const order = buildAnswerEvidencePack({
      question:
        "Can you list the order in which I brought up combinatorial calculations and probability concepts? Mention ONLY and ONLY five items.",
      questionType: "event_ordering",
      turns: [
        {
          sourceId: 28,
          orderKey: 1,
          content:
            "I'm trying to understand permutations and combinations with 3 objects, and I see that 3! equals 6, which represents arranging the objects, and 3C2 equals 3, which represents choosing 2 objects out of 3.",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });

    const cueSection = order.slice(
      order.indexOf("Milestone cue candidates"),
      order.indexOf("Timeline evidence:"),
    );
    expect(cueSection).toContain("3! equals 6");
    expect(cueSection).toContain("3C2 equals 3");
  });

  it("adds current-value framing for update/conflict questions", () => {
    const pack = buildAnswerEvidencePack({
      question: "What is my current database after the update?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I used SQLite first.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I switched the durable store to Postgres.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });
    expect(pack).toContain("Current-value resolution:");
    expect(pack).toContain("Earlier entries are history");
    expect(pack).toContain("latest supported value as current");
  });

  it("adds a current-value ledger for update questions", () => {
    const pack = buildAnswerEvidencePack({
      question: "What date is my immigration consultant session scheduled for now?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I first planned the consultant session for May 20.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I moved the immigration consultant session to May 22.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    expect(pack).toContain("Current-value ledger:");
    expect(pack).toContain(
      "Latest/current candidate: [t=Feb | #2] I moved the immigration consultant session to May 22.",
    );
    expect(pack).toContain(
      "Earlier history superseded by that latest candidate:",
    );
    expect(pack).toContain("1. [t=Jan | #1] I first planned the consultant session for May 20.");
    expect(pack).toContain(
      "Use exact values, dates, amounts, names, and status terms from the latest/current candidate",
    );
  });

  it("highlights updated target values inside the latest current-value candidate", () => {
    const pack = buildAnswerEvidencePack({
      question: "When is my webinar scheduled now?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "The webinar was originally scheduled for March 20.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "The webinar was rescheduled from March 20 to March 27 to accommodate additional guest speakers.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    const valueCueSection = pack.slice(
      pack.indexOf("Priority current-value cues:"),
      pack.indexOf("Earlier history superseded by that latest candidate:"),
    );
    expect(valueCueSection).toContain("updated target values: March 27");
    expect(valueCueSection).toContain("all date/time/quantity mentions");
    expect(valueCueSection).toContain("March 20");
    expect(valueCueSection).toContain("March 27");
    expect(valueCueSection).toContain("Prefer updated target values");
  });

  it("treats as-of dates as context when a current-value deadline is present", () => {
    const pack = buildAnswerEvidencePack({
      question: "By when should I finish the security review?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 108,
          orderKey: 1,
          content:
            "Please finish the security review by April 22 while checking the latest libraries as of April 25.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const valueCueSection = pack.slice(
      pack.indexOf("Priority current-value cues:"),
      pack.indexOf("Earlier history:"),
    );
    expect(valueCueSection).toContain("updated target values: April 22");
    expect(valueCueSection).toContain("as-of/reference values: April 25");
    expect(valueCueSection).toContain(
      "Do not answer with an as-of/reference value unless the question asks for that reference date",
    );
  });

  it("keeps unrelated later noise out of the current-value ledger", () => {
    const pack = buildAnswerEvidencePack({
      question: "What is my current database after the update?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I used SQLite first.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I switched the durable database to Postgres.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 3,
          orderKey: 3,
          content: "I later planned a vacation budget.",
          role: "user",
          timeAnchor: "Mar",
        },
      ],
    });

    const ledgerSection = pack.slice(
      pack.indexOf("Current-value ledger:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    expect(ledgerSection).toContain(
      "Latest/current candidate: [t=Feb | #2] I switched the durable database to Postgres.",
    );
    expect(ledgerSection).not.toContain("vacation budget");
  });

  it("keeps later sibling-entity metrics out of the current-value ledger", () => {
    const pack = buildAnswerEvidencePack({
      question: "What is the current test coverage for the API module?",
      questionType: "knowledge_update",
      turns: [
        {
          sourceId: 31,
          orderKey: 1,
          content: "Test coverage for the API module is 62% today.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 32,
          orderKey: 2,
          content:
            "After the new suite landed, API module coverage rose to 78%.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 33,
          orderKey: 3,
          content: "Core module coverage is a separate 85%.",
          role: "user",
          timeAnchor: "Mar",
        },
      ],
    });

    const ledgerSection = pack.slice(
      pack.indexOf("Current-value ledger:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    expect(ledgerSection).toContain(
      "Latest/current candidate: [t=Feb | #32] After the new suite landed, API module coverage rose to 78%.",
    );
    expect(ledgerSection).not.toContain("Core module coverage");
  });

  it("adds contradiction framing that forbids resolving yes/no conflicts", () => {
    const pack = buildAnswerEvidencePack({
      question: "Have I integrated Flask-Login?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I have never integrated Flask-Login.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I integrated Flask-Login v0.6.2 for session management.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });
    expect(pack).toContain("Contradiction resolution:");
    expect(pack).toContain("Contradiction evidence guide:");
    expect(pack).toContain("Potential denial/no side:");
    expect(pack).toContain("Potential affirmative/done side");
    expect(pack).toContain("Do not answer yes or no first");
    expect(pack).toContain("I notice you've mentioned contradictory information");
    expect(pack).toContain("ask for clarification");
    expect(pack).toContain(
      "A retrieved non-denial assertion about the question target is the affirmative side",
    );
    expect(pack).not.toContain("latest supported value as current");
  });

  it("surfaces a non-whitelist affirmative as the affirmative side of a contradiction", () => {
    // "downloaded" / "manage" are outside the affirmative verb whitelist; the
    // affirmative side must still be surfaced (as a non-denial assertion) so the
    // answer does not collapse to the denial.
    const pack = buildAnswerEvidencePack({
      question: "Have I started using Zotero?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I downloaded Zotero to manage my citations.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I have never used any citation management software.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });
    const affirmativeSection = pack.slice(pack.indexOf("affirmative/done side"));
    expect(pack.indexOf("Affirmative/done side:")).toBeLessThan(
      pack.indexOf("Denial/no side:"),
    );
    expect(affirmativeSection).toContain("downloaded Zotero");
    expect(affirmativeSection).not.toContain("(not directly detected");
    expect(pack).toContain("lead with the affirmative claim");
    expect(pack).toContain("Required contradiction answer components");
    expect(pack).toContain(
      "A one-sided denial-only or affirmative-only answer is incomplete",
    );
    expect(pack).toContain(
      "reports only the denial side, only the affirmative side, or No answer is incomplete",
    );
  });

  it("keeps contradiction evidence focused on the minimal target pair", () => {
    const pack = buildAnswerEvidencePack({
      question: "Have I written Flask routes or handled HTTP requests?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 24,
          orderKey: 1,
          content:
            "I have never written any Flask routes or handled HTTP requests in this project.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 58,
          orderKey: 2,
          content:
            "I implemented a basic homepage route with Flask for the project.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 62,
          orderKey: 3,
          content:
            "I later tested POST /transactions with a 201 status and improved CRUD error handling.",
          role: "user",
          timeAnchor: "Mar",
        },
      ],
    });

    const guide = pack.slice(
      pack.indexOf("Contradiction evidence guide:"),
      pack.indexOf("Use the contradiction evidence guide above"),
    );
    expect(guide).toContain("Minimal contradiction pair");
    expect(guide).toContain("never written any Flask routes");
    expect(guide).toContain("homepage route with Flask");
    expect(guide).toContain("ignore adjacent implementation details");
    expect(guide).not.toContain("POST /transactions");
    expect(guide).not.toContain("CRUD error handling");
  });

  it("prefers concise explicit contradiction turns over a noisy mega-turn", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "Have I worked with Flask routes and handled HTTP requests in this project?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 24,
          orderKey: 24,
          content: "I implemented a basic homepage route with Flask.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 58,
          orderKey: 58,
          content:
            "I've never written any Flask routes or handled HTTP requests in this project.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 66,
          orderKey: 66,
          content: [
            "I'm trying to integrate Flask-Login for session management.",
            "Flask routes and HTTP requests are discussed throughout this long implementation note. ".repeat(30),
            "I've never written any Flask routes or handled HTTP requests before, but I've implemented transaction CRUD with RESTful routes and POST requests.",
          ].join(" "),
          role: "user",
          timeAnchor: "Mar",
        },
      ],
    });

    const guide = pack.slice(
      pack.indexOf("Contradiction evidence guide:"),
      pack.indexOf("Use the contradiction evidence guide above"),
    );
    expect(guide).toContain("[#24]");
    expect(guide).toContain("[#58]");
    expect(guide).not.toContain("[#66]");
  });

  it("prefers an explicit completed route over adjacent framework setup", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "Have I worked with Flask routes and handled HTTP requests in this project?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 22,
          orderKey: 22,
          content: [
            "I'm trying to review Flask routing, request handling, and session management tutorials, and I'm having trouble understanding user sessions in my Flask app.",
            "I've set up my project with Flask 2.3.1, and I'm using Jinja2 templating and Bootstrap 5.3 for the UI.",
          ].join(" "),
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 24,
          orderKey: 24,
          content:
            "I'm trying to implement the basic homepage route with Flask, and I've managed to return static HTML, but I'm not sure how to optimize it for better response times.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 58,
          orderKey: 58,
          content:
            "I've never written any Flask routes or handled HTTP requests in this project.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    const guide = pack.slice(
      pack.indexOf("Contradiction evidence guide:"),
      pack.indexOf("Use the contradiction evidence guide above"),
    );
    expect(guide).toContain("[#24]");
    expect(guide).toContain("[#58]");
    expect(guide).not.toContain("[#22]");
  });

  it("treats did-not clauses as the denial side of a same-turn contradiction", () => {
    const pack = buildAnswerEvidencePack({
      question: "Did I attend the patent webinar?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content:
            "I did not attend the patent webinar at first, but I later attended the USPTO patent webinar and took notes.",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });

    const guide = pack.slice(
      pack.indexOf("Contradiction evidence guide:"),
      pack.indexOf("Use the contradiction evidence guide above"),
    );
    expect(guide).toContain("did not attend the patent webinar");
    expect(guide).toContain("later attended the USPTO patent webinar");
    expect(guide).not.toContain("(not directly detected");
  });

  it("keeps weak affirmative contradiction actions from being upgraded to completion", () => {
    const pack = buildAnswerEvidencePack({
      question: "Have I attended any patent-related webinars or workshops?",
      questionType: "contradiction_resolution",
      turns: [
        {
          sourceId: 91,
          orderKey: 1,
          content:
            "I registered for a patent law webinar on April 5, 2024, so I can learn about filing steps.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 92,
          orderKey: 2,
          content:
            "I have never attended any patent-related webinars or workshops.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const guide = pack.slice(
      pack.indexOf("Contradiction evidence guide:"),
      pack.indexOf("Use the contradiction evidence guide above"),
    );
    expect(guide).toContain("registered for a patent law webinar");
    expect(guide).toContain(
      "Preserve weak affirmative wording such as recommended, registered, planned, invited, scheduled, or goal",
    );
    expect(guide).toContain(
      "do not upgrade registration to attendance, a recommendation to reading/use, or a goal to completion",
    );
  });

  it("adds multi-session facet framing for cross-session reasoning", () => {
    const pack = buildAnswerEvidencePack({
      question: "How did my publishing plan evolve?",
      questionType: "multi_session_reasoning",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I started with an outline and a B- target.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "I later focused on journal feedback and revisions.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });
    expect(pack).toContain("Multi-session reasoning:");
    expect(pack).toContain("Cross-session facets:");
    expect(pack).toContain("Synthesize across all listed facets");
    expect(pack).toContain("Do not answer from only the latest entry");
  });

  it("adds abstention calibration for adjacent but insufficient evidence", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "Could you provide details about the onboarding modules I need to complete?",
      questionType: "abstention",
      turns: [
        {
          sourceId: 268,
          orderKey: 268,
          content:
            "I need to finish all onboarding modules by April 25, and I've set a schedule to meet this deadline.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    expect(pack).toContain("Abstention calibration:");
    expect(pack).toContain("Answer that the provided chat does not contain the requested detail");
    expect(pack).toContain("Adjacent facts are insufficient");
    expect(pack).toContain("deadline or status is not module details");
    expect(pack).toContain("Evidence for absence check:");
    expect(pack).not.toContain("the latest entry is the current value");
  });

  it("warns that event attendance or success is not enough for atmosphere abstention questions", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "What was the atmosphere like during the February 20 book club discussion?",
      questionType: "abstention",
      turns: [
        {
          sourceId: 222,
          orderKey: 222,
          content:
            "I hosted a book club discussion on The Poppy War with Kelly on February 20, and we had 12 attendees and it was a great success.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    expect(pack).toContain("attendance or success is not atmosphere");
    expect(pack).toContain("Only answer with a substantive value when a source states the requested attribute");
  });

  it("adds preference constraints for preference-following questions", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "I'm adding login, income tracking, and basic analytics to my Flask app. What libraries or tools should I use?",
      questionType: "preference_following",
      turns: [
        {
          sourceId: 34,
          orderKey: 34,
          content:
            "I prefer lightweight libraries with minimal dependencies and want to avoid unnecessary complexity.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 108,
          orderKey: 108,
          content:
            "A complex option would add a distributed task queue, dashboards, Elasticsearch, and several monitoring agents.",
          role: "assistant",
          timeAnchor: "Feb",
        },
      ],
    });

    expect(pack).toContain("Preference-following:");
    expect(pack).toContain("Preference constraints:");
    expect(pack).toContain("lightweight libraries");
    expect(pack).toContain("minimal dependencies");
    expect(pack).toContain("avoid unnecessary complexity");
    expect(pack).toContain("Preference response requirements:");
    expect(pack).toContain("recommend lightweight/minimal-dependency options");
    expect(pack).toContain("avoid unnecessary complexity");
    expect(pack).toContain("Supporting evidence for the requested answer:");
    expect(pack).toContain("Flask app");
    expect(pack).toContain(
      "Do not let noisy adjacent tool suggestions override the user's stated preference",
    );
    expect(pack).not.toContain("the latest entry is the current value");
  });

  it("keeps preference support topic-matched instead of dumping noisy turns", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "How can I track the status and results of each step in my deployment workflow?",
      questionType: "preference_following",
      turns: [
        {
          sourceId: 182,
          orderKey: 182,
          content:
            "I prefer automated deployments over manual ones, and I want to reduce human error in my CI/CD pipeline.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 184,
          orderKey: 184,
          content:
            "How do I monitor the progress of each job in the GitHub Actions workflow?",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 20,
          orderKey: 20,
          content:
            "I made a grocery list for the weekend and need to buy coffee.",
          role: "user",
          timeAnchor: "Jan",
        },
      ],
    });

    const support = pack.slice(
      pack.indexOf("Supporting evidence for the requested answer:"),
    );
    expect(support).toContain("GitHub Actions workflow");
    expect(support).toContain("automated deployments");
    expect(support).not.toContain("grocery list");
  });

  it("turns direct-link preferences into explicit response requirements", () => {
    const pack = buildAnswerEvidencePack({
      question: "How should I include my portfolio links in the cover letter?",
      questionType: "preference_following",
      turns: [
        {
          sourceId: 41,
          orderKey: 41,
          content:
            "I prefer portfolio links directly in the cover letter text instead of separate attachments.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const requirementSection = pack.slice(
      pack.indexOf("Preference response requirements:"),
      pack.indexOf("Supporting evidence for the requested answer:"),
    );
    expect(requirementSection).toContain("embed links directly in the response");
    expect(requirementSection).toContain("avoid separate attachments");
  });

  it("adds coverage cues for source-backed information extraction", () => {
    const pack = buildAnswerEvidencePack({
      question: "What preparation steps did I plan before the mentor meeting?",
      questionType: "Timeline Integration",
      turns: [
        {
          sourceId: 14,
          orderKey: 14,
          content:
            "I planned to research Robert's academic background, prepare questions about my documentary script, and bring my draft script to the library.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 15,
          orderKey: 15,
          content:
            "Before the meeting, I should arrive early at the library, dress professionally, engage politely and enthusiastically, take detailed notes, and send a thank-you note afterward.",
          role: "assistant",
          timeAnchor: "Mar",
        },
      ],
    });

    expect(pack).toContain("Information extraction coverage:");
    expect(pack).toContain("cover each source-backed detail");
    expect(pack).toContain("research Robert's academic background");
    expect(pack).toContain("arrive early at the library");
    expect(pack).toContain("dress professionally");
    expect(pack).toContain("take detailed notes");
    expect(pack).toContain(
      "Do not add names, labels, or personal identifiers unless the question asks for them",
    );
  });

  it("surfaces dates and named obligations for numerical extraction", () => {
    const pack = buildAnswerEvidencePack({
      question: "Which deadlines did I mention for the applications?",
      questionType: "numerical_precision",
      turns: [
        {
          sourceId: 12,
          orderKey: 12,
          content:
            "The university application is due April 30, 2024, the scholarship deadline is May 15, 2024, and the visa application is due June 1, 2024.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    expect(pack).toContain("Information extraction coverage:");
    expect(pack).toContain(
      "dates: April 30, 2024; May 15, 2024; June 1, 2024",
    );
    expect(pack).toContain("university application");
    expect(pack).toContain("scholarship deadline");
    expect(pack).toContain("visa application");
    expect(pack).toContain("Do not answer No answer for a requested field");
  });

  it("adds a source-ordered summary coverage checklist", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "Can you give me a comprehensive summary of how my plans for studying abroad developed over time?",
      questionType: "summarization",
      turns: [
        {
          sourceId: 8,
          orderKey: 8,
          content:
            "I'm trying to finish my personal statement by April 20, 2024, and I want to explain how Tanya has supported my producer career goals.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 77,
          orderKey: 77,
          content:
            "I accepted a part-time role starting June 1 while studying, and now I'm weighing a Canadian study visa against staying in Montserrat.",
          role: "user",
          timeAnchor: "Jun",
        },
      ],
    });

    expect(pack).toContain("Summary coverage checklist:");
    expect(pack).toContain("#8 user themes:");
    expect(pack).toContain("personal statement by April 20, 2024");
    expect(pack).toContain("Tanya has supported my producer career goals");
    expect(pack).toContain("dates: April 20, 2024");
    expect(pack).toContain("#77 user themes:");
    expect(pack).toContain("part-time role starting June 1");
    expect(pack).toContain("Canadian study visa");
    expect(pack.indexOf("Summary coverage checklist:")).toBeLessThan(
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
  });

  it("compresses assistant guidance for summaries without using generic openings as checklist themes", () => {
    const pack = buildAnswerEvidencePack({
      question: "Can you summarize my visa interview preparation?",
      questionType: "summarization",
      turns: [
        {
          sourceId: 131,
          orderKey: 131,
          content:
            "Can you help me prepare for my Canadian visa interview on May 10?",
          role: "user",
          timeAnchor: "May",
        },
        {
          sourceId: 132,
          orderKey: 132,
          content: [
            "Absolutely, I'd be happy to help you prepare for the interview.",
            "",
            "### Preparation Steps",
            "1. Gather required documents and funding evidence.",
            "2. Practice answers about the institution and study plan.",
            "3. Prepare to explain ties to Montserrat.",
          ].join("\n"),
          role: "assistant",
          timeAnchor: "May",
        },
      ],
    });

    const checklist = pack.slice(
      pack.indexOf("Summary coverage checklist:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    expect(checklist).toContain("#131 user themes:");
    expect(checklist).toContain("Canadian visa interview on May 10");
    expect(checklist).toContain("#132 assistant guidance:");
    expect(checklist).toContain("Preparation Steps");
    expect(checklist).toContain("Gather required documents");
    expect(checklist).toContain("Practice answers");
    expect(checklist).not.toContain("Absolutely, I'd be happy");
  });

  it("adds a required source coverage audit for summaries with late topic shifts", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "Can you summarize how my professional and personal planning evolved?",
      questionType: "summarization",
      turns: [
        {
          sourceId: 58,
          orderKey: 58,
          content:
            "I declined a meeting with Stephen so I could focus on a startup offer.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 110,
          orderKey: 110,
          content:
            "I agreed to limit work trips to three per quarter to respect relationship boundaries.",
          role: "user",
          timeAnchor: "Jun",
        },
        {
          sourceId: 258,
          orderKey: 258,
          content:
            "My belief in free will affects my motivation, and I want to track decisions through daily journaling.",
          role: "user",
          timeAnchor: "Sep",
        },
      ],
    });

    const checklist = pack.slice(
      pack.indexOf("Summary coverage checklist:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    expect(checklist).toContain(
      "Required source coverage: cover every listed source id",
    );
    expect(checklist).toContain("#58, #110, #258");
    expect(checklist).toContain("Do not stop after the first coherent narrative arc");
    expect(checklist).toContain("late-stage themes");
    expect(checklist).toContain("free will affects my motivation");
    expect(checklist).toContain("daily journaling");
  });

  it("adds value-bearing summary anchors that can appear after the normal cue cap", () => {
    const pack = buildAnswerEvidencePack({
      question: "Can you summarize how my study-abroad finances evolved?",
      questionType: "summarization",
      turns: [
        {
          sourceId: 205,
          orderKey: 205,
          content: [
            "I finalized the personal statement structure.",
            "I reviewed Tanya's support and interview practice.",
            "I compared staying in Montserrat with applying for Canada.",
            "I prepared visa interview documents and practice answers.",
            "Later I integrated a freelance contract into my budget and balanced income against expenses and savings for my first months abroad.",
          ].join(" "),
          role: "user",
          timeAnchor: "Aug",
        },
      ],
    });

    const checklist = pack.slice(
      pack.indexOf("Summary coverage checklist:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    const firstTurnChecklist = checklist.slice(checklist.indexOf("#205 user themes:"));
    expect(firstTurnChecklist).not.toContain("freelance contract");
    expect(checklist).toContain("Value-bearing summary anchors:");
    expect(checklist).toContain("freelance contract");
    expect(checklist).toContain("income against expenses and savings");
  });

  it("adds legal and meeting value anchors from assistant guidance", () => {
    const pack = buildAnswerEvidencePack({
      question: "Can you summarize how my estate planning evolved?",
      questionType: "summarization",
      turns: [
        {
          sourceId: 179,
          orderKey: 179,
          content: [
            "Sure, here is a balanced way to handle the executor question.",
            "Start by explaining why Douglas is a strong fit.",
            "You can mention Kevin's legal background as a possible co-executor option.",
            "Then organize a family meeting to discuss executor roles openly and reach consensus.",
            "After that, define Douglas's executor duties, provide resources, and set conflict-resolution mechanisms.",
          ].join(" "),
          role: "assistant",
          timeAnchor: "Apr",
        },
      ],
    });

    const checklist = pack.slice(
      pack.indexOf("Summary coverage checklist:"),
      pack.indexOf("Evidence (source-ordered, earliest first):"),
    );
    expect(checklist).toContain("family meeting");
    expect(checklist).toContain("executor duties");
    expect(checklist).toContain("conflict-resolution mechanisms");
  });

  it("adds standing/latest constraint framing for instruction questions", () => {
    const pack = buildAnswerEvidencePack({
      question: "What should the answer include?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "Always include library names and versions.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "Also explain why each library is used.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });
    expect(pack).toContain("Instruction-following constraints:");
    expect(pack).toContain("standing instruction");
    expect(pack).toContain("latest companion");
    expect(pack).toContain("Ignore retrieved turns that do not constrain the requested response");
    expect(pack).toContain("Apply these constraints to the answer");
    expect(pack).toContain("answer the underlying request");
    expect(pack).toContain("If the user asks what the response should include");
  });

  it("keeps instruction constraints separate from topic-matched supporting evidence", () => {
    const pack = buildAnswerEvidencePack({
      question: "Which libraries are used in this project?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I want to deploy the project on Friday.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "I use Flask-Login 0.6.2, Flask 2.3.1, and SQLite 3.39 as project dependencies.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 3,
          orderKey: 3,
          content: "Always include version numbers when I ask about libraries.",
          role: "user",
          timeAnchor: "Mar",
        },
      ],
    });

    expect(pack).toContain("Instruction constraints:");
    expect(pack).toContain("[t=Mar | #3 | user] Always include version numbers");
    expect(pack).toContain("Supporting evidence for the requested answer:");
    expect(pack).toContain("Flask-Login 0.6.2");
    expect(pack).toContain("Flask 2.3.1");
    expect(pack).toContain("SQLite 3.39");
    expect(pack).not.toContain("deploy the project on Friday");
  });

  it("adds concrete answer-content cues for instruction questions", () => {
    const pack = buildAnswerEvidencePack({
      question: "Which libraries and versions should the response include?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "Always include the library names and versions.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "The project uses Flask-Login 0.6.2, Flask 2.3.1, and SQLite 3.39.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("Do not only restate the instruction");
    expect(cueSection).toContain("Flask-Login 0.6.2");
    expect(cueSection).toContain("Flask 2.3.1");
    expect(cueSection).toContain("SQLite 3.39");
  });

  it("aggregates versioned dependencies beyond the rendered support-turn budget", () => {
    const pack = buildAnswerEvidencePack({
      question: "Which libraries are used in this project?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "Always include version numbers when I ask about libraries.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "Flask 2.3.1 is a project dependency.",
          role: "user",
          timeAnchor: "Feb",
        },
        {
          sourceId: 3,
          orderKey: 3,
          content: "SQLite 3.39 is another project dependency.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 4,
          orderKey: 4,
          content: "Chart.js 4.3.0 renders the project charts.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 5,
          orderKey: 5,
          content: "SQLAlchemy 2.0.19 is used for persistence.",
          role: "user",
          timeAnchor: "May",
        },
        {
          sourceId: 6,
          orderKey: 6,
          content: "The project release v1.0.0 is now tagged.",
          role: "user",
          timeAnchor: "Jun",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("Chart.js 4.3.0");
    expect(cueSection).toContain("SQLAlchemy 2.0.19");
    expect(cueSection).not.toContain("release v1.0.0");
  });

  it("surfaces named tools as concrete instruction answer content", () => {
    const pack = buildAnswerEvidencePack({
      question: "What should the response include when suggesting writing aids?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 100,
          orderKey: 100,
          content:
            "Always include the tool names when discussing writing aids or software: Microsoft Word, Grammarly, Hemingway Editor, Google Calendar, Trello, Evernote, and Mendeley.",
          role: "user",
          timeAnchor: "May",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("named tools/examples");
    expect(cueSection).toContain("Microsoft Word");
    expect(cueSection).toContain("Grammarly");
    expect(cueSection).toContain("Hemingway Editor");
    expect(cueSection).toContain("Mendeley");
  });

  it("does not treat companion instruction openers as named tools", () => {
    const pack = buildAnswerEvidencePack({
      question: "What should the response include for dependency notes?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "Always include dependency names with versions.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "Also include the license for each library.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 3,
          orderKey: 3,
          content: "Additionally include Flask 2.3.1 and SQLite 3.39.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("Flask 2.3.1");
    expect(cueSection).toContain("SQLite 3.39");
    expect(cueSection).not.toContain("named tools/examples: Also");
    expect(cueSection).not.toContain("Additionally");
  });

  it("surfaces date values and date-format requirements for instruction questions", () => {
    const pack = buildAnswerEvidencePack({
      question: "What precise filing date should the response include?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 10,
          orderKey: 10,
          content: "Always present filing dates using MM/DD/YYYY format.",
          role: "user",
          timeAnchor: "Mar",
        },
        {
          sourceId: 11,
          orderKey: 11,
          content: "The non-provisional patent filing was on May 18, 2024.",
          role: "user",
          timeAnchor: "May",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("date values: May 18, 2024");
    expect(cueSection).toContain("format/style requirements: MM/DD/YYYY");
  });

  it("surfaces numeric amounts and percentages for instruction answers", () => {
    const pack = buildAnswerEvidencePack({
      question: "What should the answer include for my salary and editing progress?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content:
            "Always include the exact salary figure and percentage improvements rather than vague ranges.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "The offer salary is $82,500, and my editing progress improved by 20% after the clarity challenge.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("numeric values/amounts: $82,500, 20%");
    expect(cueSection).toContain(
      "include the concrete values below when they answer the user's requested response contents",
    );
  });

  it("surfaces explicit response-content requirements for instruction answers", () => {
    const pack = buildAnswerEvidencePack({
      question:
        "What should the response include for the salary and method explanation?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content:
            "Always include a clear confirmation of the exact salary figure, and explain more than one method while comparing their approaches or advantages.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "The offer salary is $82,500, and the two triangle-area methods are base-times-height and Heron's formula.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain(
      "response-content requirements: clear confirmation of the exact stated value",
    );
    expect(cueSection).toContain(
      "more than one method with comparison of approaches or advantages",
    );
    expect(cueSection).toContain("numeric values/amounts: $82,500");
  });

  it("surfaces itemized budget amounts for instruction answers", () => {
    const pack = buildAnswerEvidencePack({
      question: "What should the response include for my event budget?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content:
            "Whenever I ask about event budgets, include itemized costs, specific amounts, and a detailed breakdown.",
          role: "user",
          timeAnchor: "Apr",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content:
            "The budget line items are venue $500, catering $1,200, permits $75, and decorations $150.",
          role: "user",
          timeAnchor: "Apr",
        },
      ],
    });

    const cueSection = pack.slice(
      pack.indexOf("Concrete answer-content cues:"),
      pack.indexOf("When a fact changed across these entries"),
    );
    expect(cueSection).toContain("format/style requirements: itemized costs");
    expect(cueSection).toContain("specific amounts");
    expect(cueSection).toContain("detailed breakdown");
    expect(cueSection).toContain(
      "numeric values/amounts: $500, $1,200, $75, $150",
    );
  });

  it("does not fall back to all noisy turns for instruction questions without an explicit constraint", () => {
    const pack = buildAnswerEvidencePack({
      question: "How can I organize multiple points in my CV?",
      questionType: "instruction_following",
      turns: [
        {
          sourceId: 1,
          orderKey: 1,
          content: "I negotiated two remote workdays per week.",
          role: "user",
          timeAnchor: "Jan",
        },
        {
          sourceId: 2,
          orderKey: 2,
          content: "My CV has three accomplishments that I need to organize.",
          role: "user",
          timeAnchor: "Feb",
        },
      ],
    });

    expect(pack).toContain("Instruction constraints:");
    expect(pack).toContain("(no direct standing instruction found)");
    expect(pack).toContain("Supporting evidence for the requested answer:");
    expect(pack).toContain("My CV has three accomplishments");
    expect(pack).not.toContain("remote workdays");
  });

  it("handles empty evidence", () => {
    const pack = buildAnswerEvidencePack({
      question: "What is X?",
      turns: [],
    });
    expect(pack).toContain("(no evidence)");
  });
});

describe("structured evidence entries and chain-of-note reading", () => {
  const moveTurns = [
    {
      content: "I moved to Kirkland.",
      orderKey: 1,
      role: "user",
      sourceId: "a1",
      timeAnchor: "2023-05-01",
    },
    {
      content: "I moved to Bellevue.",
      orderKey: 2,
      role: "user",
      sourceId: "a2",
      timeAnchor: "2023-08-01",
    },
  ];

  it("renders validity and channel provenance when the caller provides them", () => {
    const pack = buildAnswerEvidencePack({
      question: "Where do I live?",
      turns: [
        {
          ...moveTurns[0],
          channels: ["lexical", "dense"],
          validity: "superseded 2023-08-01",
        },
        {
          ...moveTurns[1],
          channels: ["lexical"],
          validity: "current",
        },
      ],
    });
    expect(pack).toContain(
      "[t=2023-05-01 | #a1 | user | superseded 2023-08-01 | via lexical+dense] I moved to Kirkland.",
    );
    expect(pack).toContain(
      "[t=2023-08-01 | #a2 | user | current | via lexical] I moved to Bellevue.",
    );
  });

  it("keeps the historical entry format when the typed fields are absent", () => {
    const pack = buildAnswerEvidencePack({
      question: "Where do I live?",
      turns: moveTurns,
    });
    expect(pack).toContain("[t=2023-05-01 | #a1 | user] I moved to Kirkland.");
    expect(pack).not.toContain("via ");
  });

  it("appends the chain-of-note reading protocol only when requested", () => {
    const withNotes = buildAnswerEvidencePack({
      chainOfNote: true,
      question: "Where do I live?",
      turns: moveTurns,
    });
    // Per-entry note pass citing entry ids, then a marked final answer the
    // harness can extract for strict scoring.
    expect(withNotes).toContain("one brief note per evidence entry");
    expect(withNotes).toContain("#id");
    expect(withNotes).toContain('"Final answer:"');

    const withoutNotes = buildAnswerEvidencePack({
      question: "Where do I live?",
      turns: moveTurns,
    });
    expect(withoutNotes).not.toContain("Final answer");
  });

  it("keeps the chain-of-note protocol as the last section for every operation", () => {
    const pack = buildAnswerEvidencePack({
      chainOfNote: true,
      question: "What happened?",
      questionType: "abstention",
      turns: moveTurns,
    });
    const protocolIndex = pack.indexOf("one brief note per evidence entry");
    expect(protocolIndex).toBeGreaterThan(-1);
    expect(protocolIndex).toBeGreaterThan(
      pack.indexOf("Evidence for absence check:"),
    );
  });

  it("extracts the final answer after the last marker", () => {
    expect(
      extractFinalAnswer(
        "- #a1: superseded move\n- #a2: current move\nFinal answer: Bellevue",
      ),
    ).toBe("Bellevue");
    expect(extractFinalAnswer("**Final answer:** Bellevue")).toBe("Bellevue");
    expect(
      extractFinalAnswer(
        "notes\nfinal answer:\nBellevue and Kirkland\nsince 2023",
      ),
    ).toBe("Bellevue and Kirkland\nsince 2023");
    // A note that mentions the phrase must not clip the real answer.
    expect(
      extractFinalAnswer(
        "The final answer depends on #a2.\nFinal answer: Bellevue",
      ),
    ).toBe("Bellevue");
  });

  it("returns the raw text when no usable marker is present", () => {
    expect(extractFinalAnswer("Bellevue")).toBe("Bellevue");
    expect(extractFinalAnswer("  Bellevue \n")).toBe("Bellevue");
    // Degenerate output (marker with nothing after it) keeps the raw text
    // rather than scoring an empty answer.
    expect(extractFinalAnswer("notes only\nFinal answer:")).toBe(
      "notes only\nFinal answer:",
    );
  });
});
