import {
  createLongMemEvalGoodMemoryContextBuilder,
} from "../../../src/eval/longmemeval";
import type { LongMemEvalCase } from "../../../src/eval/longmemeval";
import {
  createHermeticLongMemEvalMemory,
  createLongMemEvalMemoryFactory,
} from "../../run-phase-62-eval";

const PROFILE = "goodmemory-recommended";
const MAX_CONCURRENCY = 2;

export interface LongMemEvalV1SourceWorkerTurn {
  content: string;
  role: string;
}

export interface LongMemEvalV1SourceWorkerSession {
  date: string;
  sessionId: string;
  turns: LongMemEvalV1SourceWorkerTurn[];
}

export interface LongMemEvalV1SourceWorkerCase {
  caseKey: string;
  question: string;
  questionDate: string;
  sessions: LongMemEvalV1SourceWorkerSession[];
}

export interface LongMemEvalV1SourceWorkerInput {
  cases: LongMemEvalV1SourceWorkerCase[];
  schemaVersion: 1;
}

export interface LongMemEvalV1SourceWorkerCaseResult {
  caseKey: string;
  context: string;
  retrievedSessionIds: string[];
}

export interface LongMemEvalV1SourceWorkerOutput {
  cases: LongMemEvalV1SourceWorkerCaseResult[];
  schemaVersion: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTurn(value: unknown): value is LongMemEvalV1SourceWorkerTurn {
  return isRecord(value) &&
    hasExactKeys(value, ["content", "role"]) &&
    typeof value.content === "string" &&
    isNonEmptyString(value.role);
}

function isSession(
  value: unknown,
  index: number,
): value is LongMemEvalV1SourceWorkerSession {
  return isRecord(value) &&
    hasExactKeys(value, ["date", "sessionId", "turns"]) &&
    isNonEmptyString(value.date) &&
    value.sessionId === `session-${index + 1}` &&
    Array.isArray(value.turns) &&
    value.turns.length > 0 &&
    value.turns.every(isTurn);
}

function isWorkerCase(value: unknown): value is LongMemEvalV1SourceWorkerCase {
  return isRecord(value) &&
    hasExactKeys(value, ["caseKey", "question", "questionDate", "sessions"]) &&
    typeof value.caseKey === "string" &&
    /^case-[a-f0-9]{24}$/u.test(value.caseKey) &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.questionDate) &&
    Array.isArray(value.sessions) &&
    value.sessions.length > 0 &&
    value.sessions.every(isSession);
}

export function parseLongMemEvalV1SourceWorkerInput(
  raw: string,
): LongMemEvalV1SourceWorkerInput {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid LongMemEval V1 source-worker input.");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["cases", "schemaVersion"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    !value.cases.every(isWorkerCase)
  ) {
    throw new Error("Invalid LongMemEval V1 source-worker input.");
  }
  const caseKeys = value.cases.map(({ caseKey }) => caseKey);
  if (new Set(caseKeys).size !== caseKeys.length) {
    throw new Error("Invalid LongMemEval V1 source-worker input.");
  }
  return value as unknown as LongMemEvalV1SourceWorkerInput;
}

function toLongMemEvalCase(
  testCase: LongMemEvalV1SourceWorkerCase,
): LongMemEvalCase {
  return {
    answer: "",
    answerSessionIds: [],
    haystackDates: testCase.sessions.map(({ date }) => date),
    haystackSessionIds: testCase.sessions.map(({ sessionId }) => sessionId),
    haystackSessions: testCase.sessions.map(({ turns }) =>
      turns.map(({ content, role }) => ({ content, role }))
    ),
    question: testCase.question,
    questionDate: testCase.questionDate,
    questionId: testCase.caseKey,
    questionType: "",
  };
}

async function mapWithConcurrency<T, R>(input: {
  items: readonly T[];
  operation(item: T): Promise<R>;
}): Promise<R[]> {
  const results = new Array<R>(input.items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, input.items.length) },
    async () => {
      while (nextIndex < input.items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await input.operation(input.items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function runLongMemEvalV1SourceWorker(
  input: LongMemEvalV1SourceWorkerInput,
): Promise<LongMemEvalV1SourceWorkerOutput> {
  return {
    cases: await mapWithConcurrency({
      items: input.cases,
      operation: async (workerCase) => {
        const contextBuilder = createLongMemEvalGoodMemoryContextBuilder({
          createMemory: createLongMemEvalMemoryFactory(
            createHermeticLongMemEvalMemory,
            {
              fusionMinRelativeStrength: 0.35,
              runNamespace:
                `longmemeval-v1-source-paired:${workerCase.caseKey}`,
            },
          ),
          ingestMode: "label-free-raw",
          maxTokens: 4_000,
          runId: `longmemeval-v1-source-paired:${workerCase.caseKey}`,
        });
        const context = await contextBuilder({
          profile: PROFILE,
          testCase: toLongMemEvalCase(workerCase),
        });
        return {
          caseKey: workerCase.caseKey,
          context: context.content,
          retrievedSessionIds: context.retrievedSessionIds,
        };
      },
    }),
    schemaVersion: 1,
  };
}

if (import.meta.main) {
  try {
    const input = parseLongMemEvalV1SourceWorkerInput(await Bun.stdin.text());
    const output = await runLongMemEvalV1SourceWorker(input);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
