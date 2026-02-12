import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { GraphEdge, GraphNode, SnapshotGraph } from "../graph/schema.js";
import { stableHash } from "../utils/hash.js";

const isTsLike = (path: string): boolean =>
  path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".jsx");

const languageFor = (path: string): "ts" | "js" =>
  path.endsWith(".ts") || path.endsWith(".tsx") ? "ts" : "js";

const detectReactComponent = (node: Node): boolean => {
  if (!Node.isFunctionDeclaration(node) && !Node.isVariableDeclaration(node)) {
    return false;
  }
  const text = node.getText();
  return text.includes("return <") || text.includes("React.FC") || text.includes("JSX.Element");
};

const enclosingSymbolName = (node: Node): string | null => {
  const fnDecl = node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
  if (fnDecl?.getName()) {
    return fnDecl.getName() ?? null;
  }
  const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (varDecl?.getName()) {
    return varDecl.getName();
  }
  return null;
};

const buildBranchName = (node: Node): string | null => {
  if (Node.isIfStatement(node)) {
    return "if";
  }
  if (Node.isSwitchStatement(node)) {
    return "switch";
  }
  if (Node.isForStatement(node) || Node.isForOfStatement(node) || Node.isForInStatement(node)) {
    return "for";
  }
  if (Node.isWhileStatement(node) || Node.isDoStatement(node)) {
    return "while";
  }
  if (Node.isConditionalExpression(node)) {
    return "ternary";
  }
  if (Node.isReturnStatement(node)) {
    return "return";
  }
  return null;
};

const createFileNode = (
  repoId: string,
  snapshotId: string,
  ref: string,
  filePath: string,
  content: string,
): GraphNode => ({
  id: stableHash(`${repoId}:${snapshotId}:file:${filePath}`),
  kind: "File",
  name: filePath.split("/").pop() ?? filePath,
  qualifiedName: filePath,
  filePath,
  language: languageFor(filePath),
  signatureHash: stableHash(content),
  snapshotId,
  ref,
});

const buildSymbolNode = (
  kind: GraphNode["kind"],
  filePath: string,
  name: string,
  qualifiedName: string,
  snapshotId: string,
  ref: string,
  startLine: number,
  endLine: number,
  sourceText?: string,
): GraphNode => ({
  id: stableHash(`${snapshotId}:${kind}:${qualifiedName}:${startLine}:${endLine}`),
  kind,
  name,
  qualifiedName,
  filePath,
  language: languageFor(filePath),
  startLine,
  endLine,
  signatureHash: stableHash(sourceText ?? `${qualifiedName}:${startLine}:${endLine}`),
  snapshotId,
  ref,
});

export class TsAnalyzer {
  public async analyze(
    repoId: string,
    snapshotId: string,
    ref: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<SnapshotGraph> {
    const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const symbolByName = new Map<string, string>();

    for (const file of files.filter((entry) => isTsLike(entry.path))) {
      const sourceFile = project.createSourceFile(file.path, file.content, { overwrite: true });
      const fileNode = createFileNode(repoId, snapshotId, ref, file.path, file.content);
      nodes.push(fileNode);
      this.collectImports(sourceFile, fileNode, snapshotId, ref, edges);
      this.collectDeclarations(sourceFile, fileNode, snapshotId, ref, nodes, edges, symbolByName);
      this.collectDeepFunctions(sourceFile, fileNode, snapshotId, ref, nodes, edges, symbolByName);
    }

    for (const file of files.filter((entry) => isTsLike(entry.path))) {
      const sourceFile = project.getSourceFile(file.path);
      if (!sourceFile) {
        continue;
      }
      this.collectCallsAndRenders(sourceFile, snapshotId, ref, edges, symbolByName);
    }

    return { repoId, snapshotId, ref, nodes, edges };
  }

  private collectImports(
    sourceFile: SourceFile,
    fileNode: GraphNode,
    snapshotId: string,
    ref: string,
    edges: GraphEdge[],
  ): void {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const target = declaration.getModuleSpecifierValue();
      edges.push({
        id: stableHash(`${snapshotId}:import:${fileNode.id}:${target}`),
        source: fileNode.id,
        target: stableHash(`${snapshotId}:module:${target}`),
        kind: "IMPORTS",
        filePath: sourceFile.getFilePath(),
        snapshotId,
        ref,
      });
    }
  }

  private collectDeclarations(
    sourceFile: SourceFile,
    fileNode: GraphNode,
    snapshotId: string,
    ref: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    symbolByName: Map<string, string>,
  ): void {
    for (const classDecl of sourceFile.getClasses()) {
      const name = classDecl.getName() ?? "AnonymousClass";
      const range = classDecl.getStartLineNumber();
      const classNode = buildSymbolNode(
        "Class",
        sourceFile.getFilePath(),
        name,
        `${sourceFile.getBaseNameWithoutExtension()}.${name}`,
        snapshotId,
        ref,
        range,
        classDecl.getEndLineNumber(),
        classDecl.getText(),
      );
      nodes.push(classNode);
      symbolByName.set(name, classNode.id);
      edges.push({
        id: stableHash(`${snapshotId}:declares:${fileNode.id}:${classNode.id}`),
        source: fileNode.id,
        target: classNode.id,
        kind: "DECLARES",
        filePath: sourceFile.getFilePath(),
        snapshotId,
        ref,
      });

      const allClassMembers = [
        ...classDecl.getMethods(),
        ...classDecl.getGetAccessors(),
        ...classDecl.getSetAccessors(),
      ];
      for (const member of allClassMembers) {
        const memberName = member.getName();
        const memberNode = buildSymbolNode(
          "Method",
          sourceFile.getFilePath(),
          memberName,
          `${classNode.qualifiedName}.${memberName}`,
          snapshotId,
          ref,
          member.getStartLineNumber(),
          member.getEndLineNumber(),
          member.getText(),
        );
        nodes.push(memberNode);
        symbolByName.set(memberName, memberNode.id);
        edges.push({
          id: stableHash(`${snapshotId}:declares:${classNode.id}:${memberNode.id}`),
          source: classNode.id,
          target: memberNode.id,
          kind: "DECLARES",
          filePath: sourceFile.getFilePath(),
          snapshotId,
          ref,
        });
        this.collectControlFlow(member, memberNode, snapshotId, ref, nodes, edges);
      }
    }

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName() ?? "anonymous";
      const kind = detectReactComponent(fn) ? "ReactComponent" : name.startsWith("use") ? "Hook" : "Function";
      const fnNode = buildSymbolNode(
        kind,
        sourceFile.getFilePath(),
        name,
        `${sourceFile.getBaseNameWithoutExtension()}.${name}`,
        snapshotId,
        ref,
        fn.getStartLineNumber(),
        fn.getEndLineNumber(),
        fn.getText(),
      );
      nodes.push(fnNode);
      symbolByName.set(name, fnNode.id);
      edges.push({
        id: stableHash(`${snapshotId}:declares:${fileNode.id}:${fnNode.id}`),
        source: fileNode.id,
        target: fnNode.id,
        kind: "DECLARES",
        filePath: sourceFile.getFilePath(),
        snapshotId,
        ref,
      });
      this.collectControlFlow(fn, fnNode, snapshotId, ref, nodes, edges);
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getName();
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }
      const isFnLike =
        Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer);
      if (!isFnLike) {
        continue;
      }
      const isHook = name.startsWith("use");
      const looksReact = detectReactComponent(declaration);
      const kind: GraphNode["kind"] = looksReact ? "ReactComponent" : isHook ? "Hook" : "Function";
      const startLine = declaration.getStartLineNumber();
      const endLine = declaration.getEndLineNumber();
      const varNode = buildSymbolNode(
        kind,
        sourceFile.getFilePath(),
        name,
        `${sourceFile.getBaseNameWithoutExtension()}.${name}`,
        snapshotId,
        ref,
        startLine,
        endLine,
        declaration.getText(),
      );
      nodes.push(varNode);
      symbolByName.set(name, varNode.id);
      edges.push({
        id: stableHash(`${snapshotId}:declares:${fileNode.id}:${varNode.id}`),
        source: fileNode.id,
        target: varNode.id,
        kind: "DECLARES",
        filePath: sourceFile.getFilePath(),
        snapshotId,
        ref,
      });
      this.collectControlFlow(declaration, varNode, snapshotId, ref, nodes, edges);
    }
  }

  private collectDeepFunctions(
    sourceFile: SourceFile,
    fileNode: GraphNode,
    snapshotId: string,
    ref: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    symbolByName: Map<string, string>,
  ): void {
    const coveredRanges = new Set<string>();
    for (const existing of nodes) {
      if (existing.kind === "Function" || existing.kind === "Method" || existing.kind === "Hook" || existing.kind === "ReactComponent") {
        coveredRanges.add(`${existing.startLine}:${existing.endLine}`);
      }
    }

    const functionLikeKinds = [
      SyntaxKind.MethodDeclaration,
      SyntaxKind.GetAccessor,
      SyntaxKind.SetAccessor,
      SyntaxKind.ArrowFunction,
      SyntaxKind.FunctionExpression,
    ];

    sourceFile.forEachDescendant((node) => {
      if (!functionLikeKinds.includes(node.getKind())) {
        return;
      }
      const startLine = node.getStartLineNumber();
      const endLine = node.getEndLineNumber();
      const rangeKey = `${startLine}:${endLine}`;
      if (coveredRanges.has(rangeKey)) {
        return;
      }

      let name = "anonymous";
      const parent = node.getParent();
      if (parent && Node.isPropertyAssignment(parent)) {
        name = parent.getName();
      } else if (parent && Node.isVariableDeclaration(parent)) {
        name = parent.getName();
      } else if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
        name = node.getName();
      } else if (parent && Node.isCallExpression(parent)) {
        const callee = parent.getExpression().getText();
        name = callee;
      }

      if (name === "anonymous" && (endLine - startLine) < 2) {
        return;
      }

      coveredRanges.add(rangeKey);

      const qualifiedName = `${sourceFile.getBaseNameWithoutExtension()}.deep.${name}@${startLine}`;
      const stableQName = `${sourceFile.getBaseNameWithoutExtension()}.deep.${name}`;
      const fnNode: GraphNode = {
        id: stableHash(`${snapshotId}:deep:${qualifiedName}`),
        kind: "Function",
        name,
        qualifiedName: stableQName,
        filePath: sourceFile.getFilePath(),
        language: languageFor(sourceFile.getFilePath()),
        startLine,
        endLine,
        signatureHash: stableHash(node.getText()),
        snapshotId,
        ref,
      };
      nodes.push(fnNode);
      symbolByName.set(name, fnNode.id);
      edges.push({
        id: stableHash(`${snapshotId}:declares:${fileNode.id}:${fnNode.id}`),
        source: fileNode.id,
        target: fnNode.id,
        kind: "DECLARES",
        filePath: sourceFile.getFilePath(),
        snapshotId,
        ref,
      });
      this.collectControlFlow(node, fnNode, snapshotId, ref, nodes, edges);
    });
  }

  private collectControlFlow(
    root: Node,
    ownerNode: GraphNode,
    snapshotId: string,
    ref: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const branchNodes: GraphNode[] = [];
    const branchCounter = new Map<string, number>();
    root.forEachDescendant((node) => {
      const branchKind = buildBranchName(node);
      if (!branchKind) {
        return;
      }
      const idx = branchCounter.get(branchKind) ?? 0;
      branchCounter.set(branchKind, idx + 1);
      const line = node.getStartLineNumber();
      const rawText = node.getText();
      const firstLine = rawText.split("\n")[0] ?? "";
      const snippet = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
      const stableQualifiedName = `${ownerNode.qualifiedName}::${branchKind}#${idx}`;
      const branchNode: GraphNode = {
        id: stableHash(`${snapshotId}:branch:${stableQualifiedName}`),
        kind: "Branch",
        name: `${branchKind}@${line}`,
        qualifiedName: stableQualifiedName,
        filePath: ownerNode.filePath,
        language: ownerNode.language,
        startLine: line,
        endLine: node.getEndLineNumber(),
        signatureHash: stableHash(snippet),
        metadata: { branchType: branchKind, codeSnippet: snippet },
        snapshotId,
        ref,
      };
      branchNodes.push(branchNode);
      edges.push({
        id: stableHash(`${snapshotId}:declares:${ownerNode.id}:${branchNode.id}`),
        source: ownerNode.id,
        target: branchNode.id,
        kind: "DECLARES",
        filePath: ownerNode.filePath,
        snapshotId,
        ref,
      });
    });

    const sortedBranches = [...branchNodes].sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
    for (let index = 0; index < sortedBranches.length; index += 1) {
      const currentNode = sortedBranches[index];
      const previousNode = sortedBranches[index - 1];
      if (!previousNode) {
        edges.push({
          id: stableHash(`${snapshotId}:flow-start:${ownerNode.id}:${currentNode.id}`),
          source: ownerNode.id,
          target: currentNode.id,
          kind: "CALLS",
          filePath: ownerNode.filePath,
          snapshotId,
          ref,
        });
      } else {
        edges.push({
          id: stableHash(`${snapshotId}:flow-step:${previousNode.id}:${currentNode.id}`),
          source: previousNode.id,
          target: currentNode.id,
          kind: "CALLS",
          filePath: ownerNode.filePath,
          snapshotId,
          ref,
        });
      }
    }

    nodes.push(...sortedBranches);
  }

  private collectCallsAndRenders(
    sourceFile: SourceFile,
    snapshotId: string,
    ref: string,
    edges: GraphEdge[],
    symbolByName: Map<string, string>,
  ): void {
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression().getText();
        const callerName = enclosingSymbolName(node);
        if (!callerName) {
          return;
        }
        const source = symbolByName.get(callerName);
        const target = symbolByName.get(callee.replace("()", ""));
        if (!source || !target) {
          return;
        }
        edges.push({
          id: stableHash(`${snapshotId}:call:${source}:${target}:${node.getStartLineNumber()}`),
          source,
          target,
          kind: "CALLS",
          filePath: sourceFile.getFilePath(),
          snapshotId,
          ref,
        });
      }

      if (Node.isJsxOpeningElement(node)) {
        const sourceName = enclosingSymbolName(node);
        const targetName = node.getTagNameNode().getText();
        if (!sourceName) {
          return;
        }
        const source = symbolByName.get(sourceName);
        const target = symbolByName.get(targetName);
        if (!source || !target) {
          return;
        }
        edges.push({
          id: stableHash(`${snapshotId}:render:${source}:${target}:${node.getStartLineNumber()}`),
          source,
          target,
          kind: "RENDERS",
          filePath: sourceFile.getFilePath(),
          snapshotId,
          ref,
        });
      }
    });
  }
}
