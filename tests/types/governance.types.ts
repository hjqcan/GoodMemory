import type {
  DeleteAllMemoryInput,
  ExportMemoryInput,
  GoodMemory,
  RecallInput,
} from "../../src";

declare const memory: GoodMemory;

const exportInput: ExportMemoryInput = {
  locale: "ja-JP",
  scope: { userId: "user-1" },
};

const deleteInput: DeleteAllMemoryInput = {
  scope: { userId: "user-1" },
};

const resumeDeleteInput: DeleteAllMemoryInput = {
  resumeInterrupted: {
    confirmPriorRuntimesStopped: true,
  },
  scope: { userId: "user-1" },
};

const recallInput: RecallInput = {
  scope: { userId: "user-1" },
  query: "answer the user",
  ignoreMemory: true,
  strategy: "hybrid",
};

void memory.exportMemory(exportInput);
void memory.deleteAllMemory(deleteInput);
void memory.deleteAllMemory(resumeDeleteInput);
void memory.recall(recallInput);

async function assertGovernanceShapes() {
  const exported = await memory.exportMemory(exportInput);
  const deleted = await memory.deleteAllMemory(deleteInput);
  const feedback = await memory.feedback({
    scope: { userId: "user-1" },
    signal: "Use bullet points in summaries.",
  });

  void exported.durable.archives;
  void exported.durable.evidence;
  void exported.durable.experiences;
  void exported.durable.proposals;
  void exported.durable.promotions;
  void exported.artifacts.rootPath;
  void exported.artifacts.files[0]?.relativePath;
  void deleted.deleted.archives;
  void deleted.deleted.evidence;
  void deleted.deleted.experiences;
  void deleted.deleted.proposals;
  void deleted.deleted.promotions;
  void feedback.proposalReceipts;
  void feedback.promotionReceipts;
}

void assertGovernanceShapes();
