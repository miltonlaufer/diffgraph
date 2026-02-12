#!/usr/bin/env python3
import ast
import json
import sys
from typing import Any


class Collector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.functions: list[dict[str, Any]] = []
        self.classes: list[dict[str, Any]] = []
        self.imports: list[str] = []
        self.calls: list[dict[str, str | int]] = []
        self.branches: list[dict[str, Any]] = []
        self.current_scope = "module"
        self._branch_counter: dict[str, int] = {}

    def _next_branch_idx(self, kind: str) -> int:
        key = f"{self.current_scope}::{kind}"
        idx = self._branch_counter.get(key, 0)
        self._branch_counter[key] = idx + 1
        return idx

    def visit_Import(self, node: ast.Import) -> Any:
        for alias in node.names:
            self.imports.append(alias.name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> Any:
        if node.module:
            self.imports.append(node.module)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> Any:
        self.classes.append(
            {
                "name": node.name,
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
            }
        )
        previous = self.current_scope
        self.current_scope = node.name
        self.generic_visit(node)
        self.current_scope = previous

    def visit_FunctionDef(self, node: ast.FunctionDef) -> Any:
        qualified_name = (
            f"{self.current_scope}.{node.name}"
            if self.current_scope != "module"
            else node.name
        )
        self.functions.append(
            {
                "name": node.name,
                "qualifiedName": qualified_name,
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
            }
        )
        previous = self.current_scope
        self.current_scope = qualified_name
        self.generic_visit(node)
        self.current_scope = previous

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node: ast.Call) -> Any:
        if isinstance(node.func, ast.Name):
            self.calls.append(
                {
                    "caller": self.current_scope,
                    "callee": node.func.id,
                    "line": node.lineno,
                }
            )
        self.generic_visit(node)

    # --- Branch extraction ---

    def _get_snippet(self, node: ast.AST) -> str:
        """Get a short code snippet for the branch."""
        source_segment = ast.get_source_segment(self._source, node) if hasattr(self, "_source") else None
        if source_segment:
            first_line = source_segment.split("\n")[0]
            return first_line[:70] if len(first_line) <= 70 else first_line[:67] + "..."
        return ""

    def visit_If(self, node: ast.If) -> Any:
        snippet = self._get_snippet(node)
        if not snippet:
            snippet = f"if ...:"
        self.branches.append(
            {
                "kind": "if",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("if"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": snippet,
            }
        )
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> Any:
        snippet = self._get_snippet(node)
        if not snippet:
            snippet = "for ...:"
        self.branches.append(
            {
                "kind": "for",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("for"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": snippet,
            }
        )
        self.generic_visit(node)

    visit_AsyncFor = visit_For

    def visit_While(self, node: ast.While) -> Any:
        snippet = self._get_snippet(node)
        if not snippet:
            snippet = "while ...:"
        self.branches.append(
            {
                "kind": "while",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("while"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": snippet,
            }
        )
        self.generic_visit(node)

    def visit_Return(self, node: ast.Return) -> Any:
        snippet = self._get_snippet(node)
        if not snippet:
            snippet = "return" if node.value is None else "return ..."
        self.branches.append(
            {
                "kind": "return",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("return"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": snippet,
            }
        )
        # Don't generic_visit -- return is terminal

    def visit_Try(self, node: ast.Try) -> Any:
        self.branches.append(
            {
                "kind": "try",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("try"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": "try:",
            }
        )
        self.generic_visit(node)

    def visit_With(self, node: ast.With) -> Any:
        snippet = self._get_snippet(node)
        if not snippet:
            snippet = "with ...:"
        self.branches.append(
            {
                "kind": "with",
                "owner": self.current_scope,
                "idx": self._next_branch_idx("with"),
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "snippet": snippet,
            }
        )
        self.generic_visit(node)

    visit_AsyncWith = visit_With


def main() -> None:
    payload = json.loads(sys.stdin.read())
    source = payload.get("content", "")
    collector = Collector()
    collector._source = source
    tree = ast.parse(source)
    collector.visit(tree)
    print(
        json.dumps(
            {
                "functions": collector.functions,
                "classes": collector.classes,
                "imports": collector.imports,
                "calls": collector.calls,
                "branches": collector.branches,
            }
        )
    )


if __name__ == "__main__":
    main()
