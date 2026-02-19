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

  it("names hook-wrapped callbacks by assigned variable instead of hook callee name", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.tsx",
        content: [
          "function Panel(seed: number) {",
          "  const build = useCallback((x: number) => x + seed, [seed]);",
          "  const renderText = useMemo(() => build(1), [build]);",
          "  const format = useCallback(() => renderText.toString(), [renderText]);",
          "  return format();",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const functionLikeNodes = graph.nodes.filter((node) =>
      node.kind === "Function" || node.kind === "Hook" || node.kind === "ReactComponent" || node.kind === "Method");
    const functionNames = new Set(functionLikeNodes.map((node) => node.name));

    expect(functionNames.has("build")).toBe(true);
    expect(functionNames.has("renderText")).toBe(true);
    expect(functionNames.has("format")).toBe(true);
    expect(functionNames.has("useCallback")).toBe(false);
    expect(functionNames.has("useMemo")).toBe(false);

    const byName = new Map(functionLikeNodes.map((node) => [node.name, node]));
    expect(byName.get("build")?.metadata?.wrappedBy).toBe("useCallback");
    expect(byName.get("renderText")?.metadata?.wrappedBy).toBe("useMemo");
    expect(byName.get("format")?.metadata?.wrappedBy).toBe("useCallback");
    expect(byName.get("build")?.metadata?.hookDependencies).toBe("[seed]");
    expect(byName.get("renderText")?.metadata?.hookDependencies).toBe("[build]");
    expect(byName.get("format")?.metadata?.hookDependencies).toBe("[renderText]");

    const flowEdges = graph.edges.filter((edge) => edge.kind === "CALLS");
    const hasCall = (sourceName: string, targetName: string): boolean => {
      const sourceId = byName.get(sourceName)?.id;
      const targetId = byName.get(targetName)?.id;
      if (!sourceId || !targetId) return false;
      return flowEdges.some((edge) => edge.source === sourceId && edge.target === targetId);
    };

    expect(hasCall("Panel", "build")).toBe(true);
    expect(hasCall("Panel", "format")).toBe(true);
  });

  it("keeps JSX tags visible in return-branch snippets and metadata", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.tsx",
        content: [
          "function Panel() {",
          "  return (",
          "    <section>",
          "      <Header />",
          "      <Card><Body /></Card>",
          "    </section>",
          "  );",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const returnBranch = graph.nodes.find(
      (node) => node.kind === "Branch"
        && (node.metadata?.branchType as string | undefined) === "return",
    );

    expect(returnBranch).toBeTruthy();
    expect((returnBranch?.metadata?.codeSnippet as string | undefined) ?? "").toContain("return JSX");
    expect(returnBranch?.metadata?.containsJsx).toBe(true);
    expect((returnBranch?.metadata?.jsxTagNames as string | undefined) ?? "").toContain("Header");
    expect((returnBranch?.metadata?.jsxTagNames as string | undefined) ?? "").toContain("Card");
    expect((returnBranch?.metadata?.jsxTagNames as string | undefined) ?? "").toContain("Body");
  });

  it("captures RENDERS edges for self-closing JSX tags", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.tsx",
        content: [
          "function Child() {",
          "  return <span />;",
          "}",
          "",
          "function Panel() {",
          "  return <Child />;",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const byName = new Map(
      graph.nodes
        .filter((node) => node.kind === "ReactComponent" || node.kind === "Hook" || node.kind === "Function")
        .map((node) => [node.name, node.id]),
    );

    const panelId = byName.get("Panel");
    const childId = byName.get("Child");
    expect(panelId).toBeTruthy();
    expect(childId).toBeTruthy();
    expect(
      graph.edges.some(
        (edge) => edge.kind === "RENDERS" && edge.source === panelId && edge.target === childId,
      ),
    ).toBe(true);
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

  it("includes try/catch/finally blocks and their inner flow in the logic graph", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.ts",
        content: [
          "async function demo(request: Request) {",
          "  try {",
          "    const res = await fetch(request);",
          "    if (res.ok) return res;",
          "  } catch (err) {",
          "    console.error('failed', err);",
          "  } finally {",
          "    await closeResource();",
          "  }",
          "  return request;",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const branchTypeOf = (node: { metadata?: Record<string, unknown> }): string =>
      (node.metadata?.branchType as string | undefined) ?? "";
    const byType = (type: string): Array<(typeof branchNodes)[number]> =>
      branchNodes.filter((node) => branchTypeOf(node) === type);

    const tryNode = byType("try")[0];
    const catchNode = byType("catch")[0];
    const finallyNode = byType("finally")[0];
    const callNodes = byType("call");
    const ifNode = byType("if")[0];
    const returnNodes = byType("return");

    expect(tryNode).toBeTruthy();
    expect(catchNode).toBeTruthy();
    expect(finallyNode).toBeTruthy();
    expect(callNodes.length).toBeGreaterThanOrEqual(2);
    expect(ifNode).toBeTruthy();
    expect(returnNodes.length).toBeGreaterThanOrEqual(2);

    const flowEdges = graph.edges.filter((edge) => edge.kind === "CALLS");
    const hasEdge = (source: string, target: string, flowType: "true" | "false" | "next"): boolean =>
      flowEdges.some(
        (edge) => edge.source === source
          && edge.target === target
          && (edge.metadata?.flowType as string | undefined) === flowType,
      );

    const fetchCall = callNodes.find((node) => (node.metadata?.codeSnippet as string | undefined)?.includes("fetch"));
    const consoleCall = callNodes.find((node) => (node.metadata?.codeSnippet as string | undefined)?.includes("console.error"));
    const finallyCall = callNodes.find((node) => (node.metadata?.codeSnippet as string | undefined)?.includes("closeResource"));
    const finalReturn = returnNodes.find((node) => node.startLine === 10) ?? returnNodes[returnNodes.length - 1];

    expect(fetchCall).toBeTruthy();
    expect(consoleCall).toBeTruthy();
    expect(finallyCall).toBeTruthy();
    expect(finalReturn).toBeTruthy();

    expect(hasEdge(tryNode!.id, fetchCall!.id, "next")).toBe(true);
    expect(hasEdge(tryNode!.id, catchNode!.id, "false")).toBe(true);
    expect(hasEdge(catchNode!.id, consoleCall!.id, "next")).toBe(true);
    expect(hasEdge(consoleCall!.id, finallyNode!.id, "next")).toBe(true);
    expect(hasEdge(finallyNode!.id, finallyCall!.id, "next")).toBe(true);
    expect(hasEdge(finallyCall!.id, finalReturn!.id, "next")).toBe(true);
  });

  it("classifies chained promise handlers as then/catch/finally branches", async () => {
    const analyzer = new TsAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.ts",
        content: [
          "async function demo(p: Promise<number>) {",
          "  await p.then((v) => v + 1);",
          "  await p.catch((err) => {",
          "    return 0;",
          "  });",
          "  await p.finally(() => {",
          "    console.log('done');",
          "  });",
          "}",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const byType = (type: string): Array<(typeof branchNodes)[number]> =>
      branchNodes.filter((node) => ((node.metadata?.branchType as string | undefined) ?? "") === type);

    expect(byType("then").length).toBeGreaterThanOrEqual(1);
    expect(byType("catch").length).toBeGreaterThanOrEqual(1);
    expect(byType("finally").length).toBeGreaterThanOrEqual(1);
  });
});
