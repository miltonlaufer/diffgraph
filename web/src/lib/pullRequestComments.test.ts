import { describe, expect, it } from "vitest";
import type { PullRequestReviewThread } from "#/api";
import {
  buildLineThreadIndex,
  buildNodeThreadIndex,
  resolveThreadLineRange,
} from "./pullRequestComments";

const createThread = (thread: Partial<PullRequestReviewThread>): PullRequestReviewThread => ({
  id: thread.id ?? "thread-1",
  filePath: thread.filePath ?? "src/example.ts",
  side: thread.side ?? "new",
  startSide: thread.startSide ?? "new",
  line: thread.line,
  startLine: thread.startLine,
  originalLine: thread.originalLine,
  originalStartLine: thread.originalStartLine,
  resolved: thread.resolved ?? false,
  outdated: thread.outdated ?? false,
  comments: thread.comments ?? [],
  url: thread.url,
});

describe("pullRequestComments helpers", () => {
  it("resolves thread range on new side from line and startLine", () => {
    const thread = createThread({ line: 20, startLine: 18 });
    expect(resolveThreadLineRange(thread, "new")).toEqual({ start: 18, end: 20 });
  });

  it("resolves thread range on old side from original lines", () => {
    const thread = createThread({
      side: "old",
      startSide: "old",
      line: 40,
      startLine: 38,
      originalLine: 30,
      originalStartLine: 28,
    });
    expect(resolveThreadLineRange(thread, "old")).toEqual({ start: 28, end: 30 });
  });

  it("builds per-line thread index for a file and side", () => {
    const threads = [
      createThread({ id: "a", filePath: "src/example.ts", line: 7, startLine: 6 }),
      createThread({ id: "b", filePath: "src/example.ts", line: 7, startLine: 7 }),
      createThread({ id: "c", filePath: "src/other.ts", line: 7, startLine: 7 }),
    ];
    const lineIndex = buildLineThreadIndex(threads, "src/example.ts", "new");
    expect(lineIndex.get(6)).toEqual(["a"]);
    expect(lineIndex.get(7)).toEqual(["a", "b"]);
    expect(lineIndex.get(8)).toBeUndefined();
  });

  it("builds per-node thread index based on file path and range overlap", () => {
    const threads = [
      createThread({ id: "a", filePath: "src/example.ts", line: 12, startLine: 11 }),
      createThread({ id: "b", filePath: "src/example.ts", line: 30, startLine: 30 }),
      createThread({ id: "c", filePath: "src/other.ts", line: 12, startLine: 12 }),
    ];
    const nodes = [
      { id: "n1", filePath: "src/example.ts", startLine: 10, endLine: 12 },
      { id: "n2", filePath: "src/example.ts", startLine: 20, endLine: 25 },
      { id: "n3", filePath: "src/example.ts", startLine: 30, endLine: 31 },
    ];
    const nodeIndex = buildNodeThreadIndex(threads, nodes, "new");
    expect(nodeIndex.get("n1")).toEqual(["a"]);
    expect(nodeIndex.get("n2")).toBeUndefined();
    expect(nodeIndex.get("n3")).toEqual(["b"]);
  });

  it("matches line threads through old/new path aliases", () => {
    const threads = [
      createThread({
        id: "rename-thread",
        filePath: "host/controllers/audio_analysis_controller.py",
        line: 73,
        startLine: 73,
      }),
    ];
    const lineIndex = buildLineThreadIndex(
      threads,
      "audio_analysis/app/controllers/audio_analysis_controller.py",
      "new",
      ["host/controllers/audio_analysis_controller.py"],
    );
    expect(lineIndex.get(73)).toEqual(["rename-thread"]);
  });

  it("matches node threads through path alias map", () => {
    const threads = [
      createThread({
        id: "rename-thread",
        filePath: "host/controllers/audio_analysis_controller.py",
        line: 73,
        startLine: 73,
      }),
    ];
    const nodes = [
      {
        id: "node-1",
        filePath: "audio_analysis/app/controllers/audio_analysis_controller.py",
        startLine: 70,
        endLine: 75,
      },
    ];
    const pathAliasesByPath = new Map<string, string[]>([
      [
        "audio_analysis/app/controllers/audio_analysis_controller.py",
        ["host/controllers/audio_analysis_controller.py"],
      ],
    ]);
    const nodeIndex = buildNodeThreadIndex(threads, nodes, "new", pathAliasesByPath);
    expect(nodeIndex.get("node-1")).toEqual(["rename-thread"]);
  });
});
