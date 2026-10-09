import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FileReview, RepositoryReview } from '../shared/review.js';
import { api } from './api.js';
import './style.css';

function App() {
  const [path, setPath] = useState('');
  const [repository, setRepository] = useState<RepositoryReview | null>(null);
  const [file, setFile] = useState<FileReview | null>(null);
  const [view, setView] = useState<'source' | 'diff' | 'previous'>('source');
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
      setFile(next); setView(next.current ? 'source' : 'previous');
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
      <div className="workspace"><nav aria-label="Repository files"><h2>Files <span>{repository.files.length}</span></h2>{repository.files.map(item => <button key={item.path} onClick={() => select(item.path)} className={file?.path === item.path ? 'selected' : ''}><span>{item.path}</span><small>{item.status}</small></button>)}</nav>
      <main><section className="explanations" aria-label="English explanations"><h2>English review</h2><div className="empty"><span className="empty-icon">≋</span><h3>{file ? 'Source ready to explore' : 'Choose a file to begin'}</h3><p>{file ? 'Function explanations will appear here in the next milestone. Source browsing needs no API key.' : 'Browse files and inspect changes against the latest commit.'}</p>{file && !file.supported && <p>This file is unsupported for explanations. Source remains available.</p>}</div></section>
      <section className="source" aria-label="Source pane"><div className="source-heading"><h2>{file?.path ?? 'Source'}</h2>{file && <div className="tabs"><button aria-pressed={view === 'source'} disabled={!file.current} onClick={() => setView('source')}>Current source</button><button aria-pressed={view === 'previous'} disabled={!file.previous} onClick={() => setView('previous')}>Previous source</button><button aria-pressed={view === 'diff'} onClick={() => setView('diff')}>Git diff</button></div>}</div>{file?.notice && <p>{file.notice}</p>}{file ? source ? <pre aria-label="Source code">{source.split('\n').map((line, index) => <div key={index} className={view === 'diff' ? line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'removal' : '' : ''}><span className="line-number">{index + 1}</span><code>{line || ' '}</code></div>)}</pre> : <p className="empty">{view === 'diff' ? 'No source changes against HEAD.' : 'No source text available.'}</p> : <p className="empty">Select a file to view its source.</p>}</section></main></div></>}
    {!repository && <div className="welcome"><h2>Your repository, explained.</h2><p>Open a local Git folder to review staged and unstaged changes together. Your repository stays read-only.</p></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
