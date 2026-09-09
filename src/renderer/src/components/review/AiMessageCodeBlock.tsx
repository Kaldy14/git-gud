import { useMemo, useState } from 'react';
import { File } from '@pierre/diffs/react';
import { Check, Copy, WrapText } from 'lucide-react';
import type { DiffSyntaxTheme } from '@shared/types';
import { getDiffThemeName } from '../diff/diffTheme';

const extensions: Record<string, string> = { typescript: 'ts', javascript: 'js', bash: 'sh', shell: 'sh', markdown: 'md', yaml: 'yml', python: 'py', rust: 'rs', plaintext: 'txt' };

export function AiMessageCodeBlock({ code, language, theme }: {
  code: string;
  language: string;
  theme: DiffSyntaxTheme;
}) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const file = useMemo(() => ({ name: `snippet.${extensions[language] ?? (language || 'txt')}`, contents: code }), [code, language]);
  const options = useMemo(() => ({ theme: getDiffThemeName(theme), disableFileHeader: true, disableLineNumbers: true, overflow: wrap ? 'wrap' as const : 'scroll' as const }), [theme, wrap]);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setError(''); }
    catch { setError('Could not copy code. Select and copy the text instead.'); }
  }
  return <div className="ai-message-codeblock">
    <div className="ai-message-codeblock-header">
      <span>{language || 'text'}</span>
      <div>
        <button type="button" title="Wrap code" aria-label="Wrap code" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} /></button>
        <button type="button" title="Copy code" aria-label={copied ? 'Code copied' : 'Copy code'} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      </div>
    </div>
    <File className="gg-diff" file={file} options={options} />
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
