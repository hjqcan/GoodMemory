import { describe, expect, it } from "bun:test";

import {
  assertC6SourceV3SimpleRateLimitConsistency,
  buildC6SourceV3SimpleDurableGraphqlRequest,
  computeC6SourceV3SimpleProactiveNotBefore,
  computeC6SourceV3SimpleRetryNotBefore,
  deriveC6SourceV3SimpleProactivePause,
  deriveC6SourceV3SimpleRateLimitMode,
  parseC6SourceV3SimpleRetryAfter,
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";

describe("C6 source-v3-simple census transport", () => {
  it("builds exact canonical request bytes without persisting authorization", () => {
    const count =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryCount",
        variables: {
          query: "language:TypeScript created:2020-01-01",
        },
      });
    expect(count.body.toString()).toStartWith(
      "{\"operationName\":\"C6SourceV3SimpleRepositoryCount\"," +
        "\"query\":\"query C6SourceV3SimpleRepositoryCount",
    );
    expect(count.body).toHaveLength(346);
    expect(count.bodySha256).toBe(
      "b9d47486a5c08592744805fe5a04f540111405c4e46c26ed43b33d510b20ca16",
    );
    expect(count.persistedRequest.headers.authorization).toBe(
      "Bearer [REDACTED]",
    );

    const repositoryPage =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryPage",
        variables: {
          after: null,
          query: "language:TypeScript",
        },
      });
    expect(repositoryPage.body.toString()).toContain(
      "\"variables\":{\"query\":\"language:TypeScript\",\"after\":null}",
    );
    expect(repositoryPage.body).toHaveLength(724);
    expect(repositoryPage.bodySha256).toBe(
      "4d963f4cafc1bd724478fe0191991539c499ef947b9413a4017cdea6ece60db3",
    );
    const pullRequestPage =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId: "R_1",
        },
      });
    expect(pullRequestPage.body.toString()).toContain(
      "\"variables\":{\"repositoryNodeId\":\"R_1\",\"after\":null}",
    );
    expect(pullRequestPage.body).toHaveLength(1_067);
    expect(pullRequestPage.bodySha256).toBe(
      "28cf4b7c8fe9a449adf17ca47f927c442dbfa6579e8e877860dfcd97d017bbe2",
    );
  });

  it("reconstructs durable request truth from its raw body and strict projection", () => {
    const request =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryPage",
        variables: {
          after: "cursor-1",
          query: "language:TypeScript",
        },
      });
    expect(
      verifyC6SourceV3SimpleDurableGraphqlRequest({
        body: request.body,
        persistedRequest: request.persistedRequest,
      }),
    ).toEqual(request);
    expect(() =>
      verifyC6SourceV3SimpleDurableGraphqlRequest({
        body: request.body,
        persistedRequest: {
          ...request.persistedRequest,
          bodySha256: "f".repeat(64),
        },
      })
    ).toThrow("durable request mismatch");
    expect(() =>
      verifyC6SourceV3SimpleDurableGraphqlRequest({
        body: Buffer.concat([
          request.body,
          Buffer.from("\n"),
        ]),
        persistedRequest: request.persistedRequest,
      })
    ).toThrow("durable request mismatch");
  });

  it("parses bounded Retry-After values without implementation freedom", () => {
    const receivedAtMilliseconds = Date.parse(
      "2026-07-26T12:00:10Z",
    );
    expect(parseC6SourceV3SimpleRetryAfter({
      receivedAtMilliseconds,
      responseDate: "Sun, 26 Jul 2026 12:00:00 GMT",
      value: "20",
    })).toBe(Date.parse("2026-07-26T12:00:30Z"));
    expect(parseC6SourceV3SimpleRetryAfter({
      receivedAtMilliseconds,
      responseDate: "Sun, 26 Jul 2026 12:00:00 GMT",
      value: "Sun, 26 Jul 2026 12:00:40 GMT",
    })).toBe(Date.parse("2026-07-26T12:00:50Z"));
    expect(() =>
      parseC6SourceV3SimpleRetryAfter({
        receivedAtMilliseconds,
        responseDate: "Sun, 26 Jul 2026 12:00:00 GMT",
        value: "61",
      })
    ).toThrow("maximum");
    expect(() =>
      parseC6SourceV3SimpleRetryAfter({
        receivedAtMilliseconds,
        responseDate: null,
        value: "tomorrow",
      })
    ).toThrow("invalid Retry-After");
  });

  it("uses the maximum absolute retry constraint and survives restart", () => {
    const decision =
      computeC6SourceV3SimpleRetryNotBefore({
        failedAttemptNumber: 2,
        rateLimitMode: "primary",
        rateLimitResetUnixSeconds:
          Date.parse("2026-07-26T12:00:30Z") / 1_000,
        receivedAtMilliseconds: Date.parse(
          "2026-07-26T12:00:10Z",
        ),
        responseDate: "Sun, 26 Jul 2026 12:00:10 GMT",
        retryAfter: "5",
      });

    expect(decision).toEqual({
      backoffNotBefore:
        "2026-07-26T12:00:12.000Z",
      notBefore: "2026-07-26T12:00:31.000Z",
      rateLimitResetNotBefore:
        "2026-07-26T12:00:31.000Z",
      retryAfterNotBefore:
        "2026-07-26T12:00:15.000Z",
    });
  });

  it("corrects server reset time for local clock skew and derives pacing mode", () => {
    const receivedAtMilliseconds = Date.parse(
      "2026-07-26T13:00:00Z",
    );
    expect(
      computeC6SourceV3SimpleProactiveNotBefore({
        receivedAtMilliseconds,
        remaining: 49,
        resetUnixSeconds:
          Date.parse("2026-07-26T12:00:30Z") / 1_000,
        responseDate: "Sun, 26 Jul 2026 12:00:00 GMT",
      }),
    ).toBe("2026-07-26T13:00:31.000Z");
    expect(
      deriveC6SourceV3SimpleRateLimitMode({
        graphqlErrorTypes: [],
        httpStatus: 200,
        remaining: 49,
        responseBody: Buffer.from("{}"),
        retryAfter: null,
      }),
    ).toBe("proactive");
    expect(
      deriveC6SourceV3SimpleRateLimitMode({
        graphqlErrorTypes: [],
        httpStatus: 403,
        remaining: 4_000,
        responseBody: Buffer.from(
          "{\"message\":\"secondary rate limit\"}",
        ),
        retryAfter: null,
      }),
    ).toBe("secondary");
    expect(
      deriveC6SourceV3SimpleRateLimitMode({
        graphqlErrorTypes: [],
        httpStatus: 403,
        remaining: 0,
        responseBody: Buffer.from("{}"),
        retryAfter: null,
      }),
    ).toBe("primary");
  });

  it("derives the exact proactive pause maximum from the frozen transport contract", () => {
    const receivedAtMilliseconds = Date.parse(
      "2026-07-26T12:00:00Z",
    );
    const input = {
      receivedAtMilliseconds,
      remaining: 49,
      responseDate:
        "Sun, 26 Jul 2026 12:00:00 GMT",
    };
    expect(
      deriveC6SourceV3SimpleProactivePause({
        ...input,
        resetUnixSeconds:
          Date.parse(
            "2026-07-26T13:01:39Z",
          ) / 1_000,
      }),
    ).toEqual({
      exceedsMaximum: false,
      notBefore: "2026-07-26T13:01:40.000Z",
    });
    expect(
      deriveC6SourceV3SimpleProactivePause({
        ...input,
        resetUnixSeconds:
          Date.parse(
            "2026-07-26T13:01:40Z",
          ) / 1_000,
      }),
    ).toEqual({
      exceedsMaximum: true,
      notBefore: "2026-07-26T13:01:41.000Z",
    });
    expect(
      deriveC6SourceV3SimpleProactivePause({
        ...input,
        remaining: 50,
        resetUnixSeconds:
          Date.parse(
            "2026-07-26T14:00:00Z",
          ) / 1_000,
      }),
    ).toEqual({
      exceedsMaximum: false,
      notBefore: null,
    });
  });

  it("requires exact GraphQL/header rate-limit agreement", () => {
    const rateLimit = {
      cost: 1,
      limit: 5_000,
      remaining: 4_990,
      resetAt: "2026-07-26T13:00:00Z",
      used: 10,
    };
    const headers = {
      "content-type": "application/json; charset=utf-8",
      date: "Sun, 26 Jul 2026 12:00:00 GMT",
      "x-github-request-id": "ABC:123",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4990",
      "x-ratelimit-reset": String(
        Date.parse(rateLimit.resetAt) / 1_000,
      ),
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "10",
    };
    expect(
      assertC6SourceV3SimpleRateLimitConsistency({
        headers,
        rateLimit,
      }),
    ).toMatchObject({
      remaining: 4_990,
      requestId: "ABC:123",
    });
    expect(() =>
      assertC6SourceV3SimpleRateLimitConsistency({
        headers: {
          ...headers,
          "x-ratelimit-remaining": "4989",
        },
        rateLimit,
      })
    ).toThrow("rate-limit mismatch");
  });
});
