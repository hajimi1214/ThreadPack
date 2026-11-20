import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import markdown from 'highlight.js/lib/languages/markdown';
import type { ElementContent, Root, RootContent } from 'hast';

export const MAX_HIGHLIGHT_CHARACTERS = 2000;

const lowlight = createLowlight({ javascript, typescript, python, bash, sql, json, css, xml, go, rust, yaml, java, cpp, csharp, markdown });
const aliases: Record<string, string> = {
  javascript: 'javascript', js: 'javascript', jsx: 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  python: 'python', py: 'python', bash: 'bash', shell: 'bash', sh: 'bash', zsh: 'bash',
  sql: 'sql', json: 'json', css: 'css', html: 'xml', xml: 'xml',
  go: 'go', golang: 'go', rust: 'rust', rs: 'rust', yaml: 'yaml', yml: 'yaml',
  java: 'java', cpp: 'cpp', c: 'cpp', 'c++': 'cpp', csharp: 'csharp', cs: 'csharp', 'c#': 'csharp',
  markdown: 'markdown', md: 'markdown',
};
const secondaryClasses = new Set(['class_', 'function_', 'inherited__', 'invoke__', 'constant_']);

export interface HighlightTree extends Root {
  data: { language: string; highlighted: boolean };
}

function plain(code: string): HighlightTree {
  return { type: 'root', children: [{ type: 'text', value: code }], data: { language: 'text', highlighted: false } };
}

function textOf(nodes: readonly RootContent[]): string {
  return nodes.map(node => node.type === 'text' ? node.value : node.type === 'element' ? textOf(node.children) : '').join('');
}

/** The highlighter produces a virtual tree; only text and classed spans are retained. */
function safeNodes(nodes: readonly RootContent[], budget: { count: number }, depth = 0): ElementContent[] {
  if (depth > 50) throw new Error('Highlight tree exceeds the rendering limit.');
  return nodes.map(node => {
    if (++budget.count > 8000) throw new Error('Highlight tree exceeds the rendering limit.');
    if (node.type === 'text') return { type: 'text', value: node.value };
    if (node.type !== 'element' || node.tagName !== 'span') throw new Error('Unsupported highlight token.');
    const className = Array.isArray(node.properties.className) ? node.properties.className.filter((value): value is string =>
      typeof value === 'string' && (/^hljs-[a-z0-9_-]+$/.test(value) || secondaryClasses.has(value)),
    ) : [];
    return { type: 'element', tagName: 'span', properties: { className }, children: safeNodes(node.children, budget, depth + 1) };
  });
}

/** Highlight bounded preview text only; unsupported inputs remain complete plain text. */
export function highlightCode(code: string, language: string): HighlightTree {
  if (code.length > MAX_HIGHLIGHT_CHARACTERS) return plain(code);
  const key = language.toLowerCase();
  if (!Object.hasOwn(aliases, key)) return plain(code);
  const canonical = aliases[key]!;
  try {
    const highlighted = lowlight.highlight(canonical, code);
    const children = safeNodes(highlighted.children, { count: 0 });
    // A grammar must never change the text used for copying or visual review.
    if (textOf(children) !== code) return plain(code);
    return { type: 'root', children, data: { language: canonical, highlighted: true } };
  } catch {
    return plain(code);
  }
}
