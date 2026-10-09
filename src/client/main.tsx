import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FileReview, RepositoryReview } from '../shared/review.js';
import { api } from './api.js';
import './style.css';
import { ComparisonPanel } from './ComparisonPanel.js';
import { ExplanationPanel } from './ExplanationPanel.js';
import { RepositoryTree } from './RepositoryTree.js';
import type { SourceReference } from '../shared/explanation.js';

function App() {
  const [path, setPath] = useState('');
  const [repository, setRepository] = useState<RepositoryReview | null>(null);
  const [file, setFile] = useState<FileReview | null>(null);
  const [englishMode, setEnglishMode] = useState<'baseline' | 'comparison'>('baseline');
  const [view, setView] = useState<'source' | 'diff' | 'previous'>('source');
  const [highlight, setHighlight] = useState<SourceReference | null>(null);
  const [outdated, setOutdated] = useState(false);
  const markOutdated = React.useCallback(() => setOutdated(true), []);
  useEffect(() => {
    setOutdated(false);
    if (!file) return;
    let active = true;
    const check = async () => {
      try {
        const latest = await api<FileReview>('file', { repositoryPath: file.repositoryPath, filePath: file.path });
        if (active && (latest.current?.hash !== file.current?.hash || latest.previous?.hash !== file.previous?.hash || latest.notice !== file.notice)) setOutdated(true);
      } catch { if (active) setOutdated(true); }
    };
    const timer = setInterval(check, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [file]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  async function open(event: React.FormEvent) {
    event.preventDefault();
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const next = await api<RepositoryReview>('repository', { path });
      if (id !== request.current) return;
      setRepository(next); setFile(null);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setLoading(false); }
  }
  async function select(filePath: string) {
    if (!repository) return;
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const next = await api<FileReview>('file', { repositoryPath: repository.root, filePath });
      if (id !== request.current) return;
      setFile(next); setEnglishMode(next.status === 'unchanged' ? 'baseline' : 'comparison'); setHighlight(null); setView(next.current ? 'source' : 'previous');
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setLoading(false); }
  }
  const source = view === 'diff' ? file?.diff : view === 'previous' ? file?.previous?.content : file?.current?.content;
  return <div className="app">
    <header><span className="eyebrow">LOCAL CODE REVIEW</span><h1>Code Summary</h1><p>Understand the change. Keep the source in sight.</p></header>
    <form onSubmit={open} className="open-form"><label htmlFor="repository">Repository path</label><div><input id="repository" value={path} onChange={event => setPath(event.target.value)} placeholder="/path/to/your/repository" required /><button disabled={loading}>Open repository</button></div></form>
    {error && <p role="alert" className="error">{error}</p>}
    {loading && <p role="status">Reading repository…</p>}
    {repository && <><div className="repo-heading"><strong>{repository.root}</strong><span>{repository.head ? 'Working tree vs HEAD' : 'No commits yet'}</span></div>
      {repository.changedFiles.length === 0 && <p className="clean">No changes against HEAD</p>}
      <div className="workspace"><RepositoryTree key={repository.root} files={repository.files} selectedPath={file?.path} onSelect={select} />
      <main className={outdated ? "outdated-review" : undefined}>{outdated && <div role="status" className="review-status">Review outdated. Source or context changed; the visible review is retained. <button onClick={() => file && select(file.path)}>Refresh review</button></div>}{file?.supported && <div className="tabs" aria-label="English review mode"><button aria-pressed={englishMode === 'baseline'} onClick={() => setEnglishMode('baseline')}>Baseline</button><button aria-pressed={englishMode === 'comparison'} onClick={() => setEnglishMode('comparison')}>Compare with HEAD</button></div>}{file && englishMode === 'comparison' ? <ComparisonPanel file={file} outdated={outdated} onOutdated={markOutdated} onSelect={reference => { setHighlight(reference); setView(reference.version === 'previous' ? 'previous' : 'source'); requestAnimationFrame(() => document.getElementById(`source-line-${reference.startLine}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }} /> : <ExplanationPanel file={file} outdated={outdated} onOutdated={markOutdated} onSelect={reference => { setHighlight(reference); setView(reference.version === 'previous' ? 'previous' : 'source'); requestAnimationFrame(() => document.getElementById(`source-line-${reference.startLine}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }} />}
      <section className="source" aria-label="Source pane"><div className="source-heading"><h2>{file?.path ?? 'Source'}</h2>{file && <div className="tabs"><button aria-pressed={view === 'source'} disabled={!file.current} onClick={() => setView('source')}>Current source</button><button aria-pressed={view === 'previous'} disabled={!file.previous} onClick={() => setView('previous')}>Previous source</button><button aria-pressed={view === 'diff'} onClick={() => setView('diff')}>Git diff</button></div>}</div>{file?.notice && <p>{file.notice}</p>}{file ? source ? <pre aria-label="Source code">{source.split('\n').map((line, index) => <div id={`source-line-${index + 1}`} key={index} className={view === 'diff' ? line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'removal' : '' : highlight && highlight.version === (view === 'previous' ? 'previous' : 'current') && index + 1 >= highlight.startLine && index + 1 <= highlight.endLine ? 'source-highlight' : ''}><span className="line-number">{index + 1}</span><code>{line || ' '}</code></div>)}</pre> : <p className="empty">{view === 'diff' ? 'No source changes against HEAD.' : 'No source text available.'}</p> : <p className="empty">Select a file to view its source.</p>}</section></main></div></>}
    {!repository && <div className="welcome"><h2>Your repository, explained.</h2><p>Open a local Git folder to review staged and unstaged changes together. Your repository stays read-only.</p></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
