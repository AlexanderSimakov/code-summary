import { useEffect, useRef, useState } from 'react';
import type { FileReview } from '../shared/review.js';
import type { SourceReference, ModelSettings } from '../shared/explanation.js';
import type { ComparisonPreview, FileComparison } from '../shared/comparison.js';
import { api } from './api.js';
import { UsageReport } from './UsageReport.js';

export function ComparisonPanel({ file, onSelect }: { file: FileReview; onSelect: (reference: SourceReference) => void }) {
  const [model, setModel] = useState('openai/gpt-4.1-mini');
  const [preview, setPreview] = useState<ComparisonPreview | null>(null);
  const [comparison, setComparison] = useState<FileComparison | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { api<ModelSettings>('settings', {}).then(settings => setModel(settings.model)).catch(error => setError(error.message)); }, []);
  useEffect(() => { ++request.current; controller.current?.abort(); setPreview(null); setComparison(null); setError(''); setBusy(false); return () => { ++request.current; controller.current?.abort(); }; }, [file]);
  async function prepare() {
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const result = await api<ComparisonPreview>('comparison/preview', { repositoryPath: file.repositoryPath, filePath: file.path, model });
      if (id === request.current) setPreview(result);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setBusy(false); }
  }
  async function generate() {
    if (!preview) return;
    const id = ++request.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/comparison/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId: preview.id }), signal: abort.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Generation failed.');
      if (id === request.current) setComparison(result);
    } catch (error) { if (id === request.current && !abort.signal.aborted) setError((error as Error).message); }
    finally { if (id === request.current) setBusy(false); }
  }
  function cancel() { ++request.current; controller.current?.abort(); setBusy(false); setError('Generation cancelled. Provider usage may still be charged.'); }
  return <section className="explanations" aria-label="English explanations"><h2>English review</h2>
    {!file.supported || file.notice ? <p>This file is unsupported for explanations. Source remains available.</p> : <>
      <label className="model-setting">OpenRouter model<input aria-label="OpenRouter model" value={model} onChange={event => { setModel(event.target.value); setPreview(null); }} disabled={busy} /></label>
      <button onClick={prepare} disabled={busy}>Preview transmission</button>
      {preview && <div className="transmission" aria-label="Transmission preview"><h3>Source sent to OpenRouter</h3><p>Model: {preview.model}. Both HEAD and current versions are previewed. Opening this preview sends nothing.</p>
        {preview.files.map((source, index) => <details key={`${source.path}:${source.version}:${index}`}><summary>{source.path} · {source.version}</summary><pre>{source.content}</pre></details>)}
        <button onClick={generate} disabled={busy}>{error ? 'Retry generation' : 'Generate explanations'}</button>
      </div>}
      {busy && <><p role="status">Preparing or generating English comparison…</p><button onClick={cancel}>Cancel generation</button></>}
      {error && <p role="alert" className="error">{error}</p>}
      {comparison && <>
        {comparison.previous && <section aria-label="HEAD AI usage"><h3>HEAD</h3><UsageReport usage={comparison.previous.usage} /></section>}
        {comparison.current && <section aria-label="Current AI usage"><h3>Current</h3><UsageReport usage={comparison.current.usage} /></section>}
        {comparison.assessment && <p className="assessment">AI assessment: {comparison.assessment}. This is not proof of equivalence; inspect Git diff.</p>}
        <p className="uncertainty">{comparison.uncertainty}</p>
        {comparison.functions.length === 0 && <p>No named functions to compare. Source changes remain available in Git diff.</p>}
        {comparison.functions.map((fn, index) => <article className="function-explanation" key={`${fn.name}:${index}`}><h3>{fn.name}</h3>{fn.statements.map((statement, index) => <div key={index} className={`statement-change ${statement.change}`}><small>{statement.change}</small>
          {statement.previous && statement.change !== 'unchanged' && <button className="statement" onClick={() => onSelect(statement.previous!.reference)}>− {statement.previous.text}</button>}
          {statement.current && <button className="statement" onClick={() => onSelect(statement.current!.reference)}>{statement.change === 'unchanged' ? '' : '+ '}{statement.current.text}</button>}
          {(statement.current?.uncertainty || statement.previous?.uncertainty) && <p className="uncertainty">Uncertain: {statement.current?.uncertainty || statement.previous?.uncertainty}</p>}
        </div>)}</article>)}
      </>}
    </>}
  </section>;
}
