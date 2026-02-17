import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphEdge, GraphNode, SnapshotGraph } from "../graph/schema.js";
import { stableHash } from "../utils/hash.js";

const currentFilePath = fileURLToPath(import.meta.url);
const analyzerScriptCandidates = [
  path.join(path.resolve(path.dirname(currentFilePath), "../../../"), "scripts", "analyze_python.py"),
  path.join(path.resolve(path.dirname(currentFilePath), "../../../../"), "scripts", "analyze_python.py"),
];
const analyzerScript = analyzerScriptCandidates.find((candidate) => existsSync(candidate))
  ?? analyzerScriptCandidates[0];

interface PyBranch {
  id: string;
  kind: string;
  owner: string;
  idx: number;
  start: number;
  end: number;
  snippet: string;
  callee?: string;
}

interface PyBranchFlow {
  source: string;
  target: string;
  flowType: "true" | "false" | "next";
}

interface PyResult {
  functions: Array<{
    name: string;
    qualifiedName: string;
    start: number;
    end: number;
    params?: string;
    returnType?: string;
    documentation?: string;
    signature?: string;
  }>;
  classes: Array<{ name: string; start: number; end: number; signature?: string }>;
  imports: string[];
  calls: Array<{ caller: string; callee: string; line: number }>;
  branches: PyBranch[];
  branchFlows?: PyBranchFlow[];
}

/**
 * Strips comments from Python source code to compute a comment-insensitive signature.
 * This ensures that changes to comments alone do not cause nodes to appear as "modified".
 */
const stripPythonComments = (value: string): string =>
  value.replace(/#[^\n]*/g, ""); // Remove single-line comments

const normalizeSignatureText = (value: string): string =>
  stripPythonComments(value).replace(/\s+/g, "");

const hashSignatureText = (value: string): string => stableHash(normalizeSignatureText(value) || "__empty__");

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
    const symbolByQualifiedName = new Map<string, string>();

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
          signatureHash: stableHash(classDecl.signature ?? `${classDecl.name}:${classDecl.start}:${classDecl.end}`),
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
          signatureHash: stableHash(fn.signature ?? `${fn.qualifiedName}:${fn.start}:${fn.end}`),
          metadata: {
            params: fn.params ?? "()",
            paramsFull: fn.params ?? "()",
            returnType: fn.returnType ?? "",
            documentation: fn.documentation ?? "",
          },
          snapshotId,
          ref,
        };
        nodes.push(fnNode);
        symbolByName.set(fn.name, fnNode.id);
        symbolByQualifiedName.set(fn.qualifiedName, fnNode.id);
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

      /* Branch nodes */
      const branchNodeByFlowId = new Map<string, GraphNode>();

      for (const branch of parsed.branches ?? []) {
        const stableQName = `${file.path}:${branch.id}`;
        const branchNode: GraphNode = {
          id: stableHash(`${snapshotId}:branch:${stableQName}`),
          kind: "Branch",
          name: `${branch.kind}@${branch.start}`,
          qualifiedName: stableQName,
          filePath: file.path,
          language: "py",
          startLine: branch.start,
          endLine: branch.end,
          signatureHash: hashSignatureText(branch.snippet),
          metadata: {
            branchType: branch.kind,
            codeSnippet: branch.snippet,
            ...(branch.callee ? { callee: branch.callee } : {}),
          },
          snapshotId,
          ref,
        };
        nodes.push(branchNode);
        branchNodeByFlowId.set(branch.id, branchNode);

        /* Find owner function node */
        const ownerName = branch.owner.split(".").at(-1) ?? "";
        const ownerId = symbolByQualifiedName.get(branch.owner) ?? symbolByName.get(ownerName);
        const parentId = ownerId ?? fileNode.id;
        edges.push({
          id: stableHash(`${snapshotId}:declares:${parentId}:${branchNode.id}`),
          source: parentId,
          target: branchNode.id,
          kind: "DECLARES",
          filePath: file.path,
          snapshotId,
          ref,
        });

      }

      /* Create control-flow edges emitted by Python analyzer */
      for (const flow of parsed.branchFlows ?? []) {
        const targetNode = branchNodeByFlowId.get(flow.target);
        if (!targetNode) continue;

        let sourceId: string | undefined;
        if (flow.source.startsWith("owner::")) {
          const owner = flow.source.slice("owner::".length);
          const ownerName = owner.split(".").at(-1) ?? "";
          sourceId = symbolByQualifiedName.get(owner) ?? symbolByName.get(ownerName) ?? fileNode.id;
        } else {
          sourceId = branchNodeByFlowId.get(flow.source)?.id;
        }
        if (!sourceId) continue;

        edges.push({
          id: stableHash(`${snapshotId}:flow:${sourceId}:${targetNode.id}:${flow.flowType}`),
          source: sourceId,
          target: targetNode.id,
          kind: "CALLS",
          filePath: file.path,
          metadata: {
            flowType: flow.flowType,
          },
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
      const child = spawn("python3", [analyzerScript]);
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
