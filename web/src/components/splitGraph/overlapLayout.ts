import type { Edge, Node } from "@xyflow/react";
import { hasHorizontalOverlap, nodeSize } from "./helpers";
import { computeNodeAbsolutePosition } from "./viewport";

const GROUP_BLOCK_GAP = 22;

export interface LayoutElements {
  nodes: Node[];
  edges: Edge[];
}

export const resolveSiblingBlockOverlaps = (layoutResult: LayoutElements): LayoutElements => {
  if (layoutResult.nodes.length < 2) return layoutResult;

  const nodes = layoutResult.nodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, Node[]>();
  const rootParentKey = "__root__";

  for (const node of nodes) {
    const parentKey = node.parentId ?? rootParentKey;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(node);
    childrenByParent.set(parentKey, siblings);
  }

  if (childrenByParent.size === 0) {
    return { nodes, edges: layoutResult.edges };
  }

  const depthByNodeId = new Map<string, number>();
  const getDepth = (nodeId: string): number => {
    const cached = depthByNodeId.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node?.parentId) {
      depthByNodeId.set(nodeId, 0);
      return 0;
    }
    const depth = getDepth(node.parentId) + 1;
    depthByNodeId.set(nodeId, depth);
    return depth;
  };

  const parentKeys = [...childrenByParent.keys()].sort((a, b) => {
    if (a === rootParentKey) return -1;
    if (b === rootParentKey) return 1;
    const depthA = getDepth(a);
    const depthB = getDepth(b);
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  for (const parentKey of parentKeys) {
    const siblings = childrenByParent.get(parentKey);
    if (!siblings || siblings.length < 2) continue;

    const ordered = siblings.slice().sort((a, b) => {
      const aAbs = computeNodeAbsolutePosition(a, nodeById);
      const bAbs = computeNodeAbsolutePosition(b, nodeById);
      const yDelta = aAbs.y - bAbs.y;
      if (Math.abs(yDelta) > 0.5) return yDelta;
      return aAbs.x - bAbs.x;
    });

    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const node of ordered) {
      const abs = computeNodeAbsolutePosition(node, nodeById);
      const size = nodeSize(node);
      let nextAbsY = abs.y;
      for (const prev of placed) {
        if (!hasHorizontalOverlap(abs.x, size.width, prev.x, prev.width)) continue;
        const minY = prev.y + prev.height + GROUP_BLOCK_GAP;
        if (nextAbsY < minY) {
          nextAbsY = minY;
        }
      }

      if (nextAbsY > abs.y + 0.5) {
        if (node.parentId) {
          const parent = nodeById.get(node.parentId);
          if (parent) {
            const parentAbs = computeNodeAbsolutePosition(parent, nodeById);
            node.position.y = nextAbsY - parentAbs.y;
          }
        } else {
          node.position.y = nextAbsY;
        }
      }

      placed.push({
        x: abs.x,
        y: nextAbsY,
        width: size.width,
        height: size.height,
      });
    }
  }

  return { nodes, edges: layoutResult.edges };
};
