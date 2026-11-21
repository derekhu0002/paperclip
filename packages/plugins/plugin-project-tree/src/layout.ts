import type { ProjectTreeNode } from "./tree.js";

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 78;
export const COLUMN_GAP = 64;
export const ROW_GAP = 18;

export interface ProjectTreeLayoutNode {
  id: string;
  name: string;
  status: string;
  node: ProjectTreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface ProjectTreeLayoutEdge {
  from: string;
  to: string;
  path: string;
}

export interface ProjectTreeLayout {
  nodes: ProjectTreeLayoutNode[];
  edges: ProjectTreeLayoutEdge[];
  width: number;
  height: number;
}

/**
 * Lay a project forest out as a left-to-right tree: depth chooses the column,
 * leaves stack down, and a parent centers on its visible children. Collapsed
 * nodes hide their descendants.
 */
export function layoutProjectTree(
  roots: readonly ProjectTreeNode[],
  collapsed: ReadonlySet<string>,
): ProjectTreeLayout {
  const nodes: ProjectTreeLayoutNode[] = [];
  const edges: ProjectTreeLayoutEdge[] = [];
  let cursorY = 0;
  let maxDepth = 0;

  const place = (node: ProjectTreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const id = node.project.id;
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(id);
    let centerY: number;
    if (hasChildren && !isCollapsed) {
      const centers = node.children.map((child) => place(child, depth + 1));
      centerY = centers.length > 0 ? (centers[0]! + centers[centers.length - 1]!) / 2 : cursorY;
    } else {
      centerY = cursorY + NODE_HEIGHT / 2;
      cursorY += NODE_HEIGHT + ROW_GAP;
    }
    nodes.push({
      id,
      name: node.project.name,
      status: node.project.status,
      node,
      x: depth * (NODE_WIDTH + COLUMN_GAP),
      y: centerY - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      depth,
      hasChildren,
      collapsed: isCollapsed,
    });
    return centerY;
  };

  for (const root of roots) place(root, 0);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const link = (node: ProjectTreeNode) => {
    if (collapsed.has(node.project.id)) return;
    const parent = byId.get(node.project.id);
    if (!parent) return;
    for (const child of node.children) {
      const target = byId.get(child.project.id);
      if (target) {
        const x1 = parent.x + parent.width;
        const y1 = parent.y + parent.height / 2;
        const x2 = target.x;
        const y2 = target.y + target.height / 2;
        const midX = (x1 + x2) / 2;
        edges.push({
          from: parent.id,
          to: target.id,
          path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
        });
      }
      link(child);
    }
  };
  for (const root of roots) link(root);

  return {
    nodes,
    edges,
    width: (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP,
    height: Math.max(cursorY, NODE_HEIGHT),
  };
}
