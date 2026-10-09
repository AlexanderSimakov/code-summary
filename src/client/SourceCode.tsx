import { useMemo } from 'react';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import type { Root, RootContent } from 'hast';
import type { SourceReference } from '../shared/explanation.js';

const highlighter = createLowlight({ javascript, typescript, json, xml, css, diff });
const languages: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', css: 'css',
};
type Segment = { text: string; className: string };

function highlightLines(source: string, language: string | undefined): Segment[][] {
  const lines: Segment[][] = [[]];
  // Tokenize the whole file so multiline comments and strings retain their syntax.
  const tree: Root = language ? highlighter.highlight(language, source) : {
    type: 'root', children: [{ type: 'text', value: source }],
  };
  function visit(node: Root | RootContent, classes: string[] = []) {
    if (node.type === 'text') {
      node.value.split('\n').forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines[lines.length - 1].push({ text, className: classes.join(' ') });
      });
    } else if (node.type === 'root' || node.type === 'element') {
      const own = node.type === 'element' ? node.properties.className : [];
      const next = [...classes, ...(Array.isArray(own) ? own.map(String) : [])];
      node.children.forEach(child => visit(child, next));
    }
  }
  visit(tree);
  return lines;
}

export function SourceCode({ source, path, view, highlight }: {
  source: string;
  path: string;
  view: 'source' | 'previous' | 'diff';
  highlight: SourceReference | null;
}) {
  const language = view === 'diff' ? 'diff' : languages[path.split('.').pop()?.toLowerCase() ?? ''];
  const lines = useMemo(() => highlightLines(source, language), [source, language]);
  return <pre aria-label="Source code">{lines.map((segments, index) => {
    const text = segments.map(segment => segment.text).join('');
    const className = view === 'diff'
      ? text.startsWith('+') ? 'addition' : text.startsWith('-') ? 'removal' : ''
      : highlight && highlight.version === (view === 'previous' ? 'previous' : 'current')
        && index + 1 >= highlight.startLine && index + 1 <= highlight.endLine ? 'source-highlight' : '';
    return <div id={`source-line-${index + 1}`} key={index} className={className}>
      <span className="line-number">{index + 1}</span>
      <code>{segments.length ? segments.map((segment, token) =>
        <span key={token} className={segment.className || undefined}>{segment.text}</span>) : ' '}</code>
    </div>;
  })}</pre>;
}
