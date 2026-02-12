import { spawn } from "node:child_process";
import type { GraphEdge, GraphNode, SnapshotGraph } from "../graph/schema.js";
import { stableHash } from "../utils/hash.js";

interface PyResult {
  functions: Array<{ name: string; qualifiedName: string; start: number; end: number }>;
  classes: Array<{ name: string; start: number; end: number }>;
  imports: string[];
  calls: Array<{ caller: string; callee: string; line: number }>;
}

export class PyAnalyzer {
  public async analyze(
    repoId: string,
    snapshotId: string,
    ref: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<SnapshotGraph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const symbolByName = new Map<string, string>();

    for (const file of files.filter((entry) => entry.path.endsWith(".py"))) {
      const fileNode: GraphNode = {
        id: stableHash(`${snapshotId}:py-file:${file.path}`),
        kind: "File",
        name: file.path.split("/").pop() ?? file.path,
        qualifiedName: file.path,
        filePath: file.path,
        language: "py",
        snapshotId,
        ref,
      };
      nodes.push(fileNode);

      const parsed = await this.runAnalyzer(file.content);
      for (const classDecl of parsed.classes) {
        const classNode: GraphNode = {
          id: stableHash(`${snapshotId}:class:${file.path}:${classDecl.name}`),
          kind: "Class",
          name: classDecl.name,
          qualifiedName: `${file.path}:${classDecl.name}`,
          filePath: file.path,
          language: "py",
          startLine: classDecl.start,
          endLine: classDecl.end,
          signatureHash: stableHash(`${classDecl.name}:${classDecl.start}:${classDecl.end}`),
          snapshotId,
          ref,
        };
        nodes.push(classNode);
        symbolByName.set(classDecl.name, classNode.id);
        edges.push({
          id: stableHash(`${snapshotId}:declares:${fileNode.id}:${classNode.id}`),
          source: fileNode.id,
          target: classNode.id,
          kind: "DECLARES",
          filePath: file.path,
          snapshotId,
          ref,
        });
      }

      for (const fn of parsed.functions) {
        const fnNode: GraphNode = {
          id: stableHash(`${snapshotId}:function:${file.path}:${fn.qualifiedName}`),
          kind: "Function",
          name: fn.name,
          qualifiedName: `${file.path}:${fn.qualifiedName}`,
          filePath: file.path,
          language: "py",
          startLine: fn.start,
          endLine: fn.end,
          signatureHash: stableHash(`${fn.qualifiedName}:${fn.start}:${fn.end}`),
          snapshotId,
          ref,
        };
        nodes.push(fnNode);
        symbolByName.set(fn.name, fnNode.id);
        edges.push({
          id: stableHash(`${snapshotId}:declares:${fileNode.id}:${fnNode.id}`),
          source: fileNode.id,
          target: fnNode.id,
          kind: "DECLARES",
          filePath: file.path,
          snapshotId,
          ref,
        });
      }

      for (const moduleName of parsed.imports) {
        edges.push({
          id: stableHash(`${snapshotId}:import:${fileNode.id}:${moduleName}`),
          source: fileNode.id,
          target: stableHash(`${snapshotId}:module:${moduleName}`),
          kind: "IMPORTS",
          filePath: file.path,
          snapshotId,
          ref,
        });
      }

      for (const call of parsed.calls) {
        const source = symbolByName.get(call.caller.split(".").at(-1) ?? "");
        const target = symbolByName.get(call.callee);
        if (!source || !target) {
          continue;
        }
        edges.push({
          id: stableHash(`${snapshotId}:call:${source}:${target}:${call.line}`),
          source,
          target,
          kind: "CALLS",
          filePath: file.path,
          snapshotId,
          ref,
        });
      }
    }

    return {
      repoId,
      snapshotId,
      ref,
      nodes,
      edges,
    };
  }

  private async runAnalyzer(content: string): Promise<PyResult> {
    return new Promise<PyResult>((resolve, reject) => {
      const child = spawn("python3", ["scripts/analyze_python.py"], { cwd: process.cwd() });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Uint8Array) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Uint8Array) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", () => {
        if (stderr) {
          reject(new Error(stderr));
          return;
        }
        resolve(JSON.parse(stdout) as PyResult);
      });
      child.stdin.write(JSON.stringify({ content }));
      child.stdin.end();
    });
  }
}
