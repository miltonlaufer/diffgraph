import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiffProvider } from "../src/core/git/diffProvider.js";

describe("DiffProvider files mode", () => {
  it("loads old and new file contents", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "diffgraph-"));
    const oldPath = join(tempDir, "old.ts");
    const newPath = join(tempDir, "new.ts");
    await writeFile(oldPath, "export const value = 1;\n", "utf8");
    await writeFile(newPath, "export const value = 2;\n", "utf8");

    const provider = new DiffProvider();
    const result = await provider.collect({ type: "files", oldFile: oldPath, newFile: newPath }, tempDir);

    expect(result.oldFiles[0].content).toContain("value = 1");
    expect(result.newFiles[0].content).toContain("value = 2");
    expect(result.files.length).toBe(1);
  });
});
