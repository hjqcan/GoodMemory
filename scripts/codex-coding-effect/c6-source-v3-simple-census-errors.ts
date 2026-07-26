export interface C6SourceV3SimpleFailureChainTip {
  bytes: number;
  path: string;
  sha256: string;
}

export class C6SourceV3SimpleProactivePauseExceededError
  extends Error {
  readonly chainTip: C6SourceV3SimpleFailureChainTip;

  constructor(
    chainTip: C6SourceV3SimpleFailureChainTip,
  ) {
    super(
      "C6 source-v3-simple verified proactive pause exceeds maximum",
    );
    this.name =
      "C6SourceV3SimpleProactivePauseExceededError";
    this.chainTip = chainTip;
  }
}

export class C6SourceV3SimpleSecretLeakError
  extends Error {
  constructor() {
    super("C6 source-v3-simple secret leak detected");
    this.name = "C6SourceV3SimpleSecretLeakError";
  }
}

export class C6SourceV3SimpleTwoPassMismatchError
  extends Error {
  readonly chainTip: C6SourceV3SimpleFailureChainTip;

  constructor(
    chainTip: C6SourceV3SimpleFailureChainTip,
  ) {
    super(
      "C6 source-v3-simple verified pass projection mismatch",
    );
    this.name =
      "C6SourceV3SimpleTwoPassMismatchError";
    this.chainTip = chainTip;
  }
}
