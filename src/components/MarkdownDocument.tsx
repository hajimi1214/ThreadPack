import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import HighlightedCode from './HighlightedCode';

const plugins = [remarkGfm];

function MarkdownDocument({ source, imageLabel, className = '' }: { source: string; imageLabel: string; className?: string }) {
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => href
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>,
    img: ({ alt }) => <span className="markdown-image-omitted">{alt || imageLabel}</span>,
    pre: ({ children }) => <div className="markdown-code-frame">{children}</div>,
    code: ({ className: tokenClass, children }) => {
      const language = tokenClass?.match(/language-([^\s]+)/)?.[1];
      if (!language) return <code>{children}</code>;
      return <HighlightedCode code={String(children)} language={language} wrap={false} />;
    },
  }), [imageLabel]);

  return <div className={`markdown-document ${className}`}>
    <ReactMarkdown remarkPlugins={plugins} components={components}>{source}</ReactMarkdown>
  </div>;
}

export default memo(MarkdownDocument);
