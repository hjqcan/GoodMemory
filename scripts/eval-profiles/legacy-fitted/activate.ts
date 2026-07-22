import type { FactSelector } from "../../../src/recall/generalizedSelection";
import { enableLegacyFittedNarrowGatesForInternalEval } from "./recall/narrowGates";
import { selectFactsLegacy } from "./recall/selectionLegacy";

/** Returns the historical selector for explicit repo-local eval injection. */
export function createLegacyFittedEvalFactSelector(): FactSelector {
  enableLegacyFittedNarrowGatesForInternalEval();
  return selectFactsLegacy;
}
