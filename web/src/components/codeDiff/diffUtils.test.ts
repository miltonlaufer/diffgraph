import { describe, expect, it } from "vitest";
import { computeSideBySide } from "./diffUtils";

describe("computeSideBySide", () => {
  it("treats multiline wrapped python if-condition formatting as unchanged", () => {
    const oldContent = [
      "if _SEEDANCE_WATCHDOG_LAST_ENQUEUED_AT.get(storyboard_id_int) == now_ts:",
      "    del _SEEDANCE_WATCHDOG_LAST_ENQUEUED_AT[storyboard_id_int]",
    ].join("\n");
    const newContent = [
      "if (",
      "    _SEEDANCE_WATCHDOG_LAST_ENQUEUED_AT.get(storyboard_id_int)",
      "    == now_ts",
      "):",
      "    del _SEEDANCE_WATCHDOG_LAST_ENQUEUED_AT[storyboard_id_int]",
    ].join("\n");

    const diff = computeSideBySide(oldContent, newContent);
    expect(diff.newLines.some((line) => line.text.includes("_SEEDANCE_WATCHDOG_LAST_ENQUEUED_AT.get(storyboard_id_int)"))).toBe(true);
    expect(diff.newLines.some((line) => line.text.includes("== now_ts"))).toBe(true);
    expect(diff.newLines.some((line) => line.text.trim() === "):")).toBe(true);
    expect(diff.oldLines.some((line) => line.type === "removed")).toBe(false);
    expect(diff.newLines.some((line) => line.type === "added")).toBe(false);
  });

  it("treats identical useCallback blocks at different line numbers as unchanged", () => {
    const block = [
      "const handler = useCallback(",
      "  () => { doSomething(); },",
      "  [dep]",
      ");",
    ].join("\n");
    const oldContent = ["const a = 1;", block, "const b = 2;"].join("\n");
    const newContent = ["const a = 1;", "// inserted", "const x = 0;", block, "const b = 2;"].join("\n");

    const diff = computeSideBySide(oldContent, newContent);
    const blockLines = ["const handler = useCallback(", "  () => { doSomething(); },", "  [dep]", ");"];
    for (const line of blockLines) {
      const oldSame = diff.oldLines.filter((l) => l.text === line && l.type === "same");
      const newSame = diff.newLines.filter((l) => l.text === line && l.type === "same");
      expect(oldSame.length).toBeGreaterThanOrEqual(1);
      expect(newSame.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("treats wrapped function-call formatting as unchanged and keeps wrapped lines visible", () => {
    const oldContent = [
      "use_dynamic_clip_timing = getattr(storyboard_props, \"use_dynamic_clip_timing\", True)",
    ].join("\n");
    const newContent = [
      "use_dynamic_clip_timing = getattr(",
      "    storyboard_props, \"use_dynamic_clip_timing\", True",
      ")",
    ].join("\n");

    const diff = computeSideBySide(oldContent, newContent);
    expect(diff.oldLines.some((line) => line.type === "removed")).toBe(false);
    expect(diff.newLines.some((line) => line.type === "added")).toBe(false);
    expect(diff.newLines.some((line) => line.text.includes("storyboard_props"))).toBe(true);
    expect(diff.newLines.some((line) => line.text.trim() === ")")).toBe(true);
  });
});
