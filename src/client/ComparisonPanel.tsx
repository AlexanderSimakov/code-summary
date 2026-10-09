import { useEffect, useRef, useState } from 'react';
import type { FileReview } from '../shared/review.js';
import type { SourceReference, ModelSettings } from '../shared/explanation.js';
import type { ComparisonPreview, FileComparison } from '../shared/comparison.js';
import { useFreshness } from './useFreshness.js';
import { api } from './api.js';
import { UsageReport } from './UsageReport.js';
import { ContextSettings } from './ContextSettings.js';

export function ComparisonPanel({ file, onSelect, outdated = false, onOutdated = () => {} }: { file: FileReview; outdated?: boolean; onOutdated?: () => void; onSelect: (reference: SourceReference) => void }) {
  const [model, setModel] = useState('openai/gpt-4.1-mini');
  const [contextLimitBytes, setContextLimitBytes] = useState(65536);
  const [preview, setPreview] = useState<ComparisonPreview | null>(null);
  const [comparison, setComparison] = useState<FileComparison | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { api<ModelSettings>('settings', {}).then(settings => setModel(settings.model)).catch(error => setError(error.message)); }, []);
  useEffect(() => { ++request.current; controller.current?.abort(); setPreview(null); setComparison(null); setError(''); setBusy(false); return () => { ++request.current; controller.current?.abort(); }; }, [file]);
  useFreshness('comparison', comparison?.previewId, onOutdated);
  useEffect(() => {
    if (!file.supported) return;
    let active = true;
    api<{ preview: ComparisonPreview; comparison: FileComparison | null }>('comparison/cache', { repositoryPath: file.repositoryPath, filePath: file.path, model, contextLimitBytes })
      .then(result => { if (active && !matchesSelectedFile(result.preview)) { onOutdated(); return; } if (active && result.comparison) { setPreview(result.preview); setComparison(result.comparison); } }).catch(() => {});
    return () => { active = false; };
  }, [file, model, contextLimitBytes]);
  function matchesSelectedFile(value: ComparisonPreview) {
    return ['previous', 'current'].every(version => {
      const selected = value.files.find(source => source.path === file.path && source.version === version);
      return !selected || selected.content === (version === 'previous' ? file.previous?.content : file.current?.content);
    });
  }
  async function prepare() {
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const result = await api<ComparisonPreview>('comparison/preview', { repositoryPath: file.repositoryPath, filePath: file.path, model, contextLimitBytes });
      if (id === request.current) { if (!matchesSelectedFile(result)) { onOutdated(); throw new Error('Source changed. Refresh review before preparing a transmission.'); } setPreview(result); }
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
      <ContextSettings value={contextLimitBytes} onChange={value => { setContextLimitBytes(value); setPreview(null); }} disabled={busy} />
      <button onClick={prepare} disabled={outdated || busy}>Preview transmission</button>
      {preview && <div className="transmission" aria-label="Transmission preview"><h3>Source sent to OpenRouter</h3><p>Model: {preview.model}. Both HEAD and current versions are previewed. Opening this preview sends nothing.</p>
        {[preview.previous, preview.current].map((side, index) => side && <div key={index}>{!comparison && side.contextWarnings?.map(warning => <p className="uncertainty" key={warning}>Context warning: {warning}</p>)}{side.unavailableReason && <p role="alert" className="error">{side.unavailableReason}</p>}</div>)}
        {preview.files.map((source, index) => <details key={`${source.path}:${source.version}:${index}`}><summary>{source.path} · {source.version}</summary><pre>{source.content}</pre></details>)}
        <button onClick={generate} disabled={busy || Boolean(preview.previous?.unavailableReason || preview.current?.unavailableReason)}>{error ? 'Retry generation' : 'Generate explanations'}</button>
      </div>}
      {busy && <><p role="status">Preparing or generating English comparison…</p><button onClick={cancel}>Cancel generation</button></>}
      {error && <p role="alert" className="error">{error}</p>}
      {comparison && <>
        {(comparison.previous?.cached || comparison.current?.cached) && <p>Cached explanations reused without a new AI request.</p>}
        {comparison.previous && <section aria-label="HEAD AI usage"><h3>HEAD</h3><UsageReport usage={comparison.previous.usage} /></section>}
        {comparison.current && <section aria-label="Current AI usage"><h3>Current</h3><UsageReport usage={comparison.current.usage} /></section>}
        {[comparison.previous, comparison.current].map((side, index) => side && <div aria-label={index === 0 ? "HEAD context warnings" : "Current context warnings"} key={index}>{side.contextWarnings?.map(warning => <p className="uncertainty" key={warning}>{index === 0 ? "HEAD" : "Current"} context warning: {warning}</p>)}</div>)}
        {comparison.assessment && <p className="assessment">AI assessment: {comparison.assessment}. This is not proof of equivalence; inspect Git diff.</p>}
        <p className="uncertainty">{comparison.uncertainty}</p>
        {comparison.functions.length === 0 && <p>No explainable source units to compare. Source changes remain available in Git diff.</p>}
        {comparison.functions.map((fn, index) => <article className="function-explanation" key={`${fn.name}:${index}`}><h3>{fn.name || fn.displayName || 'Anonymous source unit'}</h3>{fn.statements.map((statement, index) => <div key={index} className={`statement-change ${statement.change}`}><small>{statement.change}</small>
          {statement.previous && statement.change !== 'unchanged' && <button className="statement" onClick={() => onSelect(statement.previous!.reference)}>− {statement.previous.text}</button>}
          {statement.current && <button className="statement" onClick={() => onSelect(statement.current!.reference)}>{statement.change === 'unchanged' ? '' : '+ '}{statement.current.text}</button>}
          {(statement.current?.uncertainty || statement.previous?.uncertainty) && <p className="uncertainty">Uncertain: {statement.current?.uncertainty || statement.previous?.uncertainty}</p>}
        </div>)}</article>)}
      </>}
    </>}
  </section>;
}
