import { useMemo, useState } from 'react';
import type { ReviewFile } from '../shared/review.js';

type TreeNode = DirectoryNode | { kind: 'file'; name: string; file: ReviewFile };
interface DirectoryNode {
  kind: 'directory';
  name: string;
  path: string;
  children: TreeNode[];
  changedFiles: number;
}

function buildTree(files: ReviewFile[]): TreeNode[] {
  const root: DirectoryNode = { kind: 'directory', name: '', path: '', children: [], changedFiles: 0 };
  const directories = new Map<string, DirectoryNode>([['', root]]);
  for (const file of files) {
    const parts = file.path.split('/');
    let parent = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join('/');
      let directory = directories.get(path);
      if (!directory) {
        directory = { kind: 'directory', name: parts[index], path, children: [], changedFiles: 0 };
        directories.set(path, directory);
        parent.children.push(directory);
      }
      if (file.status !== 'unchanged') directory.changedFiles++;
      parent = directory;
    }
    parent.children.push({ kind: 'file', name: parts.at(-1)!, file });
  }
  for (const directory of directories.values()) {
    directory.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
  }
  return root.children;
}

export function RepositoryTree({ files, selectedPath, onSelect }: {
  files: ReviewFile[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState(() => new Set(nodes.filter(node => node.kind === 'directory').map(node => node.path)));
  function toggle(path: string) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function renderNodes(children: TreeNode[], label: string) {
    return <ul className="file-tree" aria-label={label}>{children.map(node => node.kind === 'directory'
      ? <li key={`directory:${node.path}`}>
          <button className="tree-row tree-directory" aria-label={`Folder ${node.path}`} aria-expanded={expanded.has(node.path)} title={node.path} onClick={() => toggle(node.path)}>
            <span className="tree-chevron" aria-hidden="true">{expanded.has(node.path) ? '▾' : '▸'}</span>
            <span className="tree-name">{node.name}</span>
            {node.changedFiles > 0 && <span className="tree-count" aria-label={`${node.changedFiles} changed ${node.changedFiles === 1 ? 'file' : 'files'}`}>{node.changedFiles}</span>}
          </button>
          {expanded.has(node.path) && renderNodes(node.children, `Contents of ${node.path}`)}
        </li>
      : <li key={`file:${node.file.path}`}>
          <button className={`tree-row tree-file${selectedPath === node.file.path ? ' selected' : ''}`} aria-label={`${node.file.path} ${node.file.status}`} aria-current={selectedPath === node.file.path ? 'page' : undefined} title={node.file.path} onClick={() => onSelect(node.file.path)}>
            <span className="tree-file-icon" aria-hidden="true">·</span><span className="tree-name">{node.name}</span>
            {node.file.status !== 'unchanged' && <small className={`tree-status ${node.file.status}`} title={node.file.status}>{node.file.status}</small>}
          </button>
        </li>)}</ul>;
  }
  return <nav aria-label="Repository files"><h2>Files <span>{files.length}</span></h2>{renderNodes(nodes, 'Repository root')}</nav>;
}
