import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  scoreBeamAnswer,
  validateBeamRows,
} from "./beam";
import type {
  BeamCase,
  BeamChatTurn,
  BeamRow,
} from "./beam";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "./phase74ProtectionContracts";
import {
  hashPhase74ProtectionCaseIds,
} from "./phase74ProtectionContracts";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
  runPhase74ProtectionSuiteCases,
} from "./phase74ProtectionRun";
import type {
  LoadedPhase74FrozenProtectionSuiteRunArtifact,
  Phase74ProtectionBranch,
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteRunResult,
} from "./phase74ProtectionRun";
import type {
  Phase74ProtectionSuiteVerifier,
} from "./phase74ProtectionVerifier";

export const PHASE74_BEAM_FULL_100K_DATASET_ID = "beam-full-100k-v1";

export const PHASE74_BEAM_SAFETY_SELECTION = {
  abstentionQuestionCount: 40,
  conversationCount: 20,
  mode: "full",
  population: "all-abstention-questions",
  questionCount: 400,
  scale: "100K",
} as const;

export const PHASE74_BEAM_SAFETY_BUDGET = {
  renderedContextTokens: 6_000,
} as const;

export const PHASE74_BEAM_SAFETY_METRICS = [
  "abstentionAccuracy",
  "hallucinationRate",
] as const;

export const PHASE74_BEAM_SAFETY_SUITE = {
  id: "beam-full-100k-abstention-groundedness-safety-v1",
  kind: "safety",
} as const;

export const PHASE74_BEAM_SAFETY_VERIFIER_ID =
  "beam-full-100k-abstention-groundedness-replay-v1";

export interface Phase74BeamSafetyContract {
  answerModel: Phase74ProtectionIdentityDescriptor;
  answerPrompt: Phase74ProtectionIdentityDescriptor;
  baselinePipeline: Phase74ProtectionIdentityDescriptor;
  candidatePipeline: Phase74ProtectionIdentityDescriptor;
  dataset: Phase74ProtectionIdentityDescriptor;
  groundednessJudgeModel: Phase74ProtectionIdentityDescriptor;
  groundednessPrompt: Phase74ProtectionIdentityDescriptor;
  reader: Phase74ProtectionIdentityDescriptor;
  source: Phase74ProtectionIdentityDescriptor;
}

export interface Phase74BeamSourceMessage {
  content: string;
  id: number;
  role: string;
  timeAnchor: string;
}

export interface Phase74BeamPipelineRequest {
  answerModel: Phase74ProtectionIdentityDescriptor;
  answerPrompt: Phase74ProtectionIdentityDescriptor;
  attributionKey: string;
  pipeline: Phase74ProtectionIdentityDescriptor;
  query: string;
  reader: Phase74ProtectionIdentityDescriptor;
  renderedContextTokenLimit: number;
  sourceMessages: Phase74BeamSourceMessage[];
}

export interface Phase74BeamPipelineOutput {
  rawAnswer: string;
  retrievedEvidenceIds: number[];
}

export interface Phase74BeamGroundednessJudgeRequest {
  attributionKey: string;
  branch: Phase74ProtectionBranch;
  groundednessJudgeModel: Phase74ProtectionIdentityDescriptor;
  groundednessPrompt: Phase74ProtectionIdentityDescriptor;
  query: string;
  rawAnswer: string;
  reader: Phase74ProtectionIdentityDescriptor;
  retrievedEvidence: Phase74BeamSourceMessage[];
}

export interface Phase74BeamSafetyDependencies {
  createPipeline(pipeline: Phase74ProtectionIdentityDescriptor): {
    run(input: Phase74BeamPipelineRequest): Promise<Phase74BeamPipelineOutput>;
  };
  judgeGroundedness(input: Phase74BeamGroundednessJudgeRequest): Promise<unknown>;
}

interface BeamSafetyCaseInput {
  conversationId: string;
  questionId: string;
}

interface BeamSafetyCase {
  input: BeamSafetyCaseInput;
  sourceMessages: Phase74BeamSourceMessage[];
  testCase: BeamCase;
}

interface GroundednessJudgment {
  rationale: string;
  schemaVersion: 1;
  verdict: "grounded" | "hallucinated";
}

interface BeamSafetyRawOutput {
  groundednessJudge: GroundednessJudgment;
  rawAnswer: string;
  retrievedEvidenceIds: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new Error(
      `Phase 74 BEAM ${label} must contain exactly: ${[...expected].sort().join(", ")}.`,
    );
  }
}

function descriptor(id: string, material: unknown) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameValue(left: unknown, right: unknown): boolean {
  return hashPhase74ProtectionValue(left) === hashPhase74ProtectionValue(right);
}

function validateDescriptor(
  value: Phase74ProtectionIdentityDescriptor,
  label: string,
): void {
  if (
    value.id === "" ||
    value.id.trim() !== value.id ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  ) {
    throw new Error(`Phase 74 BEAM ${label} identity is invalid.`);
  }
}

function validateContract(contract: Phase74BeamSafetyContract): void {
  for (const [label, value] of Object.entries(contract)) {
    validateDescriptor(value, label);
  }
  if (contract.dataset.id !== PHASE74_BEAM_FULL_100K_DATASET_ID) {
    throw new Error(
      `Phase 74 BEAM safety requires the pinned BEAM full-100K dataset identity ${PHASE74_BEAM_FULL_100K_DATASET_ID}; smoke and synthetic datasets are not admissible.`,
    );
  }
  if (sameValue(contract.baselinePipeline, contract.candidatePipeline)) {
    throw new Error(
      "Phase 74 BEAM safety baseline and candidate pipeline identities must differ.",
    );
  }
}

function parseDescriptor(
  value: unknown,
  label: string,
): Phase74ProtectionIdentityDescriptor {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 BEAM ${label} must be an object.`);
  }
  assertExactKeys(value, ["id", "sha256"], label);
  const descriptor = {
    id: value.id,
    sha256: value.sha256,
  } as Phase74ProtectionIdentityDescriptor;
  validateDescriptor(descriptor, label);
  return descriptor;
}

export function parsePhase74BeamSafetyContract(
  value: unknown,
): Phase74BeamSafetyContract {
  if (!isRecord(value)) {
    throw new Error("Phase 74 BEAM trusted contract must be an object.");
  }
  assertExactKeys(value, [
    "answerModel",
    "answerPrompt",
    "baselinePipeline",
    "candidatePipeline",
    "dataset",
    "groundednessJudgeModel",
    "groundednessPrompt",
    "reader",
    "source",
  ], "trusted contract");
  const contract = {
    answerModel: parseDescriptor(value.answerModel, "answerModel"),
    answerPrompt: parseDescriptor(value.answerPrompt, "answerPrompt"),
    baselinePipeline: parseDescriptor(
      value.baselinePipeline,
      "baselinePipeline",
    ),
    candidatePipeline: parseDescriptor(
      value.candidatePipeline,
      "candidatePipeline",
    ),
    dataset: parseDescriptor(value.dataset, "dataset"),
    groundednessJudgeModel: parseDescriptor(
      value.groundednessJudgeModel,
      "groundednessJudgeModel",
    ),
    groundednessPrompt: parseDescriptor(
      value.groundednessPrompt,
      "groundednessPrompt",
    ),
    reader: parseDescriptor(value.reader, "reader"),
    source: parseDescriptor(value.source, "source"),
  };
  validateContract(contract);
  return contract;
}

function toSourceMessages(chat: readonly BeamChatTurn[][]): Phase74BeamSourceMessage[] {
  const messages = chat.flatMap((batch) => batch.map((turn) => ({
    content: turn.content,
    id: turn.id,
    role: turn.role,
    timeAnchor: turn.timeAnchor,
  })));
  const ids = messages.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Phase 74 BEAM source message IDs must be unique per conversation.");
  }
  return messages;
}

function parseFull100kRows(input: {
  contract: Phase74BeamSafetyContract;
  datasetBytes: Uint8Array;
}): BeamRow[] {
  validateContract(input.contract);
  if (sha256(input.datasetBytes) !== input.contract.dataset.sha256) {
    throw new Error("Phase 74 BEAM dataset bytes do not match the pinned SHA-256.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(input.datasetBytes).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Phase 74 BEAM full-100K dataset is not valid JSON.", {
      cause: error,
    });
  }
  const rows = validateBeamRows(parsed);
  const questionCount = rows.reduce(
    (sum, row) => sum + row.probingQuestions.length,
    0,
  );
  if (
    rows.length !== PHASE74_BEAM_SAFETY_SELECTION.conversationCount ||
    questionCount !== PHASE74_BEAM_SAFETY_SELECTION.questionCount
  ) {
    throw new Error(
      "Phase 74 BEAM full-100K protection requires exactly 20 conversations and 400 questions.",
    );
  }
  const conversationIds = rows.map(({ conversationId }) => conversationId);
  const questionIds = rows.flatMap((row) =>
    row.probingQuestions.map(({ questionId }) => questionId)
  );
  if (
    new Set(conversationIds).size !== conversationIds.length ||
    new Set(questionIds).size !== questionIds.length
  ) {
    throw new Error(
      "Phase 74 BEAM full-100K conversation and question IDs must be unique.",
    );
  }
  return rows;
}

function buildPopulation(rows: readonly BeamRow[]): {
  cases: Array<{ caseId: string; input: BeamSafetyCaseInput }>;
  selected: Map<string, BeamSafetyCase>;
} {
  const selected = new Map<string, BeamSafetyCase>();
  for (const row of rows) {
    const sourceMessages = toSourceMessages(row.chat);
    for (const question of row.probingQuestions) {
      if (question.category !== "abstention" || question.answerable) {
        continue;
      }
      const testCase: BeamCase = {
        answer: question.answer,
        answerable: question.answerable,
        chat: row.chat,
        conversationId: row.conversationId,
        evidenceChatIds: question.evidenceChatIds,
        question: question.question,
        questionId: question.questionId,
        questionType: question.questionType,
        scale: "100K",
      };
      selected.set(question.questionId, {
        input: {
          conversationId: row.conversationId,
          questionId: question.questionId,
        },
        sourceMessages,
        testCase,
      });
    }
  }
  if (
    selected.size !== PHASE74_BEAM_SAFETY_SELECTION.abstentionQuestionCount
  ) {
    throw new Error(
      "Phase 74 BEAM full-100K protection requires exactly 40 abstention questions.",
    );
  }
  return {
    cases: [...selected.entries()].map(([caseId, value]) => ({
      caseId,
      input: value.input,
    })),
    selected,
  };
}

function parsePipelineOutput(value: unknown): Phase74BeamPipelineOutput {
  if (!isRecord(value)) {
    throw new Error("Phase 74 BEAM pipeline output must be an object.");
  }
  if (typeof value.rawAnswer !== "string") {
    throw new Error("Phase 74 BEAM pipeline rawAnswer must be a string.");
  }
  if (
    !Array.isArray(value.retrievedEvidenceIds) ||
    value.retrievedEvidenceIds.some((id) =>
      typeof id !== "number" || !Number.isInteger(id)
    )
  ) {
    throw new Error(
      "Phase 74 BEAM pipeline retrievedEvidenceIds must be integer IDs.",
    );
  }
  return {
    rawAnswer: value.rawAnswer,
    retrievedEvidenceIds: value.retrievedEvidenceIds as number[],
  };
}

function selectRetrievedEvidence(
  output: Phase74BeamPipelineOutput,
  sourceMessages: readonly Phase74BeamSourceMessage[],
): Phase74BeamSourceMessage[] {
  if (
    new Set(output.retrievedEvidenceIds).size !==
      output.retrievedEvidenceIds.length
  ) {
    throw new Error("Phase 74 BEAM retrieved evidence IDs must be unique.");
  }
  const messages = new Map(sourceMessages.map((message) => [message.id, message]));
  return output.retrievedEvidenceIds.map((id) => {
    const message = messages.get(id);
    if (message === undefined) {
      throw new Error(
        `Phase 74 BEAM retrieved evidence ID ${id} is outside the source conversation.`,
      );
    }
    return { ...message };
  });
}

function parseGroundednessJudgment(value: unknown): GroundednessJudgment {
  if (!isRecord(value)) {
    throw new Error(
      "Phase 74 BEAM groundedness judge response must be an object.",
    );
  }
  assertExactKeys(
    value,
    ["rationale", "schemaVersion", "verdict"],
    "groundedness judge response",
  );
  if (
    value.schemaVersion !== 1 ||
    (value.verdict !== "grounded" && value.verdict !== "hallucinated") ||
    typeof value.rationale !== "string" ||
    value.rationale === "" ||
    value.rationale.trim() !== value.rationale
  ) {
    throw new Error(
      "Phase 74 BEAM groundedness judge structured response is invalid.",
    );
  }
  return {
    rationale: value.rationale,
    schemaVersion: 1,
    verdict: value.verdict,
  };
}

function buildScores(input: {
  judgment: GroundednessJudgment;
  rawAnswer: string;
  testCase: BeamCase;
}): Phase74ProtectionSuiteBranchScores {
  const abstention = scoreBeamAnswer(input.testCase, input.rawAnswer);
  if (abstention.method !== "abstention") {
    throw new Error(
      `Phase 74 BEAM case ${input.testCase.questionId} left the abstention population.`,
    );
  }
  return {
    safety: {
      abstentionAccuracy: abstention.correct ? 1 : 0,
      hallucinationRate: input.judgment.verdict === "hallucinated" ? 1 : 0,
    },
  };
}

export function buildPhase74BeamSafetyProtectionIdentity(
  contract: Phase74BeamSafetyContract,
) {
  validateContract(contract);
  return {
    dataset: contract.dataset,
    judge: descriptor("beam-independent-groundedness-judge-v1", {
      model: contract.groundednessJudgeModel,
      prompt: contract.groundednessPrompt,
      response: {
        rationale: "string",
        schemaVersion: 1,
        verdict: ["grounded", "hallucinated"],
      },
    }),
    model: contract.answerModel,
    pipeline: descriptor(PHASE74_BEAM_SAFETY_SUITE.id, {
      baseline: contract.baselinePipeline,
      budget: PHASE74_BEAM_SAFETY_BUDGET,
      candidate: contract.candidatePipeline,
      reader: contract.reader,
      selection: PHASE74_BEAM_SAFETY_SELECTION,
    }),
    populationId:
      `${contract.dataset.id}:full-100k:all-abstention-questions-v1`,
    prompt: descriptor("beam-safety-prompts-v1", {
      answer: contract.answerPrompt,
      groundedness: contract.groundednessPrompt,
    }),
    source: contract.source,
  };
}

export function buildPhase74BeamSafetyProtectionRunIdentity(input: {
  contract: Phase74BeamSafetyContract;
  datasetBytes: Uint8Array;
}): Phase74ProtectionRunIdentity {
  const rows = parseFull100kRows(input);
  const population = buildPopulation(rows);
  const identity = buildPhase74BeamSafetyProtectionIdentity(input.contract);
  const caseIds = population.cases.map(({ caseId }) => caseId);
  return {
    dataset: identity.dataset,
    judge: identity.judge,
    model: identity.model,
    pipeline: identity.pipeline,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: identity.populationId,
    },
    prompt: identity.prompt,
    source: identity.source,
  };
}

function freshMessages(
  sourceMessages: readonly Phase74BeamSourceMessage[],
): Phase74BeamSourceMessage[] {
  return sourceMessages.map((message) => ({ ...message }));
}

export async function runPhase74BeamSafetyProtection(input: {
  artifactPath: string;
  caseConcurrency?: number;
  contract: Phase74BeamSafetyContract;
  datasetBytes: Uint8Array;
  rawArtifactPath: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
}, dependencies: Phase74BeamSafetyDependencies): Promise<Phase74ProtectionSuiteRunResult> {
  const rows = parseFull100kRows(input);
  const population = buildPopulation(rows);
  const pipelines = {
    baseline: dependencies.createPipeline(input.contract.baselinePipeline),
    candidate: dependencies.createPipeline(input.contract.candidatePipeline),
  } satisfies Record<Phase74ProtectionBranch, {
    run(request: Phase74BeamPipelineRequest): Promise<Phase74BeamPipelineOutput>;
  }>;
  if (pipelines.baseline === pipelines.candidate) {
    throw new Error(
      "Phase 74 BEAM safety requires isolated baseline and candidate pipeline runtimes.",
    );
  }

  return runPhase74ProtectionSuiteCases<BeamSafetyCaseInput>({
    artifactPath: input.artifactPath,
    caseConcurrency: input.caseConcurrency,
    cases: population.cases,
    evaluate: async ({ branch, input: caseInput }) => {
      const selected = population.selected.get(caseInput.questionId);
      if (
        selected === undefined ||
        selected.input.conversationId !== caseInput.conversationId
      ) {
        throw new Error(
          `Phase 74 BEAM question ${caseInput.questionId} is outside the frozen population.`,
        );
      }
      const pipelineOutput = parsePipelineOutput(await pipelines[branch].run({
        answerModel: input.contract.answerModel,
        answerPrompt: input.contract.answerPrompt,
        attributionKey: hashPhase74ProtectionValue({
          query: selected.testCase.question,
          sourceMessages: selected.sourceMessages,
        }),
        pipeline: branch === "baseline"
          ? input.contract.baselinePipeline
          : input.contract.candidatePipeline,
        query: selected.testCase.question,
        reader: input.contract.reader,
        renderedContextTokenLimit:
          PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens,
        sourceMessages: freshMessages(selected.sourceMessages),
      }));
      const retrievedEvidence = selectRetrievedEvidence(
        pipelineOutput,
        selected.sourceMessages,
      );
      const judgment = parseGroundednessJudgment(
        await dependencies.judgeGroundedness({
          attributionKey: hashPhase74ProtectionValue({
            query: selected.testCase.question,
            sourceMessages: selected.sourceMessages,
          }),
          branch,
          groundednessJudgeModel: input.contract.groundednessJudgeModel,
          groundednessPrompt: input.contract.groundednessPrompt,
          query: selected.testCase.question,
          rawAnswer: pipelineOutput.rawAnswer,
          reader: input.contract.reader,
          retrievedEvidence,
        }),
      );
      return {
        rawOutput: {
          groundednessJudge: judgment,
          rawAnswer: pipelineOutput.rawAnswer,
          retrievedEvidenceIds: pipelineOutput.retrievedEvidenceIds,
        } satisfies BeamSafetyRawOutput,
        scores: buildScores({
          judgment,
          rawAnswer: pipelineOutput.rawAnswer,
          testCase: selected.testCase,
        }),
      };
    },
    identity: buildPhase74BeamSafetyProtectionIdentity(input.contract),
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_BEAM_SAFETY_SUITE,
  });
}

function parseRawOutput(
  value: unknown,
  label: string,
): BeamSafetyRawOutput {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 BEAM ${label} raw output must be an object.`);
  }
  assertExactKeys(
    value,
    ["groundednessJudge", "rawAnswer", "retrievedEvidenceIds"],
    `${label} raw output`,
  );
  const pipelineOutput = parsePipelineOutput(value);
  return {
    groundednessJudge: parseGroundednessJudgment(value.groundednessJudge),
    rawAnswer: pipelineOutput.rawAnswer,
    retrievedEvidenceIds: pipelineOutput.retrievedEvidenceIds,
  };
}

function rawRows(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("Phase 74 BEAM raw artifact rows are invalid.");
  }
  return value.rows.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Phase 74 BEAM raw artifact row must be an object.");
    }
    return row;
  });
}

export async function verifyPhase74BeamSafetyProtectionArtifact(input: {
  artifactPath: string;
  contract: Phase74BeamSafetyContract;
  datasetBytes: Uint8Array;
}): Promise<LoadedPhase74FrozenProtectionSuiteRunArtifact> {
  const rows = parseFull100kRows(input);
  const population = buildPopulation(rows);
  const loaded = await loadPhase74FrozenProtectionSuiteRunArtifact(
    input.artifactPath,
  );
  if (!sameValue(loaded.suite, PHASE74_BEAM_SAFETY_SUITE)) {
    throw new Error("Phase 74 BEAM safety suite identity drifted.");
  }
  const identity = buildPhase74BeamSafetyProtectionIdentity(input.contract);
  if (!sameValue(loaded.identity.dataset, identity.dataset)) {
    throw new Error("Phase 74 BEAM safety dataset identity drifted.");
  }
  if (
    !sameValue(loaded.identity.judge, identity.judge) ||
    !sameValue(loaded.identity.model, identity.model) ||
    !sameValue(loaded.identity.pipeline, identity.pipeline) ||
    !sameValue(loaded.identity.prompt, identity.prompt) ||
    !sameValue(loaded.identity.source, identity.source)
  ) {
    throw new Error(
      "Phase 74 BEAM safety evaluator identity drifted (selection, source, model, prompt, reader, or budget).",
    );
  }
  const caseIds = population.cases.map(({ caseId }) => caseId);
  if (
    !sameValue(loaded.rows.map(({ caseId }) => caseId), caseIds) ||
    loaded.identity.population.caseCount !== caseIds.length ||
    loaded.identity.population.caseIdsSha256 !==
      hashPhase74ProtectionCaseIds(caseIds) ||
    loaded.identity.population.id !== identity.populationId
  ) {
    throw new Error("Phase 74 BEAM safety population identity drifted.");
  }

  const raw = JSON.parse(
    await readFile(loaded.rawArtifactPath, "utf8"),
  ) as unknown;
  const replayRows = rawRows(raw);
  for (const [index, expectedCase] of population.cases.entries()) {
    const rawRow = replayRows[index]!;
    if (
      rawRow.caseId !== expectedCase.caseId ||
      rawRow.inputSha256 !== hashPhase74ProtectionValue(expectedCase.input)
    ) {
      throw new Error(
        `Phase 74 BEAM safety input identity drifted at ${expectedCase.caseId}.`,
      );
    }
    const selected = population.selected.get(expectedCase.caseId)!;
    for (const branch of ["baseline", "candidate"] as const) {
      const rawBranch = rawRow[branch];
      if (!isRecord(rawBranch)) {
        throw new Error(
          `Phase 74 BEAM safety raw branch is invalid at ${expectedCase.caseId}.${branch}.`,
        );
      }
      const rawOutput = parseRawOutput(
        rawBranch.rawOutput,
        `${expectedCase.caseId}.${branch}`,
      );
      selectRetrievedEvidence(rawOutput, selected.sourceMessages);
      const replayedScores = buildScores({
        judgment: rawOutput.groundednessJudge,
        rawAnswer: rawOutput.rawAnswer,
        testCase: selected.testCase,
      });
      if (
        !sameValue(rawBranch.scores, replayedScores) ||
        !sameValue(loaded.rows[index]![branch], replayedScores)
      ) {
        throw new Error(
          `Phase 74 BEAM safety score drifted at ${expectedCase.caseId}.${branch}.`,
        );
      }
    }
  }
  return loaded;
}

function cloneContract(
  contract: Phase74BeamSafetyContract,
): Phase74BeamSafetyContract {
  return {
    answerModel: { ...contract.answerModel },
    answerPrompt: { ...contract.answerPrompt },
    baselinePipeline: { ...contract.baselinePipeline },
    candidatePipeline: { ...contract.candidatePipeline },
    dataset: { ...contract.dataset },
    groundednessJudgeModel: { ...contract.groundednessJudgeModel },
    groundednessPrompt: { ...contract.groundednessPrompt },
    reader: { ...contract.reader },
    source: { ...contract.source },
  };
}

export function createPhase74BeamSafetyProtectionVerifier(
  contract: Phase74BeamSafetyContract,
): Phase74ProtectionSuiteVerifier {
  const trustedContract = cloneContract(contract);
  validateContract(trustedContract);
  return {
    id: PHASE74_BEAM_SAFETY_VERIFIER_ID,
    kind: PHASE74_BEAM_SAFETY_SUITE.kind,
    requiredMetrics: PHASE74_BEAM_SAFETY_METRICS,
    suiteId: PHASE74_BEAM_SAFETY_SUITE.id,
    verify: async ({ dataset, datasetBytes, run }) => {
      if (!sameValue(
        { id: dataset.id, sha256: dataset.sha256 },
        trustedContract.dataset,
      )) {
        throw new Error(
          "Phase 74 BEAM safety trusted dataset identity drifted.",
        );
      }
      const verified = await verifyPhase74BeamSafetyProtectionArtifact({
        artifactPath: run.artifactPath,
        contract: trustedContract,
        datasetBytes,
      });
      if (!sameValue({
        artifactSha256: verified.artifactSha256,
        identity: verified.identity,
        rawArtifactSha256: verified.rawArtifactSha256,
        replicate: verified.replicate,
        rows: verified.rows,
        runId: verified.runId,
        suite: verified.suite,
      }, {
        artifactSha256: run.artifactSha256,
        identity: run.identity,
        rawArtifactSha256: run.rawArtifactSha256,
        replicate: run.replicate,
        rows: run.rows,
        runId: run.runId,
        suite: run.suite,
      })) {
        throw new Error("Phase 74 BEAM safety loaded run input drifted.");
      }
    },
  };
}
