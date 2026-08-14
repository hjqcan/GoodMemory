import type { MemoryExtractionInput } from "./candidates";
import type { RememberEngineConfig } from "./contracts";
import { createRememberExtractionPipeline } from "./extractionPipeline";
import { createRememberWritePipeline } from "./writePipeline";

export type {
  ClassifiedCandidate,
  RememberEngineConfig,
  RememberEvent,
  RememberResult,
} from "./contracts";

export function createRememberEngine(config: RememberEngineConfig) {
  const extractionPipeline = createRememberExtractionPipeline(config);
  const writePipeline = createRememberWritePipeline(config, extractionPipeline);

  return {
    classifyCandidate: extractionPipeline.classifyCandidate,
    extract: (input: MemoryExtractionInput) =>
      extractionPipeline.extract(input),
    remember: (input: MemoryExtractionInput) =>
      writePipeline.remember(input),
  };
}
