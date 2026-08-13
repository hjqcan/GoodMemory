import type { MemoryScope } from "../../src";
import type {
  ReplayFeedbackSignal,
  ReplayMemorySession,
} from "../../src/testing/scenarioReplay";

type StoredCollection =
  | "profiles"
  | "preferences"
  | "references"
  | "facts"
  | "feedback"
  | "episodes";

type RecallCollection =
  | "profile"
  | "preferences"
  | "references"
  | "facts"
  | "feedback"
  | "episodes"
  | "workingMemory"
  | "journal";

type ExpectedScalar = string | number | boolean | null;

export interface PathExpectation {
  path: string;
  equals?: ExpectedScalar;
  hasEntries?: ExpectedScalar[];
  lacksEntries?: ExpectedScalar[];
}

export interface StoredExpectation {
  collection: StoredCollection;
  scope?: Partial<MemoryScope>;
  fields: PathExpectation[];
}

export interface RecallExpectation {
  collection: RecallCollection;
  fields: PathExpectation[];
}

export interface BehaviorScenarioFixture {
  id: string;
  personaId: string;
  workspaceId?: string;
  sessions: ReplayMemorySession[];
  prompt: string;
  retrievalProfile?: "general_chat" | "coding_agent";
  feedbackSignals?: ReplayFeedbackSignal[];
  finalScope?: Partial<MemoryScope>;
  expectedRemembered: StoredExpectation[];
  expectedRecalled: RecallExpectation[];
  expectedContext: PathExpectation[];
  expectedAnswer: PathExpectation[];
}

export const behaviorScenarios: Record<string, BehaviorScenarioFixture> = {
  identityContinuity: {
    id: "identity-continuity",
    personaId: "scenario-user-identity",
    workspaceId: "workspace-identity",
    sessions: [
      {
        sessionId: "identity-s1",
        turns: [
          { role: "user", content: "My name is Lin." },
          { role: "assistant", content: "Understood." },
          {
            role: "user",
            content: "Remember that I am a robotics engineer in Shanghai leading the migration rollout.",
          },
          { role: "assistant", content: "Noted." },
        ],
      },
      {
        sessionId: "identity-s2",
        turns: [
          {
            role: "user",
            content: "I prefer concise bullet points.",
          },
          { role: "assistant", content: "Will do." },
        ],
      },
    ],
    prompt: "Before we continue the migration rollout, confirm my role and preferred response style.",
    expectedRemembered: [
      {
        collection: "profiles",
        fields: [
          { path: "identity.name", equals: "Lin" },
          { path: "identity.role", equals: "robotics engineer" },
          { path: "identity.location", equals: "Shanghai" },
        ],
      },
      {
        collection: "facts",
        scope: { workspaceId: "workspace-identity" },
        fields: [
          {
            path: "content",
            equals: "I am a robotics engineer in Shanghai leading the migration rollout.",
          },
          { path: "workspaceId", equals: "workspace-identity" },
          { path: "lifecycle", equals: "active" },
        ],
      },
      {
        collection: "preferences",
        scope: { workspaceId: "workspace-identity" },
        fields: [
          { path: "category", equals: "response_style" },
          { path: "value", equals: "concise bullet points" },
          { path: "workspaceId", equals: "workspace-identity" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "profile",
        fields: [
          { path: "identity.name", equals: "Lin" },
          { path: "identity.role", equals: "robotics engineer" },
          { path: "identity.location", equals: "Shanghai" },
        ],
      },
      {
        collection: "preferences",
        fields: [
          { path: "value", equals: "concise bullet points" },
        ],
      },
    ],
    expectedContext: [
      {
        path: "Profile",
        hasEntries: ["Lin - robotics engineer - Shanghai"],
      },
      { path: "Preferences", hasEntries: ["response_style: concise bullet points"] },
    ],
    expectedAnswer: [
      { path: "profileName", equals: "Lin" },
      { path: "profileRole", equals: "robotics engineer" },
      { path: "profileLocation", equals: "Shanghai" },
      { path: "preferences", hasEntries: ["concise bullet points"] },
    ],
  },
  openLoopContinuation: {
    id: "open-loop-continuation",
    personaId: "scenario-user-open-loop",
    workspaceId: "workspace-open-loop",
    sessions: [
      {
        sessionId: "loop-s1",
        turns: [
          {
            role: "user",
            content: "Remember that the robot rollout is blocked on step 2 of the migration runbook.",
          },
          { role: "assistant", content: "Captured." },
        ],
      },
      {
        sessionId: "loop-s2",
        turns: [
          {
            role: "user",
            content: "Remember that the remaining open loop is final verification for the robot rollout.",
          },
          { role: "assistant", content: "I will continue from there." },
        ],
      },
    ],
    prompt: "What open loop should we continue for the robot rollout?",
    expectedRemembered: [
      {
        collection: "facts",
        scope: { workspaceId: "workspace-open-loop" },
        fields: [
          {
            path: "content",
            equals: "the robot rollout is blocked on step 2 of the migration runbook.",
          },
          { path: "workspaceId", equals: "workspace-open-loop" },
        ],
      },
      {
        collection: "facts",
        scope: { workspaceId: "workspace-open-loop" },
        fields: [
          {
            path: "content",
            equals: "the remaining open loop is final verification for the robot rollout.",
          },
          { path: "workspaceId", equals: "workspace-open-loop" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "facts",
        fields: [
          {
            path: "content",
            equals: "the remaining open loop is final verification for the robot rollout.",
          },
        ],
      },
    ],
    expectedContext: [
      {
        path: "Facts",
        hasEntries: [
          "the remaining open loop is final verification for the robot rollout.",
        ],
        lacksEntries: [
          "the robot rollout is blocked on step 2 of the migration runbook.",
        ],
      },
    ],
    expectedAnswer: [
      {
        path: "factEntries",
        hasEntries: [
          "the remaining open loop is final verification for the robot rollout.",
        ],
        lacksEntries: [
          "the robot rollout is blocked on step 2 of the migration runbook.",
        ],
      },
    ],
  },
  staleReferenceCorrection: {
    id: "stale-reference-correction",
    personaId: "scenario-user-reference",
    workspaceId: "workspace-reference",
    sessions: [
      {
        sessionId: "ref-s1",
        turns: [
          {
            role: "user",
            content: "Use docs/migration-runbook-v1.md as the source of truth for migration work.",
          },
          { role: "assistant", content: "Okay." },
        ],
      },
      {
        sessionId: "ref-s2",
        turns: [
          {
            role: "user",
            content: "Correction: docs/migration-runbook-v2.md is now the source of truth, not docs/migration-runbook-v1.md. Please update that.",
          },
          { role: "assistant", content: "Updated." },
        ],
      },
    ],
    prompt: "Which runbook is the current source of truth for migration work?",
    expectedRemembered: [
      {
        collection: "references",
        scope: { workspaceId: "workspace-reference" },
        fields: [
          { path: "pointer", equals: "docs/migration-runbook-v1.md" },
          { path: "lifecycle", equals: "superseded" },
          { path: "workspaceId", equals: "workspace-reference" },
        ],
      },
      {
        collection: "references",
        scope: { workspaceId: "workspace-reference" },
        fields: [
          { path: "pointer", equals: "docs/migration-runbook-v2.md" },
          { path: "lifecycle", equals: "active" },
          { path: "workspaceId", equals: "workspace-reference" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "references",
        fields: [
          { path: "pointer", equals: "docs/migration-runbook-v2.md" },
          { path: "lifecycle", equals: "active" },
        ],
      },
    ],
    expectedContext: [
      {
        path: "References",
        hasEntries: ["migration-runbook-v2.md (docs/migration-runbook-v2.md)"],
        lacksEntries: ["migration-runbook-v1.md (docs/migration-runbook-v1.md)"],
      },
    ],
    expectedAnswer: [
      {
        path: "referencePointers",
        hasEntries: ["docs/migration-runbook-v2.md"],
        lacksEntries: ["docs/migration-runbook-v1.md"],
      },
    ],
  },
  confirmationFeedback: {
    id: "confirmation-feedback",
    personaId: "scenario-user-feedback",
    workspaceId: "workspace-feedback",
    sessions: [
      {
        sessionId: "feedback-s1",
        turns: [
          {
            role: "user",
            content: "Always keep answers concise and action-oriented.",
          },
          { role: "assistant", content: "Understood." },
        ],
      },
      {
        sessionId: "feedback-s2",
        turns: [
          {
            role: "user",
            content: "That concise bullet-point summary worked well.",
          },
          { role: "assistant", content: "I will keep it." },
        ],
      },
    ],
    feedbackSignals: [
      {
        sessionId: "feedback-s2",
        signal: "The concise bullet-point summary worked well. Keep using that format.",
      },
    ],
    prompt: "How should you format the next status update for me?",
    expectedRemembered: [
      {
        collection: "feedback",
        scope: { workspaceId: "workspace-feedback" },
        fields: [
          { path: "rule", equals: "Always keep answers concise and action-oriented." },
          { path: "workspaceId", equals: "workspace-feedback" },
          { path: "lifecycle", equals: "superseded" },
        ],
      },
      {
        collection: "feedback",
        scope: { workspaceId: "workspace-feedback" },
        fields: [
          {
            path: "rule",
            equals: "The concise bullet-point summary worked well. Keep using that format.",
          },
          { path: "workspaceId", equals: "workspace-feedback" },
          { path: "lifecycle", equals: "active" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "feedback",
        fields: [
          {
            path: "rule",
            equals: "The concise bullet-point summary worked well. Keep using that format.",
          },
        ],
      },
    ],
    expectedContext: [
      {
        path: "Procedural Memory",
        hasEntries: [
          "The concise bullet-point summary worked well. Keep using that format.",
        ],
      },
    ],
    expectedAnswer: [
      {
        path: "feedbackRules",
        hasEntries: [
          "The concise bullet-point summary worked well. Keep using that format.",
        ],
      },
    ],
  },
  longLifecycleChange: {
    id: "long-lifecycle-change",
    personaId: "scenario-user-long",
    workspaceId: "workspace-long",
    sessions: [
      {
        sessionId: "long-s1",
        turns: [
          {
            role: "user",
            content: "Remember that I am a frontend engineer shipping the design system.",
          },
          { role: "assistant", content: "Noted." },
        ],
      },
      {
        sessionId: "long-s2",
        turns: [
          {
            role: "user",
            content: "Remember that my long-term goal is to move into platform engineering leadership.",
          },
          { role: "assistant", content: "Captured." },
        ],
      },
      {
        sessionId: "long-s3",
        turns: [
          {
            role: "user",
            content: "Remember that I am still migrating shared components into the design system.",
          },
          { role: "assistant", content: "Okay." },
        ],
      },
      {
        sessionId: "long-s4",
        turns: [
          {
            role: "user",
            content: "Remember that I have now moved into a staff platform engineer role leading runtime reliability.",
          },
          { role: "assistant", content: "Updated." },
        ],
      },
      {
        sessionId: "long-s5",
        turns: [
          {
            role: "user",
            content: "Remember that my current focus is runtime reliability and platform migration, not the old component backlog.",
          },
          { role: "assistant", content: "Understood." },
        ],
      },
    ],
    prompt: "Confirm my current role and focus before we continue the platform migration.",
    expectedRemembered: [
      {
        collection: "profiles",
        fields: [
          { path: "identity.role", equals: "staff platform engineer" },
          { path: "activeContext.currentProjects", hasEntries: ["runtime reliability"] },
        ],
      },
      {
        collection: "facts",
        scope: { workspaceId: "workspace-long" },
        fields: [
          {
            path: "content",
            equals: "my current focus is runtime reliability and platform migration, not the old component backlog.",
          },
          { path: "workspaceId", equals: "workspace-long" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "profile",
        fields: [
          {
            path: "identity.role",
            equals: "staff platform engineer",
          },
        ],
      },
      {
        collection: "facts",
        fields: [
          {
            path: "content",
            equals: "my current focus is runtime reliability and platform migration, not the old component backlog.",
          },
        ],
      },
    ],
    expectedContext: [
      {
        path: "Active Context",
        hasEntries: ["Current projects: runtime reliability"],
      },
      {
        path: "Facts",
        hasEntries: [
          "my current focus is runtime reliability and platform migration, not the old component backlog.",
        ],
        lacksEntries: ["I am a frontend engineer shipping the design system."],
      },
    ],
    expectedAnswer: [
      {
        path: "profileRole",
        equals: "staff platform engineer",
      },
      {
        path: "factEntries",
        hasEntries: [
          "my current focus is runtime reliability and platform migration, not the old component backlog.",
        ],
        lacksEntries: ["I am a frontend engineer shipping the design system."],
      },
    ],
  },
  scopeIsolation: {
    id: "scope-isolation",
    personaId: "scenario-user-scope",
    sessions: [
      {
        sessionId: "scope-s1",
        scope: { workspaceId: "workspace-a" },
        turns: [
          {
            role: "user",
            content: "Use docs/payments-runbook.md as the source of truth for payments work.",
          },
          { role: "assistant", content: "Captured." },
        ],
      },
      {
        sessionId: "scope-s2",
        scope: { workspaceId: "workspace-b" },
        turns: [
          {
            role: "user",
            content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
          },
          { role: "assistant", content: "Captured." },
        ],
      },
    ],
    prompt: "Which runbook should you use for runtime work?",
    finalScope: {
      sessionId: "scope-s2",
      workspaceId: "workspace-b",
    },
    expectedRemembered: [
      {
        collection: "references",
        scope: { workspaceId: "workspace-a" },
        fields: [
          { path: "pointer", equals: "docs/payments-runbook.md" },
          { path: "workspaceId", equals: "workspace-a" },
          { path: "lifecycle", equals: "active" },
        ],
      },
      {
        collection: "references",
        scope: { workspaceId: "workspace-b" },
        fields: [
          { path: "pointer", equals: "docs/runtime-runbook.md" },
          { path: "workspaceId", equals: "workspace-b" },
          { path: "lifecycle", equals: "active" },
        ],
      },
    ],
    expectedRecalled: [
      {
        collection: "references",
        fields: [
          { path: "pointer", equals: "docs/runtime-runbook.md" },
          { path: "lifecycle", equals: "active" },
        ],
      },
    ],
    expectedContext: [
      {
        path: "References",
        hasEntries: ["runtime-runbook.md (docs/runtime-runbook.md)"],
        lacksEntries: ["payments-runbook.md (docs/payments-runbook.md)"],
      },
    ],
    expectedAnswer: [
      {
        path: "referencePointers",
        hasEntries: ["docs/runtime-runbook.md"],
        lacksEntries: ["docs/payments-runbook.md"],
      },
    ],
  },
};
