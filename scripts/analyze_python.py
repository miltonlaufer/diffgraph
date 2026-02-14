#!/usr/bin/env python3
import ast
import json
import sys
from typing import Any


FlowType = str
ExitAnchor = tuple[str, FlowType]


class Collector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.functions: list[dict[str, Any]] = []
        self.classes: list[dict[str, Any]] = []
        self.imports: list[str] = []
        self.calls: list[dict[str, str | int]] = []
        self.branches: list[dict[str, Any]] = []
        self.branch_flows: list[dict[str, str]] = []
        self.current_scope = "module"
        self._branch_counter: dict[str, int] = {}
        self._branch_flow_keys: set[tuple[str, str, str]] = set()

    def _semantic_signature(self, node: ast.AST) -> str:
        return ast.dump(node, annotate_fields=True, include_attributes=False)

    def _next_branch_idx(self, owner: str, kind: str) -> int:
        key = f"{owner}::{kind}"
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
                "signature": self._semantic_signature(node),
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

        args = node.args
        param_names: list[str] = []
        for arg in args.args:
            annotation = ""
            if arg.annotation:
                try:
                    annotation = f": {ast.unparse(arg.annotation)}"
                except Exception:
                    annotation = ""
            param_names.append(f"{arg.arg}{annotation}")
        params = f"({', '.join(param_names)})" if param_names else "()"

        return_type = ""
        if node.returns:
            try:
                return_type = ast.unparse(node.returns)
            except Exception:
                return_type = ""
        documentation = ast.get_docstring(node) or ""

        self.functions.append(
            {
                "name": node.name,
                "qualifiedName": qualified_name,
                "start": node.lineno,
                "end": getattr(node, "end_lineno", node.lineno),
                "params": params,
                "returnType": return_type,
                "documentation": documentation,
                "signature": self._semantic_signature(node),
            }
        )

        previous = self.current_scope
        self.current_scope = qualified_name
        entry_id, _, _ = self._collect_block(qualified_name, node.body)
        if entry_id is not None:
            self._add_flow(f"owner::{qualified_name}", entry_id, "next")
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

    def _get_snippet(self, node: ast.AST) -> str:
        source_segment = (
            ast.get_source_segment(self._source, node)
            if hasattr(self, "_source")
            else None
        )
        if source_segment:
            first_line = source_segment.split("\n")[0]
            return first_line[:70] if len(first_line) <= 70 else first_line[:67] + "..."
        return ""

    def _extract_stmt_call(self, node: ast.AST) -> ast.Call | None:
        value: ast.AST | None = None
        if isinstance(node, ast.Expr):
            value = node.value
        elif isinstance(node, ast.Assign):
            value = node.value
        elif isinstance(node, ast.AnnAssign):
            value = node.value
        elif isinstance(node, ast.AugAssign):
            value = node.value
        if value is None:
            return None
        if isinstance(value, ast.Await):
            value = value.value
        if isinstance(value, ast.Call):
            return value
        return None

    def _call_name(self, call_node: ast.Call) -> str:
        if isinstance(call_node.func, ast.Name):
            return call_node.func.id
        if isinstance(call_node.func, ast.Attribute):
            return call_node.func.attr
        return "call"

    def _add_flow(self, source: str, target: str, flow_type: FlowType) -> None:
        key = (source, target, flow_type)
        if key in self._branch_flow_keys:
            return
        self._branch_flow_keys.add(key)
        self.branch_flows.append(
            {"source": source, "target": target, "flowType": flow_type}
        )

    def _add_branch(
        self,
        owner: str,
        kind: str,
        node: ast.AST,
        snippet: str,
        callee: str | None = None,
    ) -> str:
        idx = self._next_branch_idx(owner, kind)
        branch_id = f"{owner}::{kind}#{idx}"
        payload: dict[str, Any] = {
            "id": branch_id,
            "kind": kind,
            "owner": owner,
            "idx": idx,
            "start": getattr(node, "lineno", 0),
            "end": getattr(node, "end_lineno", getattr(node, "lineno", 0)),
            "snippet": snippet,
        }
        if callee:
            payload["callee"] = callee
        self.branches.append(payload)
        return branch_id

    def _record_call_branch(
        self, owner: str, stmt_node: ast.AST, call_node: ast.Call
    ) -> str:
        callee = self._call_name(call_node)
        snippet = self._get_snippet(stmt_node)
        if not snippet:
            snippet = f"{callee}(...)"
        return self._add_branch(
            owner=owner,
            kind="call",
            node=stmt_node,
            snippet=snippet,
            callee=callee,
        )

    def _stmt_falls_through(self, stmt: ast.stmt) -> bool:
        if isinstance(stmt, (ast.Return, ast.Raise)):
            return False
        if isinstance(stmt, ast.If):
            then_falls = self._block_falls_through(stmt.body)
            else_falls = self._block_falls_through(stmt.orelse) if stmt.orelse else True
            return then_falls or else_falls
        return True

    def _known_truth_value(self, expr: ast.expr) -> bool | None:
        if isinstance(expr, ast.Constant):
            if isinstance(expr.value, bool):
                return expr.value
            if expr.value is None:
                return False
        if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
            inner = self._known_truth_value(expr.operand)
            if inner is None:
                return None
            return not inner
        return None

    def _block_falls_through(self, statements: list[ast.stmt]) -> bool:
        path_open = True
        for stmt in statements:
            if not path_open:
                break
            path_open = self._stmt_falls_through(stmt)
        return path_open

    def _collect_block(
        self, owner: str, statements: list[ast.stmt]
    ) -> tuple[str | None, list[ExitAnchor], bool]:
        entry_id: str | None = None
        pending_exits: list[ExitAnchor] = []

        for stmt in statements:
            stmt_entry, stmt_exits, stmt_falls = self._collect_stmt(owner, stmt)

            if stmt_entry is not None:
                if entry_id is None:
                    entry_id = stmt_entry
                for source_id, flow_type in pending_exits:
                    self._add_flow(source_id, stmt_entry, flow_type)
                pending_exits = stmt_exits
            else:
                if not stmt_falls:
                    pending_exits = []

        return entry_id, pending_exits, self._block_falls_through(statements)

    def _collect_stmt(
        self, owner: str, stmt: ast.stmt
    ) -> tuple[str | None, list[ExitAnchor], bool]:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return None, [], True

        if isinstance(stmt, ast.If):
            snippet = self._get_snippet(stmt) or "if ...:"
            branch_kind = "elif" if snippet.lstrip().startswith("elif ") else "if"
            cond_id = self._add_branch(
                owner=owner, kind=branch_kind, node=stmt, snippet=snippet
            )
            known_truth = self._known_truth_value(stmt.test)
            then_reachable = known_truth is not False
            else_reachable = known_truth is not True

            then_entry, then_exits, then_falls = self._collect_block(owner, stmt.body)
            else_entry: str | None = None
            else_exits: list[ExitAnchor] = []
            else_falls = True
            if stmt.orelse:
                else_entry, else_exits, else_falls = self._collect_block(
                    owner, stmt.orelse
                )

            if then_entry is not None and then_reachable:
                self._add_flow(cond_id, then_entry, "true")
            if else_entry is not None and else_reachable:
                self._add_flow(cond_id, else_entry, "false")

            exits: list[ExitAnchor] = []
            if then_reachable:
                exits.extend(then_exits)
            if else_reachable:
                exits.extend(else_exits)
            if then_entry is None and then_falls and then_reachable:
                exits.append((cond_id, "true"))
            if else_entry is None and else_falls and else_reachable:
                if len(stmt.orelse) == 0 and then_reachable and then_falls:
                    exits.append((cond_id, "next"))
                else:
                    exits.append((cond_id, "false"))

            # For if-without-else, model continuation from the IF node itself.
            # This makes the graph semantics explicit:
            # - IF -> N -> next statement, when body can fall through
            # - IF -> F -> next statement, when body is terminal (guard-return)
            if len(stmt.orelse) == 0:
                if then_falls:
                    exits = [(cond_id, "next")]
                    return cond_id, exits, True
                exits = [(cond_id, "false")]
                return cond_id, exits, True

            dedup_exits = list(dict.fromkeys(exits))
            return cond_id, dedup_exits, (then_reachable and then_falls) or (else_reachable and else_falls)

        if isinstance(stmt, ast.Return):
            snippet = self._get_snippet(stmt) or (
                "return" if stmt.value is None else "return ..."
            )
            branch_id = self._add_branch(
                owner=owner, kind="return", node=stmt, snippet=snippet
            )
            return branch_id, [], False

        if isinstance(stmt, ast.Raise):
            snippet = self._get_snippet(stmt) or "raise ..."
            branch_id = self._add_branch(
                owner=owner, kind="raise", node=stmt, snippet=snippet
            )
            return branch_id, [], False

        call_node = self._extract_stmt_call(stmt)
        if call_node is not None:
            branch_id = self._record_call_branch(owner, stmt, call_node)
            return branch_id, [(branch_id, "next")], True

        if isinstance(stmt, (ast.For, ast.AsyncFor)):
            snippet = self._get_snippet(stmt) or "for ...:"
            branch_id = self._add_branch(
                owner=owner, kind="for", node=stmt, snippet=snippet
            )
            return branch_id, [(branch_id, "next")], True

        if isinstance(stmt, ast.While):
            snippet = self._get_snippet(stmt) or "while ...:"
            branch_id = self._add_branch(
                owner=owner, kind="while", node=stmt, snippet=snippet
            )
            return branch_id, [(branch_id, "next")], True

        if isinstance(stmt, ast.Try):
            branch_id = self._add_branch(owner=owner, kind="try", node=stmt, snippet="try:")
            return branch_id, [(branch_id, "next")], True

        if isinstance(stmt, (ast.With, ast.AsyncWith)):
            snippet = self._get_snippet(stmt) or "with ...:"
            branch_id = self._add_branch(
                owner=owner, kind="with", node=stmt, snippet=snippet
            )
            return branch_id, [(branch_id, "next")], True

        return None, [], self._stmt_falls_through(stmt)


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
                "branchFlows": collector.branch_flows,
            }
        )
    )


if __name__ == "__main__":
    main()
