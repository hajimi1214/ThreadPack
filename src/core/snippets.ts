import type { Conversation } from './types';

export interface CodeSnippet {
  id: string;
  language: string;
  messageIndex: number;
  fenceIndex: number;
  start: number;
  end: number;
  lines: number;
  characters: number;
}

const languages: Record<string, { language: string; extension: string }> = {
  javascript: { language: 'javascript', extension: 'js' }, js: { language: 'javascript', extension: 'js' },
  jsx: { language: 'jsx', extension: 'jsx' }, typescript: { language: 'typescript', extension: 'ts' }, ts: { language: 'typescript', extension: 'ts' },
  tsx: { language: 'tsx', extension: 'tsx' }, python: { language: 'python', extension: 'py' }, py: { language: 'python', extension: 'py' },
  bash: { language: 'bash', extension: 'sh' }, sh: { language: 'bash', extension: 'sh' }, shell: { language: 'bash', extension: 'sh' }, zsh: { language: 'bash', extension: 'sh' },
  powershell: { language: 'powershell', extension: 'ps1' }, ps1: { language: 'powershell', extension: 'ps1' },
  sql: { language: 'sql', extension: 'sql' }, json: { language: 'json', extension: 'json' }, jsonc: { language: 'jsonc', extension: 'jsonc' },
  css: { language: 'css', extension: 'css' }, scss: { language: 'scss', extension: 'scss' }, html: { language: 'html', extension: 'html' },
  xml: { language: 'xml', extension: 'xml' }, markdown: { language: 'markdown', extension: 'md' }, md: { language: 'markdown', extension: 'md' },
  yaml: { language: 'yaml', extension: 'yaml' }, yml: { language: 'yaml', extension: 'yaml' },
  go: { language: 'go', extension: 'go' }, golang: { language: 'go', extension: 'go' }, rust: { language: 'rust', extension: 'rs' }, rs: { language: 'rust', extension: 'rs' },
  java: { language: 'java', extension: 'java' }, kotlin: { language: 'kotlin', extension: 'kt' }, kt: { language: 'kotlin', extension: 'kt' },
  c: { language: 'c', extension: 'c' }, cpp: { language: 'cpp', extension: 'cpp' }, 'c++': { language: 'cpp', extension: 'cpp' },
  cs: { language: 'csharp', extension: 'cs' }, csharp: { language: 'csharp', extension: 'cs' }, 'c#': { language: 'csharp', extension: 'cs' },
  ruby: { language: 'ruby', extension: 'rb' }, rb: { language: 'ruby', extension: 'rb' }, php: { language: 'php', extension: 'php' },
  swift: { language: 'swift', extension: 'swift' }, vue: { language: 'vue', extension: 'vue' }, svelte: { language: 'svelte', extension: 'svelte' },
  toml: { language: 'toml', extension: 'toml' }, ini: { language: 'ini', extension: 'ini' },
  text: { language: 'text', extension: 'txt' }, plaintext: { language: 'text', extension: 'txt' }, txt: { language: 'text', extension: 'txt' },
};

function knownLanguage(token: string): { language: string; extension: string } {
  // An allowlist keeps arbitrary info strings and filenames out of metadata and downloads.
  const key = token.toLowerCase();
  return Object.hasOwn(languages, key) ? languages[key]! : languages.text!;
}

export function snippetExtension(language: string): string { return knownLanguage(language).extension; }

function* lines(content: string): Generator<{ text: string; start: number; end: number }> {
  const newline = /\r\n|\r|\n/g;
  let start = 0;
  for (const match of content.matchAll(newline)) {
    const end = match.index + match[0].length;
    yield { text: content.slice(start, match.index), start, end };
    start = end;
  }
  if (start < content.length) yield { text: content.slice(start), start, end: content.length };
}

/** Store offsets into retained messages, never a second array of complete code bodies. */
export function extractCodeSnippets(conversation: Conversation): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex++) {
    const content = conversation.messages[messageIndex]!.content;
    let open: { marker: string; length: number; start: number; language: string; lines: number; ordinal: number } | null = null;
    let ordinal = 0;
    for (const line of lines(content)) {
      if (!open) {
        const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
        if (!fence || fence[1]![0] === '`' && fence[2]!.includes('`')) continue;
        const token = fence[2]!.trim().split(/\s+/, 1)[0] ?? '';
        open = { marker: fence[1]![0]!, length: fence[1]!.length, start: line.end,
          language: knownLanguage(token).language, lines: 0, ordinal: ++ordinal };
      } else {
        const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.text);
        if (closing && closing[1]![0] === open.marker && closing[1]!.length >= open.length) {
          snippets.push({ id: `message-${messageIndex + 1}-code-${open.ordinal}`, language: open.language,
            messageIndex, fenceIndex: open.ordinal - 1, start: open.start, end: line.start,
            lines: open.lines, characters: line.start - open.start });
          open = null;
        } else open.lines++;
      }
    }
  }
  return snippets;
}
