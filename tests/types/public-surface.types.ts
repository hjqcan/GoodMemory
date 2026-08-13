// @ts-expect-error Root barrel no longer exports raw repository assembly types.
type RootMemoryRepositories = import("../../src").MemoryRepositories;

// @ts-expect-error Root barrel no longer exports raw repository assembly config.
type RootMemoryRepositoriesConfig = import("../../src").MemoryRepositoriesConfig;

// @ts-expect-error Root barrel no longer exports raw repository assembly.
type RootCreateMemoryRepositories = typeof import("../../src").createMemoryRepositories;

// @ts-expect-error Root barrel no longer exports direct recall-engine assembly.
type RootCreateRecallEngine = typeof import("../../src").createRecallEngine;

// @ts-expect-error Root barrel no longer exports direct remember-engine assembly.
type RootCreateRememberEngine = typeof import("../../src").createRememberEngine;

// @ts-expect-error Root barrel no longer exports direct recall-engine config.
type RootRecallEngineConfig = import("../../src").RecallEngineConfig;

// @ts-expect-error Root barrel no longer exports internal recall-engine results.
type RootInternalRecallResult = import("../../src").InternalRecallResult;

// @ts-expect-error Root barrel must not expose internal evolution contracts.
type RootLearningProposal = import("../../src").LearningProposal;

// @ts-expect-error Root barrel must not expose internal promotion contracts.
type RootPromotionRecord = import("../../src").PromotionRecord;

// @ts-expect-error Root barrel must not expose internal archive contracts.
type RootSessionArchive = import("../../src").SessionArchive;

// @ts-expect-error Root barrel must not expose internal proposal constructors.
type RootCreateLearningProposal = typeof import("../../src").createLearningProposal;

// @ts-expect-error Root barrel must not expose internal promotion constructors.
type RootCreatePromotionRecord = typeof import("../../src").createPromotionRecord;

// @ts-expect-error Root barrel must not expose internal archive constructors.
type RootCreateSessionArchive = typeof import("../../src").createSessionArchive;

type PublicDurableOptOutTargetSelector =
  import("../../src").DurableOptOutTargetSelector;
type PublicGoodMemoryPolicyHooks = import("../../src").GoodMemoryPolicyHooks;
type PublicPolicyRedactionResult = Awaited<ReturnType<
  NonNullable<PublicGoodMemoryPolicyHooks["redact"]>
>>;
const publicPolicyRedactionResult = null as unknown as PublicPolicyRedactionResult;
const publicPolicyRedactionCandidateId: string = publicPolicyRedactionResult.id;
const publicDurableOptOutTargetSelector = {
  identities: [{ slot: "profile:name", value: "Lin" }],
  match: "exact",
  text: "name=Lin",
} satisfies PublicDurableOptOutTargetSelector;
const legacyDurableOptOutTargetSelectorShape = {
  identity: { slot: "profile:name", value: "Lin" },
  match: "exact" as const,
  text: "name=Lin",
};
const legacyDurableOptOutTargetSelector: PublicDurableOptOutTargetSelector =
  legacyDurableOptOutTargetSelectorShape;

void (0 as unknown as RootMemoryRepositories);
void (0 as unknown as RootMemoryRepositoriesConfig);
void (0 as unknown as RootCreateMemoryRepositories);
void (0 as unknown as RootCreateRecallEngine);
void (0 as unknown as RootCreateRememberEngine);
void (0 as unknown as RootRecallEngineConfig);
void (0 as unknown as RootInternalRecallResult);
void (0 as unknown as RootLearningProposal);
void (0 as unknown as RootPromotionRecord);
void (0 as unknown as RootSessionArchive);
void (0 as unknown as RootCreateLearningProposal);
void (0 as unknown as RootCreatePromotionRecord);
void (0 as unknown as RootCreateSessionArchive);
void publicDurableOptOutTargetSelector;
void legacyDurableOptOutTargetSelector;
void publicPolicyRedactionCandidateId;
