import {
  parsePhase74StorageScaleGateCliOptions,
  resolvePhase74PostgresStorageScaleGateUrl,
  runPhase74PostgresStorageScaleGate,
  runPhase74StorageScaleGate,
} from "./run-phase-74-storage-scale-gate";
import type {
  Phase74PostgresStorageScaleGateReport,
  Phase74StorageScaleGateReport,
} from "./run-phase-74-storage-scale-gate";

export async function runProjectionStorageScaleGate(
  argv: readonly string[] = Bun.argv,
): Promise<
  Phase74PostgresStorageScaleGateReport | Phase74StorageScaleGateReport
> {
  const { database, ...options } = parsePhase74StorageScaleGateCliOptions(argv);
  const onProgress = (message: string): void => {
    console.error(`[projection-storage-scale] ${message}`);
  };
  return database === "postgres"
    ? await runPhase74PostgresStorageScaleGate({
        ...options,
        onProgress,
        postgresUrl: resolvePhase74PostgresStorageScaleGateUrl(),
      })
    : await runPhase74StorageScaleGate({ ...options, onProgress });
}

if (import.meta.main) {
  try {
    const report = await runProjectionStorageScaleGate();
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
