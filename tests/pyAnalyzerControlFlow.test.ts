import { describe, it, expect } from "vitest";
import { PyAnalyzer } from "../src/core/parsing/pyAnalyzer.js";

describe("PyAnalyzer control flow", () => {
  it("builds correct false edges for elif chains and sequential guard ifs", async () => {
    const analyzer = new PyAnalyzer();
    const graph = await analyzer.analyze("repo", "snap", "ref", [
      {
        path: "sample.py",
        content: [
          "def render(frontend_dynamic_timing_override, is_paid_user):",
          "    if frontend_dynamic_timing_override is not None:",
          "        if is_paid_user:",
          "            x = 1",
          "    elif is_paid_user:",
          "        x = 2",
          "",
          "def auth(user):",
          "    if not user:",
          "        raise HTTPException(status_code=404)",
          "    if user.status == -2:",
          "        raise HTTPException(status_code=403)",
          "",
          "def toy():",
          "    if True:",
          "        print('caca')",
          "    if flag:",
          "        return 1",
          "",
          "def toy2(day_of_week):",
          "    if random() > 0.5:",
          "        print('caca')",
          "    if day_of_week == 'Tuesday':",
          "        print('nice')",
          "",
        ].join("\n"),
      },
    ]);

    const branchNodes = graph.nodes.filter((node) => node.kind === "Branch");
    const byStart = new Map<number, string>();
    for (const node of branchNodes) {
      if (node.startLine) byStart.set(node.startLine, node.id);
    }

    const if2145 = byStart.get(2);
    const nestedIf2147 = byStart.get(3);
    const elif2150 = byStart.get(5);
    const if2097 = byStart.get(9);
    const if2099 = byStart.get(11);
    const raise404 = byStart.get(10);
    const raise403 = byStart.get(12);
    const toyIfTrue = byStart.get(15);
    const toyPrint = byStart.get(16);
    const toyIfFlag = byStart.get(17);
    const toy2IfRandom = byStart.get(21);
    const toy2PrintCaca = byStart.get(22);
    const toy2IfTuesday = byStart.get(23);

    expect(if2145).toBeTruthy();
    expect(nestedIf2147).toBeTruthy();
    expect(elif2150).toBeTruthy();
    expect(if2097).toBeTruthy();
    expect(if2099).toBeTruthy();
    expect(raise404).toBeTruthy();
    expect(raise403).toBeTruthy();
    expect(toyIfTrue).toBeTruthy();
    expect(toyPrint).toBeTruthy();
    expect(toyIfFlag).toBeTruthy();
    expect(toy2IfRandom).toBeTruthy();
    expect(toy2PrintCaca).toBeTruthy();
    expect(toy2IfTuesday).toBeTruthy();

    const flowEdges = graph.edges.filter((edge) => edge.kind === "CALLS");
    const hasEdge = (source: string, target: string, flowType: "true" | "false" | "next"): boolean =>
      flowEdges.some(
        (edge) => edge.source === source
          && edge.target === target
          && (edge.metadata?.flowType as string | undefined) === flowType,
      );

    expect(hasEdge(if2145!, nestedIf2147!, "true")).toBe(true);
    expect(hasEdge(if2145!, elif2150!, "false")).toBe(true);
    expect(hasEdge(if2097!, raise404!, "true")).toBe(true);
    expect(hasEdge(if2097!, if2099!, "false")).toBe(true);
    expect(hasEdge(if2099!, raise403!, "true")).toBe(true);
    expect(hasEdge(toyIfTrue!, toyPrint!, "true")).toBe(true);
    expect(hasEdge(toyIfTrue!, toyIfFlag!, "next")).toBe(true);
    expect(hasEdge(toyPrint!, toyIfFlag!, "next")).toBe(false);
    expect(hasEdge(toyIfTrue!, toyIfFlag!, "false")).toBe(false);
    expect(hasEdge(toy2IfRandom!, toy2IfTuesday!, "next")).toBe(true);
    expect(hasEdge(toy2PrintCaca!, toy2IfTuesday!, "next")).toBe(false);
  });
});
