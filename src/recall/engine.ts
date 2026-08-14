import type { RecallEngineConfig } from "./contracts";
import { createRecallPipeline } from "./retrievalPipeline";

export type {
  RecallCandidateTrace,
  RecallEngineConfig,
  RecallGeneralizedFusionConfig,
  RecallHit,
  RecallInput,
  RecallResult,
  RecallSemanticCandidatesConfig,
} from "./contracts";
export {
  resolveActiveGeneralizedFusionConfig,
  resolveGeneralizedFusionBudget,
} from "./retrievalPipeline";

export function createRecallEngine(config: RecallEngineConfig) {
  return createRecallPipeline(config);
}
