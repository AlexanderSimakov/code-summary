import type { GenerationUsage } from '../shared/explanation.js';

export function UsageReport({ usage }: { usage?: GenerationUsage }) {
  return <div aria-label="Reported AI usage" className="muted"><h3>Reported AI usage</h3>
    <p>Input tokens: {usage?.promptTokens ?? 'Unavailable'} · Output tokens: {usage?.completionTokens ?? 'Unavailable'} · Total tokens: {usage?.totalTokens ?? 'Unavailable'}</p>
    <p>Cost (credits): {usage?.cost ?? 'Unavailable'}</p>
  </div>;
}
