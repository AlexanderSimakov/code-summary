import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import type { RecentProjectsResult } from '../shared/review.js';

export function useRecentProjects() {
  const [result, setResult] = useState<RecentProjectsResult>({ projects: [] });
  const [actionWarning, recordWarning] = useState<string>();
  const [pending, setPending] = useState(false);
  const readRevision = useRef(0);
  const operationRevision = useRef(0);
  const invalidate = useCallback(() => {
    readRevision.current++;
    return ++operationRevision.current;
  }, []);
  const accept = useCallback((latest: RecentProjectsResult, id: number) => {
    if (id !== operationRevision.current) return;
    // A focus read cannot supersede a user operation; its old response must now be ignored.
    readRevision.current++;
    setResult(latest);
    recordWarning(latest.warning);
  }, []);
  const refresh = useCallback(async () => {
    const id = ++readRevision.current;
    try {
      const latest = await api<RecentProjectsResult>('projects/recent', {});
      if (id === readRevision.current) setResult(latest);
    } catch (error) {
      if (id === readRevision.current) setResult(current => ({ ...current, warning: `Recent projects could not be loaded: ${(error as Error).message}` }));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { invalidate(); window.removeEventListener('focus', focus); };
  }, [refresh, invalidate]);
  const change = async (operation: 'remove' | 'clear', path?: string) => {
    const id = invalidate();
    setPending(true);
    try {
      const latest = await api<RecentProjectsResult>(`projects/recent/${operation}`, path ? { path } : {});
      accept(latest, id);
      await refresh();
    } catch (error) {
      if (id === operationRevision.current) recordWarning(`Recent projects could not be updated: ${(error as Error).message}`);
    }
    finally { setPending(false); }
  };
  return { projects: result.projects, warning: actionWarning ?? result.warning, pending, refresh, invalidate, accept, change };
}

export function RecentProjects({ history, onOpen, opening }: {
  history: ReturnType<typeof useRecentProjects>;
  onOpen: (path: string) => Promise<void>;
  opening: boolean;
}) {
  return <section className="recent-projects" aria-label="Recent projects">
    <div className="recent-heading"><h2>Recent projects</h2>{history.projects.length > 0 && <button disabled={history.pending} onClick={() => void history.change('clear')}>Clear history</button>}</div>
    {history.warning && <p role="status" className="history-warning">{history.warning}</p>}
    {history.projects.length === 0 ? <p className="recent-empty">No recent projects yet.</p> : <ul>{history.projects.map(project => <li key={project.path}>
      <button className="recent-open" aria-label={`Open ${project.name} ${project.path}`} disabled={opening} onClick={() => void onOpen(project.path)}><strong>{project.name}</strong><span>{project.path}</span></button>
      <button aria-label={`Remove ${project.name} ${project.path}`} disabled={history.pending} onClick={() => void history.change('remove', project.path)}>Remove</button>
    </li>)}</ul>}
  </section>;
}
