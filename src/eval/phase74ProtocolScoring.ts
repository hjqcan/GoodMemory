import {
  requestOpenAICompatibleTextResult,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../provider/ai-sdk-runtime";
import type {
  AISDKModelConfig,
  FetchLike,
} from "../provider/ai-sdk-runtime";
import {
  normalizeAISDKLanguageModelUsage,
  runWithModelUsageAttempt,
} from "../provider/model-usage";
import {
  LOCOMO_OFFICIAL_QA_SCORER_V1,
  LOCOMO_QA_CATEGORIES,
  scoreLocomoOfficialQaV1,
} from "./locomo";
import type { LocomoQaCategory } from "./locomo";
import {
  buildLongMemEvalOfficialJudgePrompt,
  findLongMemEvalOfficialEvaluatorAlias,
  isLongMemEvalOfficialAbstentionCase,
  LONGMEMEVAL_OFFICIAL_EVALUATOR_IDENTITIES,
  LONGMEMEVAL_OFFICIAL_PROMPT_SHA256,
  LONGMEMEVAL_OFFICIAL_SCORER_IDENTITY,
  parseLongMemEvalOfficialJudgeVerdict,
} from "./longmemevalOfficialScorer";
import { createAttributedModelUsageSink } from "./modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "./modelUsage";
import type { Phase74BenchmarkFamily } from "./phase74Datasets";
import type {
  Phase74AnswerAssessment,
  Phase74GeneralizationCase,
} from "./phase74Generalization";
import {
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "./phase74ProviderConfiguration";
import type {
  EvalRunJsonObject,
  EvalRunModelIdentity,
} from "./runIdentity";

export type Phase74ProtocolCompatibleAnswerAssessor = (input: {
  answer: string;
  purpose: string;
  testCase: Phase74GeneralizationCase;
}) => Promise<Phase74AnswerAssessment>;

export function buildPhase74ProtocolScoringIdentity(
  benchmark: Phase74BenchmarkFamily,
  evaluator: EvalRunModelIdentity,
): EvalRunJsonObject {
  if (benchmark === "longmemeval") {
    const evaluatorAlias = findLongMemEvalOfficialEvaluatorAlias(evaluator);
    const publishedScoreComparable = evaluatorAlias !== null;
    return {
      binaryCorrectRule: "yes-substring",
      comparability: publishedScoreComparable
        ? "pinned-upstream-evaluator-identity"
        : "official-prompt-compatible-only",
      evaluator: { ...evaluator },
      evaluatorAlias,
      officialEvaluatorModels: LONGMEMEVAL_OFFICIAL_EVALUATOR_IDENTITIES.map(
        (identity) => ({ ...identity }),
      ),
      primaryMetric: "paired-accuracy",
      promptSha256: LONGMEMEVAL_OFFICIAL_PROMPT_SHA256,
      publishedScoreComparable,
      scorer: "longmemeval-pinned-prompt-compatible-qa-accuracy-v2",
      scorerCommit: LONGMEMEVAL_OFFICIAL_SCORER_IDENTITY.commit,
      scorerFileSha256: LONGMEMEVAL_OFFICIAL_SCORER_IDENTITY.fileSha256,
    };
  }
  return {
    binaryCorrectRule: "score-equals-one",
    comparability: "pinned-upstream-deterministic-scorer",
    primaryMetric: "macro-mean-category-aware-f1",
    scorer: LOCOMO_OFFICIAL_QA_SCORER_V1,
  };
}

function locomoCategory(testCase: Phase74GeneralizationCase): LocomoQaCategory {
  const category = testCase.protocolMetadata?.category;
  if (
    typeof category !== "string" ||
    !LOCOMO_QA_CATEGORIES.includes(category as LocomoQaCategory)
  ) {
    throw new Error(
      `Phase 74 LoCoMo case ${testCase.caseId} has no valid pinned category.`,
    );
  }
  return category as LocomoQaCategory;
}

function longMemEvalQuestionType(testCase: Phase74GeneralizationCase): string {
  const questionType = testCase.protocolMetadata?.questionType;
  if (typeof questionType !== "string" || questionType.length === 0) {
    throw new Error(
      `Phase 74 LongMemEval case ${testCase.caseId} has no question type.`,
    );
  }
  return questionType;
}

export function createPhase74ProtocolCompatibleAnswerAssessor(input: {
  benchmark: Phase74BenchmarkFamily;
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  model: AISDKModelConfig;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): Phase74ProtocolCompatibleAnswerAssessor {
  if (input.benchmark === "locomo") {
    return async ({ answer, testCase }) => {
      const score = scoreLocomoOfficialQaV1({
        answer,
        category: locomoCategory(testCase),
        goldAnswer: testCase.expectedAnswer,
      }).score;
      return { correct: score === 1, score };
    };
  }

  const configuration =
    PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.protocol;

  return async ({ answer, testCase }) => {
    const sink = createAttributedModelUsageSink({
      branch: "judge",
      caseId: testCase.caseId,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    const prompt = buildLongMemEvalOfficialJudgePrompt({
      abstention: isLongMemEvalOfficialAbstentionCase(testCase.caseId),
      candidateAnswer: answer,
      expectedAnswer: testCase.expectedAnswer,
      question: testCase.question,
      questionType: longMemEvalQuestionType(testCase),
    });
    let attempt = 0;
    const correct = await withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.model.model,
        operation: "judge",
        providerId: input.model.provider,
        sink,
        run: async (report) => {
          const result = await requestOpenAICompatibleTextResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.model,
            prompt,
            reasoningEffort: configuration.reasoningEffort,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          const verdict = stripThinkingBlocks(result.text);
          if (verdict === "") {
            throw new Error(
              "Phase 74 prompt-compatible LongMemEval judge returned empty output.",
            );
          }
          return parseLongMemEvalOfficialJudgeVerdict(verdict);
        },
      });
    }, { retryLimit: configuration.retryLimit });
    return { correct, score: Number(correct) };
  };
}
