import { describe, expect, it } from "vitest";
import { TsAnalyzer } from "../src/core/parsing/tsAnalyzer.js";

describe("TsAnalyzer control flow", () => {
  it("builds correct true/false/next edges for if, else-if, and sequential guards", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.ts",
        content: [
          "function render(frontendDynamicTimingOverride: string | null, isPaidUser: boolean) {",
          "  if (frontendDynamicTimingOverride !== null) {",
          "    if (isPaidUser) {",
          "      const x = 1;",
          "    }",
          "  } else if (isPaidUser) {",
          "    const y = 2;",
          "  }",
          "}",
          "",
          "function auth(user: { status: number } | null) {",
          "  if (!user) {",
          "    throw new Error('404');",
          "  }",
          "  if (user.status === -2) {",
          "    throw new Error('403');",
          "  }",
          "}",
          "",
          "function toy(flag: boolean) {",
          "  if (true) {",
          "    console.log('caca');",
          "  }",
          "  if (flag) {",
          "    return 1;",
          "  }",
          "}",
          "",
          "function toy2(dayOfWeek: string) {",
          "  if (Math.random() > 0.5) {",
          "    console.log('caca');",
          "  }",
          "  if (dayOfWeek === 'Tuesday') {",
          "    console.log('nice');",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const byStart = new Map<number, string>();
    for (const node of branchNodes) {
      if (node.startLine) {
        byStart.set(node.startLine, node.id);
      }
    }

    const if2 = byStart.get(2);
    const nestedIf3 = byStart.get(3);
    const elif6 = byStart.get(6);
    const if12 = byStart.get(12);
    const throw13 = byStart.get(13);
    const if15 = byStart.get(15);
    const throw16 = byStart.get(16);
    const toyIf21 = byStart.get(21);
    const toyPrint22 = byStart.get(22);
    const toyIf24 = byStart.get(24);
    const toy2If30 = byStart.get(30);
    const toy2Print31 = byStart.get(31);
    const toy2If33 = byStart.get(33);

    expect(if2).toBeTruthy();
    expect(nestedIf3).toBeTruthy();
    expect(elif6).toBeTruthy();
    expect(if12).toBeTruthy();
    expect(throw13).toBeTruthy();
    expect(if15).toBeTruthy();
    expect(throw16).toBeTruthy();
    expect(toyIf21).toBeTruthy();
    expect(toyPrint22).toBeTruthy();
    expect(toyIf24).toBeTruthy();
    expect(toy2If30).toBeTruthy();
    expect(toy2Print31).toBeTruthy();
    expect(toy2If33).toBeTruthy();

    const flowEdges = graph.edges.filter((edge) => edge.kind === "CALLS");
    const hasEdge = (source: string, target: string, flowType: "true" | "false" | "next"): boolean =>
      flowEdges.some(
        (edge) => edge.source === source
          && edge.target === target
          && (edge.metadata?.flowType as string | undefined) === flowType,
      );

    expect(hasEdge(if2!, nestedIf3!, "true")).toBe(true);
    expect(hasEdge(if2!, elif6!, "false")).toBe(true);
    expect(hasEdge(if12!, throw13!, "true")).toBe(true);
    expect(hasEdge(if12!, if15!, "false")).toBe(true);
    expect(hasEdge(if15!, throw16!, "true")).toBe(true);
    expect(hasEdge(toyIf21!, toyPrint22!, "true")).toBe(true);
    expect(hasEdge(toyIf21!, toyIf24!, "next")).toBe(true);
    expect(hasEdge(toyPrint22!, toyIf24!, "next")).toBe(false);
    expect(hasEdge(toyIf21!, toyIf24!, "false")).toBe(false);
    expect(hasEdge(toy2If30!, toy2If33!, "next")).toBe(true);
    expect(hasEdge(toy2Print31!, toy2If33!, "next")).toBe(false);
  });

  it("applies the same flow semantics for plain JavaScript files", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.js",
        content: [
          "function demo(flag, other) {",
          "  if (flag) {",
          "    console.log('x');",
          "  }",
          "  if (other) {",
          "    return 1;",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const byStart = new Map<number, string>();
    for (const node of branchNodes) {
      if (node.startLine) {
        byStart.set(node.startLine, node.id);
      }
    }

    const if2 = byStart.get(2);
    const call3 = byStart.get(3);
    const if5 = byStart.get(5);

    expect(if2).toBeTruthy();
    expect(call3).toBeTruthy();
    expect(if5).toBeTruthy();

    const flowEdges = graph.edges.filter((edge) => edge.kind === "CALLS");
    const hasEdge = (source: string, target: string, flowType: "true" | "false" | "next"): boolean =>
      flowEdges.some(
        (edge) => edge.source === source
          && edge.target === target
          && (edge.metadata?.flowType as string | undefined) === flowType,
      );

    expect(hasEdge(if2!, call3!, "true")).toBe(true);
    expect(hasEdge(if2!, if5!, "next")).toBe(true);
    expect(hasEdge(call3!, if5!, "next")).toBe(false);
  });

  it("keeps branch node ids unique across repeated deep functions (e.g. multiple useMemo blocks)", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.tsx",
        content: [
          "function Panel(a: boolean, b: boolean) {",
          "  useMemo(() => {",
          "    if (a) {",
          "      return 1;",
          "    }",
          "    return 2;",
          "  }, [a]);",
          "",
          "  useMemo(() => {",
          "    if (b) {",
          "      return 3;",
          "    }",
          "    return 4;",
          "  }, [b]);",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const branchIds = branchNodes.map((node) => node.id);
    expect(new Set(branchIds).size).toBe(branchIds.length);

    const branchStarts = new Set(branchNodes.map((node) => node.startLine));
    expect(branchStarts.has(3)).toBe(true);
    expect(branchStarts.has(10)).toBe(true);
  });

  it("ignores whitespace-only edits in signatures and keeps multiline if snippets readable", async () => {
    const analyzer = new TsAnalyzer();
    const oldGraph = await analyzer.analyze("repo", "old", "ref", [
      {
        path: "sample.ts",
        content: [
          "function demo(flag: boolean, retries: number) {",
          "  if (",
          "    flag &&",
          "    retries > 0",
          "  ) {",
          "    return retries;",
          "  }",
          "  return 0;",
          "}",
          "",
        ].join("\n"),
      },
    ]);
    const newGraph = await analyzer.analyze("repo", "new", "ref", [
      {
        path: "sample.ts",
        content: [
          "function demo( flag:boolean,retries:number ){",
          "if(flag&&retries>0){",
          "return retries;",
          "}",
          "return 0;",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const oldFn = oldGraph.nodes.find((node) => node.kind === "Function" && node.name === "demo");
    const newFn = newGraph.nodes.find((node) => node.kind === "Function" && node.name === "demo");
    expect(oldFn?.signatureHash).toBeTruthy();
    expect(newFn?.signatureHash).toBeTruthy();
    expect(oldFn?.signatureHash).toBe(newFn?.signatureHash);

    const oldIf = oldGraph.nodes.find(
      (node) => node.kind === "Branch" && (node.metadata?.branchType as string | undefined) === "if",
    );
    const newIf = newGraph.nodes.find(
      (node) => node.kind === "Branch" && (node.metadata?.branchType as string | undefined) === "if",
    );
    expect(oldIf?.signatureHash).toBe(newIf?.signatureHash);
    expect((oldIf?.metadata?.codeSnippet as string | undefined) ?? "").toBe("if (flag && retries > 0)");
  });
});
