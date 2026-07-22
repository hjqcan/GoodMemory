import { afterEach } from "bun:test";

import {
  enableLegacyFittedNarrowGatesForInternalEval,
} from "../../scripts/eval-profiles/legacy-fitted/recall/narrowGates";
import "./test-env";

enableLegacyFittedNarrowGatesForInternalEval();

afterEach(() => {
  enableLegacyFittedNarrowGatesForInternalEval();
});
