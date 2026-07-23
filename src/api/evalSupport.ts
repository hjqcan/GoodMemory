import type { MemoryScope } from "../domain/scope";
import type { BehavioralOutcomeRecordInput } from "../evolution/behavioralTelemetry";
import type { GoodMemory } from "./contracts";

export const GOODMEMORY_EVAL_SUPPORT = Symbol.for("goodmemory.eval.support");

export interface GoodMemoryEvalSupport {
  assistedRecallRouter?: boolean;
  assistedReviewer?: boolean;
  prepareProjectionScope?: (scope: MemoryScope) => Promise<void>;
  recordBehavioralOutcome?: (
    input: BehavioralOutcomeRecordInput & {
      scope: MemoryScope;
    },
  ) => Promise<void>;
}

type EvalAwareGoodMemory = GoodMemory & {
  [GOODMEMORY_EVAL_SUPPORT]?: GoodMemoryEvalSupport;
};

export function attachGoodMemoryEvalSupport(
  memory: GoodMemory,
  support: GoodMemoryEvalSupport,
): GoodMemory {
  (memory as EvalAwareGoodMemory)[GOODMEMORY_EVAL_SUPPORT] = support;
  return memory;
}

export function readGoodMemoryEvalSupport(
  memory: GoodMemory,
): GoodMemoryEvalSupport | undefined {
  return (memory as EvalAwareGoodMemory)[GOODMEMORY_EVAL_SUPPORT];
}
