import { useEffect, useRef, useState } from 'react';
import type { FileReview } from '../shared/review.js';
import type { AnalysisPreview, FileExplanation, ModelSettings, SourceReference } from '../shared/explanation.js';
import { ContextSettings } from './ContextSettings.js';
import { api } from './api.js';
import { useGeneration } from './useGeneration.js';
import { UsageReport } from './UsageReport.js';

export function ExplanationPanel({ file, onSelect }: { file: FileReview | null; onSelect: (reference: SourceReference) => void }) {
  const [model, setModel] = useState('openai/gpt-4.1-mini');
  const [contextLimitBytes, setContextLimitBytes] = useState(65536);
  const [configured, setConfigured] = useState(false);
  const [preview, setPreview] = useState<AnalysisPreview | null>(null);
  const [explanation, setExplanation] = useState<FileExplanation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const generation = useGeneration();
  useEffect(() => { api<ModelSettings>('settings', {}).then(settings => { setModel(settings.model); setConfigured(settings.configured); }).catch(error => setError(error.message)); }, []);
  useEffect(() => { generation.cancel(); ++request.current; setPreview(null); setExplanation(null); setError(''); setBusy(false); }, [file, generation.cancel]);
  async function prepare() {
    if (!file) return;
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const result = await api<AnalysisPreview>('analysis/preview', { repositoryPath: file.repositoryPath, filePath: file.path, model, contextLimitBytes });
      if (id === request.current) setPreview(result);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setBusy(false); }
  }
  async function generate() {
    if (!preview) return;
    const id = ++request.current;
    setError('');
    try {
      const result = await generation.run(signal => api<FileExplanation>('analysis/generate', { previewId: preview.id }, signal));
      if (result && id === request.current) setExplanation(result);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setBusy(false); }
  }
  return <section className="explanations" aria-label="English explanations"><h2>English review</h2>
    {!file ? <p className="empty">Choose a file to begin.</p> : !file.supported ? <p>This file is unsupported for explanations. Source remains available.</p> : <>
      <label className="model-setting">OpenRouter model<input aria-label="OpenRouter model" value={model} onChange={event => { setModel(event.target.value); setPreview(null); }} disabled={busy || generation.pending} /></label>
      <ContextSettings value={contextLimitBytes} onChange={value => { setContextLimitBytes(value); setPreview(null); }} disabled={busy || generation.pending} />
      {!configured && <p className="muted">Configure OPENROUTER_API_KEY in the local server .env file before generation. Source browsing needs no key.</p>}
      <button onClick={prepare} disabled={busy || generation.pending}>Preview transmission</button>
      {preview && <div className="transmission" aria-label="Transmission preview"><h3>Source sent to OpenRouter</h3><p>Model: {preview.model}. Opening this preview sends nothing.</p>
        {preview.contextWarnings?.map(warning => <p className="uncertainty" key={warning}>Context warning: {warning}</p>)}
        {preview.unavailableReason && <p role="alert" className="error">{preview.unavailableReason}</p>}
        {preview.files.map(source => <details key={`${source.path}:${source.version}`}><summary>{source.path} · {source.version}</summary><pre>{source.content}</pre></details>)}
        <p>Includes {preview.functions.length} complete named functions. Source is sent only when you generate.</p>
        <button onClick={generate} disabled={busy || generation.pending || Boolean(preview.unavailableReason)}>{error ? 'Retry generation' : 'Generate explanations'}</button>
      </div>}
      {busy && <p role="status">Preparing transmission preview…</p>}
      {generation.pending && <div><p role="status">Generating explanations…</p><button onClick={() => { generation.cancel(); setError('Generation cancelled. Provider charges may still apply.'); }}>Cancel generation</button></div>}
      {explanation && <UsageReport usage={explanation.usage} />}
      {error && <p role="alert" className="error">{error}</p>}
      {explanation?.functions.map(fn => <article className="function-explanation" key={fn.id}><h3>{fn.name}</h3>{fn.statements.map((statement, index) => <div key={index}><button className="statement" onClick={() => onSelect(statement.reference)}>{statement.text}</button>{statement.uncertainty && <p className="uncertainty">Uncertain: {statement.uncertainty}</p>}</div>)}</article>)}
    </>}
  </section>;
}
