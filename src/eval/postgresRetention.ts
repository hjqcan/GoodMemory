import { createHash, randomUUID } from "node:crypto";

import { SQL } from "bun";

export const DEFAULT_EVAL_POSTGRES_RETENTION_DAYS = 7;
export const EVAL_POSTGRES_SCHEMA_PREFIX = "gm_eval_";

const SCHEMA_COMMENT_PREFIX = "goodmemory-eval:v1:";
const POSTGRES_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/u;

export type EvalPostgresSchemaStatus = "failed" | "retained" | "running";

export interface EvalPostgresSchemaMetadata {
  attemptId: string;
  benchmark: string;
  createdAt: string;
  runId: string;
  schemaVersion: 1;
  status: EvalPostgresSchemaStatus;
  updatedAt: string;
}

export interface EvalPostgresSchemaSnapshot {
  active: boolean;
  bytes: number;
  metadata: EvalPostgresSchemaMetadata | null;
  schema: string;
}

export interface EvalPostgresRetentionDecision {
  action: "delete" | "ignore" | "keep";
  bytes: number;
  metadata: EvalPostgresSchemaMetadata | null;
  reason:
    | "active-run"
    | "retention-expired"
    | "unmarked-schema"
    | "within-retention-window";
  schema: string;
}

export interface EvalPostgresRunLease {
  schema: string;
  drop(): Promise<void>;
  retain(status: "failed" | "retained"): Promise<void>;
}

export interface EvalPostgresCleanupReport {
  applied: boolean;
  decisions: EvalPostgresRetentionDecision[];
  deletedSchemas: string[];
  plannedReclaimBytes: number;
  retentionDays: number;
}

interface EvalSchemaRow {
  bytes: string | number;
  comment: string | null;
  schema: string;
}

interface AdvisoryLockRow {
  locked: boolean;
}

function normalizeBenchmark(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 24);
  return normalized || "benchmark";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSchemaStatus(value: unknown): value is EvalPostgresSchemaStatus {
  return value === "failed" || value === "retained" || value === "running";
}

function quoteIdentifier(identifier: string): string {
  if (!POSTGRES_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid eval Postgres schema identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function tryLock(sql: SQL, key: string): Promise<boolean> {
  const rows = await sql.unsafe<AdvisoryLockRow[]>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
    [key],
  );
  return rows[0]?.locked === true;
}

async function unlock(sql: SQL, key: string): Promise<void> {
  await sql.unsafe(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    [key],
  );
}

async function writeSchemaComment(
  sql: SQL,
  schema: string,
  metadata: EvalPostgresSchemaMetadata,
): Promise<void> {
  await sql.unsafe(
    `COMMENT ON SCHEMA ${quoteIdentifier(schema)} IS ${quoteLiteral(
      serializeEvalPostgresSchemaComment(metadata),
    )}`,
  );
}

export function buildEvalPostgresSchemaName(input: {
  attemptId: string;
  benchmark: string;
  runId: string;
}): string {
  const benchmark = normalizeBenchmark(input.benchmark);
  const digest = createHash("sha256")
    .update(`${input.benchmark}\0${input.runId}\0${input.attemptId}`)
    .digest("hex")
    .slice(0, 16);
  return `${EVAL_POSTGRES_SCHEMA_PREFIX}${benchmark}_${digest}`;
}

export function isEvalPostgresSchemaMetadataBound(
  schema: string,
  metadata: EvalPostgresSchemaMetadata,
): boolean {
  return buildEvalPostgresSchemaName(metadata) === schema;
}

export function serializeEvalPostgresSchemaComment(
  metadata: EvalPostgresSchemaMetadata,
): string {
  return `${SCHEMA_COMMENT_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseEvalPostgresSchemaComment(
  comment: string | null | undefined,
): EvalPostgresSchemaMetadata | null {
  if (!comment?.startsWith(SCHEMA_COMMENT_PREFIX)) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(comment.slice(SCHEMA_COMMENT_PREFIX.length));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.attemptId !== "string" ||
    record.attemptId.length === 0 ||
    typeof record.benchmark !== "string" ||
    record.benchmark.length === 0 ||
    typeof record.runId !== "string" ||
    record.runId.length === 0 ||
    !isIsoDate(record.createdAt) ||
    !isIsoDate(record.updatedAt) ||
    !isSchemaStatus(record.status)
  ) {
    return null;
  }

  return {
    attemptId: record.attemptId,
    benchmark: record.benchmark,
    createdAt: record.createdAt,
    runId: record.runId,
    schemaVersion: 1,
    status: record.status,
    updatedAt: record.updatedAt,
  };
}

export function planEvalPostgresRetention(input: {
  now?: Date;
  retentionDays?: number;
  schemas: readonly EvalPostgresSchemaSnapshot[];
}): EvalPostgresRetentionDecision[] {
  const retentionDays =
    input.retentionDays ?? DEFAULT_EVAL_POSTGRES_RETENTION_DAYS;
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Eval Postgres retentionDays must be a positive integer");
  }
  const cutoff =
    (input.now ?? new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000;

  return input.schemas.map((snapshot) => {
    if (!snapshot.metadata) {
      return {
        action: "ignore",
        bytes: snapshot.bytes,
        metadata: null,
        reason: "unmarked-schema",
        schema: snapshot.schema,
      };
    }
    if (snapshot.active) {
      return {
        action: "keep",
        bytes: snapshot.bytes,
        metadata: snapshot.metadata,
        reason: "active-run",
        schema: snapshot.schema,
      };
    }
    if (Date.parse(snapshot.metadata.updatedAt) <= cutoff) {
      return {
        action: "delete",
        bytes: snapshot.bytes,
        metadata: snapshot.metadata,
        reason: "retention-expired",
        schema: snapshot.schema,
      };
    }
    return {
      action: "keep",
      bytes: snapshot.bytes,
      metadata: snapshot.metadata,
      reason: "within-retention-window",
      schema: snapshot.schema,
    };
  });
}

export async function beginEvalPostgresRun(input: {
  attemptId?: string;
  benchmark: string;
  now?: () => Date;
  runId: string;
  url: string;
}): Promise<EvalPostgresRunLease> {
  const now = input.now ?? (() => new Date());
  await cleanupEvalPostgresSchemas({
    apply: true,
    now: now(),
    url: input.url,
  });

  const attemptId = input.attemptId ?? randomUUID();
  const schema = buildEvalPostgresSchemaName({ ...input, attemptId });
  const pool = new SQL(input.url, { max: 1, prepare: false });
  const sql = await pool.reserve();
  const createdAt = now().toISOString();
  const runLockKey = `goodmemory-eval-run:${input.benchmark}:${input.runId}`;
  let runLocked = false;
  let schemaLocked = false;
  let schemaCreated = false;
  let released = false;

  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    try {
      if (schemaLocked) {
        await unlock(sql, schema);
      }
      if (runLocked) {
        await unlock(sql, runLockKey);
      }
    } finally {
      sql.release();
      await pool.close();
    }
  };

  try {
    runLocked = await tryLock(sql, runLockKey);
    if (!runLocked) {
      throw new Error(
        `Eval Postgres run is already active: ${input.benchmark}/${input.runId}`,
      );
    }
    schemaLocked = await tryLock(sql, schema);
    if (!schemaLocked) {
      throw new Error(`Eval Postgres schema is already active: ${schema}`);
    }
    await sql.unsafe(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    await writeSchemaComment(sql, schema, {
      attemptId,
      benchmark: input.benchmark,
      createdAt,
      runId: input.runId,
      schemaVersion: 1,
      status: "running",
      updatedAt: createdAt,
    });
  } catch (error) {
    if (schemaCreated) {
      try {
        await sql.unsafe(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
      } catch (cleanupError) {
        console.error(
          `[eval-postgres-retention] failed to remove incomplete schema ${schema}`,
          cleanupError,
        );
      }
    }
    try {
      await release();
    } catch (releaseError) {
      console.error(
        `[eval-postgres-retention] failed to release initialization locks for ${schema}`,
        releaseError,
      );
    }
    throw error;
  }

  return {
    schema,
    async drop() {
      try {
        await sql.unsafe(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await release();
      }
    },
    async retain(status) {
      try {
        const timestamp = now().toISOString();
        await writeSchemaComment(sql, schema, {
          attemptId,
          benchmark: input.benchmark,
          createdAt,
          runId: input.runId,
          schemaVersion: 1,
          status,
          updatedAt: timestamp,
        });
      } finally {
        await release();
      }
    },
  };
}

export async function withEvalPostgresRunRetention<
  TResult extends { summary: { executionFailures: number } },
>(input: {
  lease: EvalPostgresRunLease;
  retain?: boolean;
  run: () => Promise<TResult>;
  verify?: (result: TResult) => Promise<void>;
}): Promise<TResult> {
  const retainFailedRun = async (error: unknown): Promise<never> => {
    try {
      await input.lease.retain("failed");
    } catch (retentionError) {
      console.error(
        `[eval-postgres-retention] failed to retain ${input.lease.schema} after the evaluation failed`,
        retentionError,
      );
    }
    throw error;
  };

  let result: TResult;
  try {
    result = await input.run();
  } catch (error) {
    return retainFailedRun(error);
  }
  if (input.retain) {
    await input.lease.retain("retained");
  } else if (result.summary.executionFailures > 0) {
    await input.lease.retain("failed");
  } else {
    if (!input.verify) {
      return retainFailedRun(
        new Error(
          "Eval Postgres success cleanup requires final report verification",
        ),
      );
    }
    try {
      await input.verify(result);
    } catch (error) {
      return retainFailedRun(error);
    }
    await input.lease.drop();
  }
  return result;
}

export async function cleanupEvalPostgresSchemas(input: {
  apply?: boolean;
  now?: Date;
  onlySchemas?: readonly string[];
  retentionDays?: number;
  url: string;
}): Promise<EvalPostgresCleanupReport> {
  const retentionDays =
    input.retentionDays ?? DEFAULT_EVAL_POSTGRES_RETENTION_DAYS;
  const pool = new SQL(input.url, { max: 1, prepare: false });
  const sql = await pool.reserve();
  const lockedSchemas = new Set<string>();

  try {
    const rows = await sql.unsafe<EvalSchemaRow[]>(`
      SELECT
        n.nspname AS schema,
        obj_description(n.oid, 'pg_namespace') AS comment,
        COALESCE(
          SUM(
            CASE
              WHEN c.relkind IN ('r', 'm') THEN pg_total_relation_size(c.oid)
              ELSE 0
            END
          ),
          0
        )::text AS bytes
      FROM pg_namespace n
      LEFT JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname LIKE 'gm\\_eval\\_%' ESCAPE '\\'
      GROUP BY n.oid, n.nspname
      ORDER BY n.nspname
    `);
    const onlySchemas = input.onlySchemas
      ? new Set(input.onlySchemas)
      : null;
    const snapshots: EvalPostgresSchemaSnapshot[] = [];
    for (const row of rows) {
      if (onlySchemas && !onlySchemas.has(row.schema)) {
        continue;
      }
      const metadata = parseEvalPostgresSchemaComment(row.comment);
      if (!metadata) {
        snapshots.push({
          active: false,
          bytes: Number(row.bytes),
          metadata: null,
          schema: row.schema,
        });
        continue;
      }

      const boundMetadata =
        metadata && isEvalPostgresSchemaMetadataBound(row.schema, metadata)
          ? metadata
          : null;
      if (!boundMetadata) {
        snapshots.push({
          active: false,
          bytes: Number(row.bytes),
          metadata: null,
          schema: row.schema,
        });
        continue;
      }

      const locked = await tryLock(sql, row.schema);
      if (locked) {
        lockedSchemas.add(row.schema);
      }
      snapshots.push({
        active: !locked,
        bytes: Number(row.bytes),
        metadata: boundMetadata,
        schema: row.schema,
      });
    }

    const decisions = planEvalPostgresRetention({
      now: input.now,
      retentionDays,
      schemas: snapshots,
    });
    const deletedSchemas: string[] = [];
    if (input.apply) {
      for (const decision of decisions) {
        if (decision.action !== "delete") {
          continue;
        }
        await sql.unsafe(
          `DROP SCHEMA ${quoteIdentifier(decision.schema)} CASCADE`,
        );
        deletedSchemas.push(decision.schema);
      }
    }

    return {
      applied: input.apply === true,
      decisions,
      deletedSchemas,
      plannedReclaimBytes: decisions
        .filter((decision) => decision.action === "delete")
        .reduce((sum, decision) => sum + decision.bytes, 0),
      retentionDays,
    };
  } finally {
    try {
      for (const schema of lockedSchemas) {
        await unlock(sql, schema);
      }
    } finally {
      sql.release();
      await pool.close();
    }
  }
}
