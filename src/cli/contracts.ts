import type { mkdir } from "node:fs/promises";
import type { GoodMemoryConfig } from "../api/contracts";
import type { InstalledHostWritebackConfig } from "../install/hostConfigValidation";
import type { InstalledHostKind } from "../install/hostInstall";
import type { ReadOnlyPostgresStorageProbeResult } from "../storage/postgres";
import type { migratePostgresStorageBackend } from "../storage/postgresPublic";

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ParsedFlags = Record<string, string>;

export interface ParsedArgs {
  commands: string[];
  flags: ParsedFlags;
}

export interface CLIInstallPrompt {
  ask(message: string): Promise<string>;
  askSecret?: (message: string) => Promise<string>;
  close?: () => Promise<void> | void;
}

export interface CLIRunDependencies {
  interactive?: boolean;
  prompt?: CLIInstallPrompt;
  migratePostgresStorageBackend?: typeof migratePostgresStorageBackend;
  commandAvailable?: (command: string) => Promise<boolean>;
}

export interface CLIStorageResolutionDependencies {
  canBootstrapPostgresStorageBackend?: (config: { url: string }) => Promise<boolean>;
  probeReadOnlyPostgresStorageBackend?: (
    config: { url: string },
  ) => Promise<ReadOnlyPostgresStorageProbeResult>;
  mkdir?: typeof mkdir;
  pathExists?: (path: string) => Promise<boolean>;
}

export interface CLICommandOutput {
  exitCode?: number;
  json: unknown;
  text: string;
}

export interface CLIStorageConfig {
  provider: NonNullable<GoodMemoryConfig["storage"]>["provider"];
  url?: string;
  displayValue: string;
}

export interface DiagnosticMemoryOptions {
  includeVectorStore?: boolean;
  readOnlyStorage?: boolean;
}

export type InstallActivationSelection = "current-workspace" | "global" | "manual";
export type SetupHostSelection = "both" | InstalledHostKind;

export interface ResolvedInstallOptions {
  activationSelection?: InstallActivationSelection;
  flags: ParsedFlags;
  writeback?: InstalledHostWritebackConfig;
}
