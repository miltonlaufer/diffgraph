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
        self.current_scope = "module"

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
        qualified_name = f"{self.current_scope}.{node.name}" if self.current_scope != "module" else node.name
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


def main() -> None:
    payload = json.loads(sys.stdin.read())
    collector = Collector()
    source = payload.get("content", "")
    tree = ast.parse(source)
    collector.visit(tree)
    print(
        json.dumps(
            {
                "functions": collector.functions,
                "classes": collector.classes,
                "imports": collector.imports,
                "calls": collector.calls,
            }
        )
    )


if __name__ == "__main__":
    main()
