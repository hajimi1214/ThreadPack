import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { RootContent } from 'hast';
import { highlightCode } from '../code-highlight';

function renderTokens(nodes: readonly RootContent[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element' || node.tagName !== 'span') return null;
    const classes = Array.isArray(node.properties.className) ? node.properties.className.filter(value => typeof value === 'string').join(' ') : undefined;
    return <span key={index} className={classes}>{renderTokens(node.children)}</span>;
  });
}

function HighlightedCode({ code, language, wrap }: { code: string; language: string; wrap: boolean }) {
  const tree = useMemo(() => highlightCode(code, language), [code, language]);
  return <pre className={`snippet-code highlighted-code${wrap ? ' is-wrapped' : ''}`} data-highlighted={tree.data.highlighted}>
    <code>{renderTokens(tree.children)}</code>
  </pre>;
}

export default memo(HighlightedCode);
