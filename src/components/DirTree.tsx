import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { FileEntry } from "./fileManagerShared";

type TreeNode = {
  path: string;
  name: string;
  expanded: boolean;
  loaded: boolean;
  children: TreeNode[];
};

interface Props {
  kind: "local" | "remote";
  serverId?: string;
  /** Single root (remote) or fallback when roots not provided */
  rootPath?: string;
  /** Multiple top-level roots (local drives) */
  roots?: { path: string; name: string }[];
  currentPath: string;
  onNavigate: (path: string) => void;
}

async function listDirs(
  kind: "local" | "remote",
  serverId: string | undefined,
  path: string,
): Promise<FileEntry[]> {
  if (kind === "local" && path === "") {
    const drives = await api.localDrives();
    return drives.filter((e) => e.isDir);
  }
  const entries =
    kind === "local"
      ? await api.localList(path)
      : await api.sftpList(serverId!, path);
  return entries.filter((e) => e.isDir);
}

function makeNode(path: string, name: string, expanded = false): TreeNode {
  return { path, name, expanded, loaded: false, children: [] };
}

function updateForest(
  nodes: TreeNode[],
  targetPath: string,
  mapper: (node: TreeNode) => Promise<TreeNode>,
): Promise<TreeNode[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.path === targetPath) return mapper(node);
      return {
        ...node,
        children: await updateForest(node.children, targetPath, mapper),
      };
    }),
  );
}

export function DirTree({
  kind,
  serverId,
  rootPath,
  roots,
  currentPath,
  onNavigate,
}: Props) {
  const [forest, setForest] = useState<TreeNode[]>([]);

  useEffect(() => {
    if (roots && roots.length > 0) {
      setForest(roots.map((r) => makeNode(r.path, r.name, true)));
      return;
    }
    if (!rootPath) {
      setForest([]);
      return;
    }
    const name =
      rootPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
      rootPath ||
      "home";
    setForest([makeNode(rootPath, name, true)]);
  }, [rootPath, roots]);

  const loadChildren = useCallback(
    async (node: TreeNode): Promise<TreeNode[]> => {
      const dirs = await listDirs(kind, serverId, node.path);
      return dirs.map((d) => makeNode(d.path, d.name));
    },
    [kind, serverId],
  );

  useEffect(() => {
    const pending = forest.filter((n) => n.expanded && !n.loaded);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = await Promise.all(
        forest.map(async (node) => {
          if (!node.expanded || node.loaded) return node;
          try {
            const children = await loadChildren(node);
            return { ...node, loaded: true, children };
          } catch {
            return { ...node, loaded: true, children: [] };
          }
        }),
      );
      if (!cancelled) setForest(next);
    })();
    return () => {
      cancelled = true;
    };
    // Only bootstrap newly mounted expanded roots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest.map((n) => `${n.path}:${n.loaded}`).join("|"), loadChildren]);

  const toggle = async (targetPath: string) => {
    setForest(
      await updateForest(forest, targetPath, async (node) => {
        if (node.expanded) {
          return { ...node, expanded: false };
        }
        let children = node.children;
        if (!node.loaded) {
          children = await loadChildren(node);
        }
        return { ...node, expanded: true, loaded: true, children };
      }),
    );
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const active = currentPath === node.path;
    return (
      <div key={node.path} className="fm-tree-node">
        <button
          type="button"
          className={`fm-tree-row${active ? " active" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onNavigate(node.path)}
        >
          <span
            className="fm-tree-twist"
            onClick={(e) => {
              e.stopPropagation();
              void toggle(node.path);
            }}
          >
            {node.expanded ? "−" : "+"}
          </span>
          <span className="fm-tree-icon" aria-hidden>
            ▢
          </span>
          <span className="fm-tree-name" title={node.path}>
            {node.name}
          </span>
        </button>
        {node.expanded &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (forest.length === 0) {
    return <div className="fm-tree empty">트리 로딩…</div>;
  }

  return (
    <div className="fm-tree">
      {kind === "local" && roots && roots.length > 0 && (
        <button
          type="button"
          className={`fm-tree-row fm-tree-computer${currentPath === "" ? " active" : ""}`}
          onClick={() => onNavigate("")}
        >
          <span className="fm-tree-icon" aria-hidden>
            ▣
          </span>
          <span className="fm-tree-name">내 PC</span>
        </button>
      )}
      {forest.map((node) => renderNode(node, 0))}
    </div>
  );
}
