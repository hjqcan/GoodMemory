import type {
  Phase74ProtectionIdentityDescriptor,
} from "./phase74ProtectionEvidence";
import type {
  LoadedPhase74FrozenProtectionSuiteRunArtifact,
  Phase74ProtectionSuiteKind,
} from "./phase74ProtectionRun";

export const PHASE74_PROTECTION_BLUEPRINT_ID =
  "phase74-protection-suite-manifest-v2";

export interface Phase74ProtectionDatasetReference extends
  Phase74ProtectionIdentityDescriptor {
  path: string;
}

export interface Phase74ProtectionSuiteVerifier {
  id: string;
  kind: Phase74ProtectionSuiteKind;
  requiredMetrics: readonly string[];
  suiteId: string;
  verify(input: {
    dataset: Phase74ProtectionDatasetReference;
    datasetBytes: Uint8Array;
    run: LoadedPhase74FrozenProtectionSuiteRunArtifact;
  }): Promise<void>;
}
