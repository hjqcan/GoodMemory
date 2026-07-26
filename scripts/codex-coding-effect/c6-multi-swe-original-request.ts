import { createHash } from "node:crypto";

import { z } from "zod";

export const C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY =
  "resolved-issues-only-sorted-lf-trim-v1" as const;

const issueSchema = z.object({
  body: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
}).strict();
const rowSchema = z.object({
  body: z.string(),
  resolved_issues: z.array(issueSchema).min(1),
  title: z.string(),
}).passthrough();

export interface C6MultiSWEOriginalRequest {
  originalRequest: string;
  originalRequestSha256: string;
  policy: typeof C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY;
  resolvedIssueRecordSha256: string;
  resolvedIssues: C6MultiSWEResolvedIssue[];
  sourcePullTitleBodyExcluded: true;
}

export interface C6MultiSWEResolvedIssue {
  body: string;
  number: number;
  title: string;
}

export function constructC6MultiSWEOriginalRequest(
  input: unknown,
): C6MultiSWEOriginalRequest {
  const row = rowSchema.parse(input);
  const issues = row.resolved_issues
    .map((issue) => ({
      body: normalize(issue.body),
      number: issue.number,
      title: normalize(issue.title),
    }))
    .sort((left, right) => left.number - right.number);
  if (
    issues.some((issue) =>
      issue.body.length === 0 || issue.title.length === 0
    ) ||
    new Set(issues.map((issue) => issue.number)).size !== issues.length
  ) {
    throw new Error(
      "C6 Multi-SWE original request requires unique non-blank resolved issues",
    );
  }
  const originalRequest = issues
    .map((issue) =>
      `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`
    )
    .join("\n\n---\n\n");
  return {
    originalRequest,
    originalRequestSha256: sha256(originalRequest),
    policy: C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY,
    resolvedIssueRecordSha256: sha256(JSON.stringify(issues)),
    resolvedIssues: issues,
    sourcePullTitleBodyExcluded: true,
  };
}

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
