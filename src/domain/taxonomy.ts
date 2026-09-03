export type MemoryPlane =
  | "runtime"
  | "semantic"
  | "episodic"
  | "procedural"
  | "derived";

export type MemoryKind =
  | "session_buffer"
  | "working_memory"
  | "session_journal"
  | "artifact_spill"
  | "profile"
  | "preference"
  | "fact"
  | "reference"
  | "note"
  | "episode"
  | "decision"
  | "open_loop"
  | "feedback"
  | "insight";

export const MEMORY_KIND_TO_PLANE: Record<MemoryKind, MemoryPlane> = {
  session_buffer: "runtime",
  working_memory: "runtime",
  session_journal: "runtime",
  artifact_spill: "runtime",
  profile: "semantic",
  preference: "semantic",
  fact: "semantic",
  reference: "semantic",
  note: "semantic",
  episode: "episodic",
  decision: "episodic",
  open_loop: "episodic",
  feedback: "procedural",
  insight: "derived",
};

export function isMemoryKind(value: string): value is MemoryKind {
  return value in MEMORY_KIND_TO_PLANE;
}

export function getMemoryPlane(kind: MemoryKind): MemoryPlane {
  const plane = MEMORY_KIND_TO_PLANE[kind];

  if (!plane) {
    throw new Error(`Unknown memory kind: ${kind}`);
  }

  return plane;
}
