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

const isCallLikeExpression = (expr: Node): boolean => {
  if (Node.isCallExpression(expr) || Node.isNewExpression(expr)) {
    return true;
  }
  if (Node.isAwaitExpression(expr)) {
    const awaited = expr.getExpression();
    return Node.isCallExpression(awaited) || Node.isNewExpression(awaited);
  }
  return false;
};

const calleeNameFromExpression = (expr: Node): string | null => {
  let target: Node = expr;
  if (Node.isAwaitExpression(target)) {
    target = target.getExpression();
  }
  if (Node.isCallExpression(target)) {
    const calleeText = target.getExpression().getText();
    const cleaned = calleeText.replace(/\?\./g, ".");
    const base = cleaned.split(".").at(-1) ?? cleaned;
    return base.replace(/\(.*\)$/, "");
  }
  if (Node.isNewExpression(target)) {
    const calleeText = target.getExpression().getText();
    const cleaned = calleeText.replace(/\?\./g, ".");
    return cleaned.split(".").at(-1) ?? cleaned;
  }
  return null;
};

const callBranchTypeFromExpression = (expr: Node): "then" | "catch" | "finally" | "call" | null => {
  const callee = calleeNameFromExpression(expr);
  if (!callee) return null;
  if (callee === "then") return "then";
  if (callee === "catch") return "catch";
  if (callee === "finally") return "finally";
  return "call";
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
  if (Node.isTryStatement(node)) {
    return "try";
  }
  if (Node.isCatchClause(node)) {
    return "catch";
  }
  if (Node.isReturnStatement(node)) {
    return "return";
  }
  if (Node.isThrowStatement(node)) {
    return "throw";
  }
  if (Node.isExpressionStatement(node) && isCallLikeExpression(node.getExpression())) {
    return callBranchTypeFromExpression(node.getExpression()) ?? "call";
  }
  if (Node.isVariableStatement(node)) {
    const firstCallInitializer = node.getDeclarations().find((decl) => {
      const init = decl.getInitializer();
      return init ? isCallLikeExpression(init) : false;
    });
    if (firstCallInitializer) {
      const init = firstCallInitializer.getInitializer();
      if (init) {
        return callBranchTypeFromExpression(init) ?? "call";
      }
    }
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
  signatureHash: hashSignatureText(content),
  snapshotId,
  ref,
});

interface JsDocTagLike {
  getTagName: () => string;
  getCommentText?: () => string | undefined;
  getComment?: () => string | undefined;
}

interface JsDocLike {
  getDescription: () => string;
  getTags: () => JsDocTagLike[];
}

const normalizeInline = (value: string): string => value.replace(/\s+/g, " ").trim();
const normalizeSignatureText = (value: string): string =>
  value.replace(/\s+/g, "");
const hashSignatureText = (value: string): string => stableHash(normalizeSignatureText(value) || "__empty__");

const extractParams = (
  node: Node,
  options?: { includeTypes?: boolean; compactIfLong?: boolean },
): string => {
  const includeTypes = options?.includeTypes ?? true;
  const compactIfLong = options?.compactIfLong ?? false;
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
    const params = node.getParameters();
    if (params.length === 0) return "()";
    const parts = params.map((p) => {
      const rest = p.isRestParameter() ? "..." : "";
      const optional = p.isOptional() ? "?" : "";
      const name = `${rest}${p.getName()}${optional}`;
      if (!includeTypes) return name;
      const typeNode = p.getTypeNode();
      if (typeNode) return `${name}: ${normalizeInline(typeNode.getText())}`;
      const inferred = normalizeInline(p.getType().getText(p));
      return inferred && inferred !== "any" ? `${name}: ${inferred}` : name;
    });
    const result = `(${parts.join(", ")})`;
    if (compactIfLong && includeTypes && result.length > 80) {
      return extractParams(node, { includeTypes: false, compactIfLong: false });
    }
    return result;
  }
  return "";
};

const extractReturnType = (node: Node): string => {
  let explicit = "";
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    try {
      explicit = normalizeInline(node.getReturnTypeNode()?.getText() ?? "");
    } catch {
      explicit = "";
    }
  }
  if (explicit.length > 0) return explicit;
  if (Node.isSetAccessorDeclaration(node)) return "void";
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    try {
      const inferred = normalizeInline(node.getReturnType().getText(node));
      return inferred || "";
    } catch {
      return "";
    }
  }
  return "";
};

const formatJsDocs = (docs: JsDocLike[]): string => {
  const blocks = docs
    .map((doc) => {
      const description = doc.getDescription().trim();
      const tags = doc.getTags().map((tag) => {
        const comment = tag.getCommentText?.() ?? tag.getComment?.() ?? "";
        return normalizeInline(`@${tag.getTagName()} ${comment}`);
      });
      return [description, ...tags].filter((part) => part.length > 0).join("\n");
    })
    .filter((entry) => entry.length > 0);
  return blocks.join("\n\n").trim();
};

const extractDocumentation = (node: Node): string => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    return formatJsDocs(node.getJsDocs() as unknown as JsDocLike[]);
  }
  if (Node.isVariableDeclaration(node)) {
    const statement = node.getVariableStatement();
    return statement ? formatJsDocs(statement.getJsDocs() as unknown as JsDocLike[]) : "";
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDecl) {
      const statement = varDecl.getVariableStatement();
      if (statement) return formatJsDocs(statement.getJsDocs() as unknown as JsDocLike[]);
    }
  }
  return "";
};

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
  extraMetadata?: Record<string, string | number | boolean>,
): GraphNode => ({
  id: stableHash(`${snapshotId}:${kind}:${qualifiedName}:${startLine}:${endLine}`),
  kind,
  name,
  qualifiedName,
  filePath,
  language: languageFor(filePath),
  startLine,
  endLine,
  signatureHash: sourceText
    ? hashSignatureText(sourceText)
    : stableHash(`${qualifiedName}:${startLine}:${endLine}`),
  metadata: extraMetadata,
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
        const params = extractParams(member, { includeTypes: true, compactIfLong: true });
        const paramsFull = extractParams(member, { includeTypes: true, compactIfLong: false });
        const returnType = extractReturnType(member);
        const documentation = extractDocumentation(member);
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
          { params, paramsFull, returnType, documentation },
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
      const params = extractParams(fn, { includeTypes: true, compactIfLong: true });
      const paramsFull = extractParams(fn, { includeTypes: true, compactIfLong: false });
      const returnType = extractReturnType(fn);
      const documentation = extractDocumentation(fn);
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
        { params, paramsFull, returnType, documentation },
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
      const params = extractParams(initializer, { includeTypes: true, compactIfLong: true });
      const paramsFull = extractParams(initializer, { includeTypes: true, compactIfLong: false });
      const returnType = extractReturnType(initializer);
      const documentation = extractDocumentation(declaration);
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
        { params, paramsFull, returnType, documentation },
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
      this.collectControlFlow(initializer, varNode, snapshotId, ref, nodes, edges);
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

      const params = extractParams(node, { includeTypes: true, compactIfLong: true });
      const paramsFull = extractParams(node, { includeTypes: true, compactIfLong: false });
      const returnType = extractReturnType(node);
      const documentation = extractDocumentation(node);
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
        signatureHash: hashSignatureText(node.getText()),
        metadata: { params, paramsFull, returnType, documentation },
        snapshotId,
        ref,
      };
      nodes.push(fnNode);
      symbolByName.set(name, fnNode.id);

      /* Find enclosing function/component node to use as parent instead of file */
      let parentNodeId = fileNode.id;
      for (const existing of nodes) {
        if (
          existing.id !== fnNode.id &&
          existing.kind !== "File" &&
          existing.kind !== "Branch" &&
          existing.filePath === fnNode.filePath &&
          (existing.startLine ?? 0) <= startLine &&
          (existing.endLine ?? 0) >= endLine
        ) {
          parentNodeId = existing.id;
        }
      }

      edges.push({
        id: stableHash(`${snapshotId}:declares:${parentNodeId}:${fnNode.id}`),
        source: parentNodeId,
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
    type FlowType = "true" | "false" | "next";
    interface ExitAnchor {
      sourceId: string;
      flowType: FlowType;
    }

    const branchCounter = new Map<string, number>();
    const flowEdgeKeys = new Set<string>();

    const buildSnippet = (node: Node, branchKind: string): string => {
      const trim = (s: string, max: number): string => s.length > max ? `${s.slice(0, max - 3)}...` : s;
      const normalizeSnippet = (s: string, max: number): string => trim(s.replace(/\s+/g, " ").trim(), max);

      if (branchKind === "return" && Node.isReturnStatement(node)) {
        const expr = node.getExpression();
        if (!expr) return "return (void)";
        const exprText = expr.getText();
        if (exprText.startsWith("(")) return trim(`return JSX`, 60);
        if (exprText.includes("=>")) return normalizeSnippet(`return ${exprText}`, 60);
        return normalizeSnippet(`return ${exprText}`, 60);
      }

      if (branchKind === "if" && Node.isIfStatement(node)) {
        const condition = node.getExpression().getText().replace(/\s+/g, " ").trim();
        return normalizeSnippet(`if (${condition})`, 70);
      }

      if (branchKind === "for") {
        return normalizeSnippet(node.getText().replace(/\s*\{[\s\S]*$/, ""), 70);
      }

      if (branchKind === "while") {
        return normalizeSnippet(node.getText().replace(/\s*\{[\s\S]*$/, ""), 70);
      }

      if (branchKind === "switch" && Node.isSwitchStatement(node)) {
        const expr = node.getExpression().getText();
        return normalizeSnippet(`switch (${expr})`, 60);
      }

      if (branchKind === "ternary" && Node.isConditionalExpression(node)) {
        const condition = node.getCondition().getText();
        return normalizeSnippet(`${condition} ? ... : ...`, 60);
      }

      if (branchKind === "try") {
        return "try";
      }

      if (branchKind === "catch" && Node.isCatchClause(node)) {
        const variable = node.getVariableDeclaration();
        if (!variable) return "catch";
        return normalizeSnippet(`catch (${variable.getText()})`, 60);
      }

      if (branchKind === "finally") {
        return "finally";
      }

      return normalizeSnippet(node.getText(), 60);
    };

    const knownBooleanLiteral = (expr: Node): boolean | undefined => {
      if (Node.isParenthesizedExpression(expr)) {
        return knownBooleanLiteral(expr.getExpression());
      }
      if (Node.isTrueLiteral(expr)) return true;
      if (Node.isFalseLiteral(expr)) return false;
      if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.ExclamationToken) {
        const inner = knownBooleanLiteral(expr.getOperand());
        return inner === undefined ? undefined : !inner;
      }
      return undefined;
    };

    const addFlowEdge = (sourceId: string, targetId: string, flowType: FlowType): void => {
      const dedupKey = `${sourceId}:${targetId}:${flowType}`;
      if (flowEdgeKeys.has(dedupKey)) return;
      flowEdgeKeys.add(dedupKey);
      edges.push({
        id: stableHash(`${snapshotId}:flow:${sourceId}:${targetId}:${flowType}`),
        source: sourceId,
        target: targetId,
        kind: "CALLS",
        filePath: ownerNode.filePath,
        metadata: { flowType },
        snapshotId,
        ref,
      });
    };

    const makeBranchNode = (node: Node, forcedBranchKind?: string): GraphNode => {
      let branchKind = forcedBranchKind ?? buildBranchName(node) ?? "unknown";
      if (branchKind === "if" && Node.isIfStatement(node)) {
        const parentIf = node.getParentIfKind(SyntaxKind.IfStatement);
        if (parentIf && parentIf.getElseStatement() === node) {
          branchKind = "elif";
        }
      }
      const idx = branchCounter.get(branchKind) ?? 0;
      branchCounter.set(branchKind, idx + 1);
      const line = node.getStartLineNumber();
      const snippet = buildSnippet(node, branchKind);
      const stableQualifiedName = `${ownerNode.qualifiedName}::${branchKind}#${idx}`;
      const callCallee = branchKind === "call"
        ? (() => {
            if (Node.isExpressionStatement(node)) {
              return calleeNameFromExpression(node.getExpression());
            }
            if (Node.isVariableStatement(node)) {
              for (const decl of node.getDeclarations()) {
                const init = decl.getInitializer();
                if (!init) continue;
                const callee = calleeNameFromExpression(init);
                if (callee) return callee;
              }
            }
            return null;
          })()
        : null;
      return {
        id: stableHash(
          `${snapshotId}:branch:${stableQualifiedName}:${ownerNode.startLine ?? 0}:${ownerNode.endLine ?? 0}`,
        ),
        kind: "Branch",
        name: `${branchKind}@${line}`,
        qualifiedName: stableQualifiedName,
        filePath: ownerNode.filePath,
        language: ownerNode.language,
        startLine: line,
        endLine: node.getEndLineNumber(),
        signatureHash: hashSignatureText(snippet),
        metadata: {
          branchType: branchKind,
          codeSnippet: snippet,
          ...(callCallee ? { callee: callCallee } : {}),
        },
        snapshotId,
        ref,
      };
    };

    const addDeclaresEdge = (branchNode: GraphNode): void => {
      edges.push({
        id: stableHash(`${snapshotId}:declares:${ownerNode.id}:${branchNode.id}`),
        source: ownerNode.id,
        target: branchNode.id,
        kind: "DECLARES",
        filePath: ownerNode.filePath,
        snapshotId,
        ref,
      });
    };

    /** Get direct statements from a block-like node */
    const getStatements = (node: Node): Node[] => {
      if (Node.isBlock(node)) {
        return [...node.getStatements()];
      }
      if (Node.isSourceFile(node)) {
        return [...node.getStatements()];
      }
      /* For function declarations/expressions/arrows, get the body */
      if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
        const body = node.getBody();
        if (body && Node.isBlock(body)) {
          return [...body.getStatements()];
        }
        return [];
      }
      if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
        const body = node.getBody();
        if (body && Node.isBlock(body)) {
          return [...body.getStatements()];
        }
        return [];
      }
      /* Single statement (e.g. if body without braces) */
      return [node];
    };

    const statementFallsThrough = (stmt: Node): boolean => {
      if (Node.isReturnStatement(stmt) || Node.isThrowStatement(stmt)) return false;
      if (Node.isIfStatement(stmt)) {
        const known = knownBooleanLiteral(stmt.getExpression());
        const thenFalls = blockFallsThrough(stmt.getThenStatement());
        const elseStmt = stmt.getElseStatement();
        const elseFalls = elseStmt ? blockFallsThrough(elseStmt) : true;
        if (known === true) return thenFalls;
        if (known === false) return elseFalls;
        return thenFalls || elseFalls;
      }
      return true;
    };

    const blockFallsThrough = (block: Node): boolean => {
      const statements = getStatements(block);
      let pathOpen = true;
      for (const stmt of statements) {
        if (!pathOpen) break;
        pathOpen = statementFallsThrough(stmt);
      }
      return pathOpen;
    };

    const dedupExits = (exits: ExitAnchor[]): ExitAnchor[] => {
      const seen = new Set<string>();
      const out: ExitAnchor[] = [];
      for (const exit of exits) {
        const key = `${exit.sourceId}:${exit.flowType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(exit);
      }
      return out;
    };

    const collectBlock = (block: Node): { entryId: string | null; exits: ExitAnchor[]; fallsThrough: boolean } => {
      const statements = getStatements(block);
      let entryId: string | null = null;
      let pendingExits: ExitAnchor[] = [];

      for (const stmt of statements) {
        const result = collectStatement(stmt);
        if (result.entryId) {
          if (!entryId) entryId = result.entryId;
          for (const pending of pendingExits) {
            addFlowEdge(pending.sourceId, result.entryId, pending.flowType);
          }
          pendingExits = result.exits;
        } else if (!result.fallsThrough) {
          pendingExits = [];
        }
      }

      return { entryId, exits: pendingExits, fallsThrough: blockFallsThrough(block) };
    };

    const collectStatement = (stmt: Node): { entryId: string | null; exits: ExitAnchor[]; fallsThrough: boolean } => {
      if (Node.isTryStatement(stmt)) {
        const tryNode = makeBranchNode(stmt);
        nodes.push(tryNode);
        addDeclaresEdge(tryNode);

        const tryResult = collectBlock(stmt.getTryBlock());
        if (tryResult.entryId) {
          addFlowEdge(tryNode.id, tryResult.entryId, "next");
        }

        let exits: ExitAnchor[] = [];
        if (tryResult.entryId) {
          exits.push(...tryResult.exits);
        } else if (tryResult.fallsThrough) {
          exits.push({ sourceId: tryNode.id, flowType: "next" });
        }

        const catchClause = stmt.getCatchClause();
        if (catchClause) {
          const clause = catchClause;
          const catchNode = makeBranchNode(clause);
          nodes.push(catchNode);
          addDeclaresEdge(catchNode);
          addFlowEdge(tryNode.id, catchNode.id, "false");

          const catchResult = collectBlock(clause.getBlock());
          if (catchResult.entryId) {
            addFlowEdge(catchNode.id, catchResult.entryId, "next");
            exits.push(...catchResult.exits);
          } else if (catchResult.fallsThrough) {
            exits.push({ sourceId: catchNode.id, flowType: "next" });
          }
        }

        const finallyBlock = stmt.getFinallyBlock();
        if (finallyBlock) {
          const finallyNode = makeBranchNode(finallyBlock, "finally");
          nodes.push(finallyNode);
          addDeclaresEdge(finallyNode);

          const uniqueExitsToFinally = dedupExits(exits);
          if (uniqueExitsToFinally.length > 0) {
            for (const exit of uniqueExitsToFinally) {
              addFlowEdge(exit.sourceId, finallyNode.id, exit.flowType);
            }
          } else {
            addFlowEdge(tryNode.id, finallyNode.id, "next");
          }

          const finalResult = collectBlock(finallyBlock);
          if (finalResult.entryId) {
            addFlowEdge(finallyNode.id, finalResult.entryId, "next");
            exits = [...finalResult.exits];
          } else if (finalResult.fallsThrough) {
            exits = [{ sourceId: finallyNode.id, flowType: "next" }];
          } else if (!finalResult.fallsThrough) {
            exits = [];
          }
        }

        const deduped = dedupExits(exits);
        return { entryId: tryNode.id, exits: deduped, fallsThrough: deduped.length > 0 };
      }

      const branchKind = buildBranchName(stmt);
      if (!branchKind) {
        return { entryId: null, exits: [], fallsThrough: statementFallsThrough(stmt) };
      }

      const branchNode = makeBranchNode(stmt);
      nodes.push(branchNode);
      addDeclaresEdge(branchNode);

      if (branchKind === "return" || branchKind === "throw") {
        return { entryId: branchNode.id, exits: [], fallsThrough: false };
      }

      if (Node.isIfStatement(stmt)) {
        const knownTruth = knownBooleanLiteral(stmt.getExpression());
        const thenReachable = knownTruth !== false;
        const elseReachable = knownTruth !== true;

        const thenResult = collectBlock(stmt.getThenStatement());
        const elseStmt = stmt.getElseStatement();
        const elseResult = elseStmt
          ? collectBlock(elseStmt)
          : { entryId: null, exits: [] as ExitAnchor[], fallsThrough: true };

        if (thenResult.entryId && thenReachable) {
          addFlowEdge(branchNode.id, thenResult.entryId, "true");
        }
        if (elseResult.entryId && elseReachable) {
          addFlowEdge(branchNode.id, elseResult.entryId, "false");
        }

        // For if-without-else, continuation is represented from IF node itself.
        if (!elseStmt) {
          if (knownTruth === false) {
            return { entryId: branchNode.id, exits: [{ sourceId: branchNode.id, flowType: "next" }], fallsThrough: true };
          }
          if (thenResult.fallsThrough) {
            return { entryId: branchNode.id, exits: [{ sourceId: branchNode.id, flowType: "next" }], fallsThrough: true };
          }
          return { entryId: branchNode.id, exits: [{ sourceId: branchNode.id, flowType: "false" }], fallsThrough: true };
        }

        const exits: ExitAnchor[] = [];
        if (thenReachable) {
          exits.push(...thenResult.exits);
          if (!thenResult.entryId && thenResult.fallsThrough) {
            exits.push({ sourceId: branchNode.id, flowType: "true" });
          }
        }
        if (elseReachable) {
          exits.push(...elseResult.exits);
          if (!elseResult.entryId && elseResult.fallsThrough) {
            exits.push({ sourceId: branchNode.id, flowType: "false" });
          }
        }
        const fallsThrough = (thenReachable && thenResult.fallsThrough) || (elseReachable && elseResult.fallsThrough);
        return { entryId: branchNode.id, exits: dedupExits(exits), fallsThrough };
      }

      if (Node.isForStatement(stmt) || Node.isForOfStatement(stmt) || Node.isForInStatement(stmt) || Node.isWhileStatement(stmt) || Node.isDoStatement(stmt)) {
        const body = stmt.getStatement();
        if (body) {
          const bodyResult = collectBlock(body);
          if (bodyResult.entryId) {
            addFlowEdge(branchNode.id, bodyResult.entryId, "true");
          }
        }
        return { entryId: branchNode.id, exits: [{ sourceId: branchNode.id, flowType: "next" }], fallsThrough: true };
      }

      if (Node.isSwitchStatement(stmt)) {
        for (const clause of stmt.getClauses()) {
          const clauseResult = collectBlock(clause);
          if (clauseResult.entryId) {
            addFlowEdge(branchNode.id, clauseResult.entryId, "true");
          }
        }
      }

      return { entryId: branchNode.id, exits: [{ sourceId: branchNode.id, flowType: "next" }], fallsThrough: true };
    };

    const rootResult = collectBlock(root);
    if (rootResult.entryId) {
      addFlowEdge(ownerNode.id, rootResult.entryId, "next");
    }
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
