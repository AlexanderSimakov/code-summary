import type { FileReview } from '../shared/review.js';
import type { SourceReference } from '../shared/explanation.js';
import type { ComparisonPreview } from '../shared/comparison.js';
import { UsageReport } from './UsageReport.js';
import { useEnglishReview } from './useEnglishReview.js';
import { ContextSettings } from './ContextSettings.js';

export function ComparisonPanel({ file, onSelect, outdated = false, onOutdated = () => {} }: { file: FileReview; outdated?: boolean; onOutdated?: () => void; onSelect: (reference: SourceReference) => void }) {
  const { model, setModel, contextLimitBytes, setContextLimitBytes, preview, result: comparison, error, busy, pending, prepare, generate, cancel } = useEnglishReview('comparison', file, matchesSelectedFile, onOutdated);
  function matchesSelectedFile(value: ComparisonPreview) {
    return ['previous', 'current'].every(version => {
      const selected = value.files.find(source => source.path === file.path && source.version === version);
      return !selected || selected.content === (version === 'previous' ? file.previous?.content : file.current?.content);
    });
  }
  return <section className="explanations" aria-label="English explanations"><h2>English review</h2>
    {!file.supported || file.notice ? <p>This file is unsupported for explanations. Source remains available.</p> : <>
      <label className="model-setting">OpenRouter model<input aria-label="OpenRouter model" value={model} onChange={event => setModel(event.target.value)} disabled={busy || pending} /></label>
      <ContextSettings value={contextLimitBytes} onChange={setContextLimitBytes} disabled={busy || pending} />
      <button onClick={prepare} disabled={outdated || busy || pending}>Preview transmission</button>
      {preview && <div className="transmission" aria-label="Transmission preview"><h3>Source sent to OpenRouter</h3><p>Model: {preview.model}. Both HEAD and current versions are previewed. Opening this preview sends nothing.</p>
        {[preview.previous, preview.current].map((side, index) => side && <div key={index}>{!comparison && side.contextWarnings?.map(warning => <p className="uncertainty" key={warning}>Context warning: {warning}</p>)}{side.unavailableReason && <p role="alert" className="error">{side.unavailableReason}</p>}</div>)}
        {preview.files.map((source, index) => <details key={`${source.path}:${source.version}:${index}`}><summary>{source.path} · {source.version}</summary><pre>{source.content}</pre></details>)}
        <button onClick={generate} disabled={busy || pending || Boolean(preview.previous?.unavailableReason || preview.current?.unavailableReason)}>{error ? 'Retry generation' : 'Generate explanations'}</button>
      </div>}
      {(busy || pending) && <><p role="status">Preparing or generating English comparison…</p><button onClick={cancel}>Cancel generation</button></>}
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
