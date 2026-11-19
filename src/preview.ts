const IMAGE_DATA = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi;

export function searchPattern(query: string): RegExp | null {
  return query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
}

export function messagePreview(content: string, query: string, expanded: boolean) {
  const readable = content.replace(IMAGE_DATA, '[Embedded image payload · hidden in preview]');
  const limit = expanded ? 12000 : 1100;
  const position = searchPattern(query)?.exec(readable)?.index ?? -1;
  const contextual = position >= 0 && position + query.length > limit;
  const start = contextual ? Math.max(0, position - Math.floor(limit * 0.35)) : 0;
  const end = Math.min(readable.length, Math.max(start + limit, contextual ? position + query.length : 0));
  return {
    text: `${start ? '…\n' : ''}${readable.slice(start, end)}${end < readable.length ? '\n…' : ''}`,
    contextual,
    expandable: readable.length > 1100,
    shortened: start > 0 || end < readable.length,
  };
}
