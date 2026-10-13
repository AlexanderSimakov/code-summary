import { useEffect, useRef, useState } from 'react';
import type { FileReview } from '../shared/review.js';
import type { AnalysisPreview, FileExplanation, ModelSettings } from '../shared/explanation.js';
import type { ComparisonPreview, FileComparison } from '../shared/comparison.js';
import { api } from './api.js';
import { useGeneration } from './useGeneration.js';
import { useFreshness } from './useFreshness.js';

type Reviews = {
  analysis: { preview: AnalysisPreview; result: FileExplanation };
  comparison: { preview: ComparisonPreview; result: FileComparison };
};

/** Owns asynchronous work for the selected English review. Views supply source matching and rendering. */
export function useEnglishReview<K extends keyof Reviews>(kind: K, file: FileReview | null,
  matchesSelectedFile: (preview: Reviews[K]['preview']) => boolean, onOutdated: () => void) {
  const [model, updateModel] = useState('openai/gpt-4.1-mini');
  const [contextLimitBytes, setContextLimitBytes] = useState(65536);
  const [configured, setConfigured] = useState(false);
  const [preview, setPreview] = useState<Reviews[K]['preview'] | null>(null);
  const [result, setResult] = useState<Reviews[K]['result'] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Cache, preparation and generation share one ownership token. Explicit work
  // supersedes cache restoration as well as any older explicit request.
  const request = useRef(0);
  const editedModel = useRef(false);
  const generation = useGeneration();
  useEffect(() => {
    let active = true;
    api<ModelSettings>('settings', {}).then(settings => {
      if (!active) return;
      if (!editedModel.current) updateModel(settings.model);
      setConfigured(settings.configured);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    ++request.current;
    generation.cancel();
    setPreview(null); setResult(null); setError(''); setBusy(false);
    return () => { ++request.current; generation.cancel(); };
  }, [file, model, contextLimitBytes, kind, generation.cancel]);
  useFreshness(kind, result?.previewId, onOutdated);
  useEffect(() => {
    if (!file?.supported) return;
    const id = request.current;
    let active = true;
    api<{ preview: Reviews[K]['preview']; explanation?: FileExplanation | null; comparison?: FileComparison | null }>(`${kind}/cache`, {
      repositoryPath: file.repositoryPath, filePath: file.path, model, contextLimitBytes,
    }).then(cached => {
      if (!active || id !== request.current) return;
      if (!matchesSelectedFile(cached.preview)) { onOutdated(); return; }
      const restored = (kind === 'analysis' ? cached.explanation : cached.comparison) as Reviews[K]['result'] | null | undefined;
      if (restored) { setPreview(cached.preview); setResult(restored); }
    }).catch(() => {});
    return () => { active = false; };
  }, [file, model, contextLimitBytes, kind]);
  async function prepare() {
    if (!file) return;
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const prepared = await api<Reviews[K]['preview']>(`${kind}/preview`, { repositoryPath: file.repositoryPath, filePath: file.path, model, contextLimitBytes });
      if (id !== request.current) return;
      if (!matchesSelectedFile(prepared)) {
        onOutdated();
        throw new Error('Source changed. Refresh review before preparing a transmission.');
      }
      setPreview(prepared);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
    finally { if (id === request.current) setBusy(false); }
  }
  async function generate() {
    if (!preview) return;
    const id = ++request.current;
    setError('');
    try {
      const generated = await generation.run(signal => api<Reviews[K]['result']>(`${kind}/generate`, { previewId: preview.id }, signal));
      if (generated && id === request.current) setResult(generated);
    } catch (error) { if (id === request.current) setError((error as Error).message); }
  }
  function cancel() {
    ++request.current; generation.cancel(); setBusy(false);
    setError('Generation cancelled. Provider charges may still apply.');
  }
  function setModel(value: string) { editedModel.current = true; updateModel(value); }
  return { model, setModel, contextLimitBytes, setContextLimitBytes, configured, preview, result, error, busy,
    pending: generation.pending, prepare, generate, cancel };
}
