import { describe, expect, it } from "vitest";
import { DiffProvider } from "../src/core/git/diffProvider.js";

describe("DiffProvider review thread fallback", () => {
  it("normalizes GraphQL review threads to the app thread shape", () => {
    const provider = new DiffProvider();
    const normalizeGraphQlReviewThread = (
      provider as unknown as {
        normalizeGraphQlReviewThread: (raw: Record<string, unknown>) => {
          filePath: string;
          side: string;
          resolved: boolean;
          comments: Array<{ id: string; author: { login: string } }>;
        } | null;
      }
    ).normalizeGraphQlReviewThread.bind(provider);

    const normalized = normalizeGraphQlReviewThread({
      id: "PRRT_123",
      path: "src/service.ts",
      line: 15,
      startLine: 14,
      originalLine: 13,
      originalStartLine: 12,
      diffSide: "RIGHT",
      startDiffSide: "RIGHT",
      isResolved: true,
      isOutdated: false,
      comments: {
        nodes: [
          {
            id: "PRRC_1",
            body: "Looks good",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:01:00Z",
            url: "https://github.com/example/repo/pull/1#discussion_r1",
            author: {
              login: "reviewer",
              avatarUrl: "https://example.com/reviewer.png",
              url: "https://github.com/reviewer",
            },
          },
        ],
      },
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.filePath).toBe("src/service.ts");
    expect(normalized?.side).toBe("new");
    expect(normalized?.resolved).toBe(true);
    expect(normalized?.comments[0]?.id).toBe("PRRC_1");
    expect(normalized?.comments[0]?.author.login).toBe("reviewer");
  });

  it("parses GitHub HTTPS remotes with embedded credentials", () => {
    const provider = new DiffProvider();
    const toGithubRepoUrl = (
      provider as unknown as {
        toGithubRepoUrl: (remoteUrl: string) => string | undefined;
      }
    ).toGithubRepoUrl.bind(provider);

    expect(toGithubRepoUrl("https://x-access-token:abc123@github.com/runpod/runpod.git")).toBe(
      "https://github.com/runpod/runpod",
    );
  });

  it("reconstructs threads from review comments linked by in_reply_to_id", () => {
    const provider = new DiffProvider();
    const buildThreadsFromReviewComments = (
      provider as unknown as {
        buildThreadsFromReviewComments: (rawComments: Array<Record<string, unknown>>) => Array<{
          id: string;
          filePath: string;
          line?: number;
          comments: Array<{ id: string; author: { login: string } }>;
        }>;
      }
    ).buildThreadsFromReviewComments.bind(provider);

    const threads = buildThreadsFromReviewComments([
      {
        id: 100,
        path: "src/app.ts",
        line: 10,
        body: "Top-level comment",
        created_at: "2025-01-01T10:00:00Z",
        user: { login: "alice", avatar_url: "https://example.com/a.png" },
      },
      {
        id: 101,
        path: "src/app.ts",
        line: 10,
        in_reply_to_id: 100,
        body: "Reply 1",
        created_at: "2025-01-01T10:01:00Z",
        user: { login: "bob", avatar_url: "https://example.com/b.png" },
      },
      {
        id: 102,
        path: "src/app.ts",
        line: 22,
        body: "Second root",
        created_at: "2025-01-01T10:02:00Z",
        user: { login: "carol", avatar_url: "https://example.com/c.png" },
      },
    ]);

    expect(threads).toHaveLength(2);
    expect(threads[0]?.id).toBe("fallback-thread-100");
    expect(threads[0]?.filePath).toBe("src/app.ts");
    expect(threads[0]?.line).toBe(10);
    expect(threads[0]?.comments.map((comment) => comment.id)).toEqual(["100", "101"]);
    expect(threads[1]?.id).toBe("fallback-thread-102");
    expect(threads[1]?.comments.map((comment) => comment.author.login)).toEqual(["carol"]);
  });
});
