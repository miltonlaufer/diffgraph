import { describe, expect, it } from "vitest";
import { buildCrossGraphNodeMatchKey } from "./nodeIdentity";

describe("buildCrossGraphNodeMatchKey", () => {
  it("normalizes file paths, class/branch casing, and dynamic label segments", () => {
    const key = buildCrossGraphNodeMatchKey({
      kind: "Branch",
      filePath: ".\\src\\logic\\flow.ts",
      className: " Controller ",
      branchType: " True ",
      label: "[new] Guard@42 line 18",
    });

    expect(key).toBe("Branch:src/logic/flow.ts:controller:true:guard@# line #");
  });

  it("produces identical keys for equivalent old/new labels", () => {
    const oldKey = buildCrossGraphNodeMatchKey({
      kind: "Function",
      filePath: "/src/engine.ts",
      className: "",
      branchType: "",
      label: "[old] Process @9 line 101",
    });

    const newKey = buildCrossGraphNodeMatchKey({
      kind: "Function",
      filePath: "src/engine.ts",
      className: "",
      branchType: "",
      label: "[new]  Process   @120 line 7",
    });

    expect(oldKey).toBe(newKey);
  });
});
