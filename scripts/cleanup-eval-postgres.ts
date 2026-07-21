import {
  cleanupEvalPostgresSchemas,
  DEFAULT_EVAL_POSTGRES_RETENTION_DAYS,
} from "../src/eval/postgresRetention";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";

export interface CleanupEvalPostgresOptions {
  apply: boolean;
  retentionDays: number;
}

export function parseCleanupEvalPostgresOptions(
  argv: readonly string[],
): CleanupEvalPostgresOptions {
  const retentionDaysValue = resolveCliFlagValueStrict(
    argv,
    "--retention-days",
  );
  const retentionDays = retentionDaysValue === undefined
    ? DEFAULT_EVAL_POSTGRES_RETENTION_DAYS
    : Number(retentionDaysValue);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("--retention-days must be a positive integer");
  }

  return {
    apply: hasCliFlagStrict(argv, "--apply"),
    retentionDays,
  };
}

export async function runCleanupEvalPostgres(
  options: CleanupEvalPostgresOptions,
  env: Record<string, string | undefined> = process.env,
) {
  const url = env.GOODMEMORY_TEST_POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "Eval Postgres cleanup requires GOODMEMORY_TEST_POSTGRES_URL",
    );
  }

  return cleanupEvalPostgresSchemas({
    apply: options.apply,
    retentionDays: options.retentionDays,
    url,
  });
}

if (import.meta.main) {
  const report = await runCleanupEvalPostgres(
    parseCleanupEvalPostgresOptions(Bun.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}
