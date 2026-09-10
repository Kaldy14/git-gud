import { useState } from 'react';

export function CopyRepairPromptButton({ prompt }: { prompt: string }) {
  const [result, setResult] = useState<{ prompt: string; status: 'copied' | 'failed' }>();
  const status = result?.prompt === prompt ? result.status : undefined;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setResult({ prompt, status: 'copied' });
    } catch {
      setResult({ prompt, status: 'failed' });
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        className="btn-subtle h-6 shrink-0 px-2 text-[11px]"
        type="button"
        onClick={() => void copyPrompt()}
        title="Copy the repository path, Git errors, and repair instructions for your AI agent"
      >
        Copy repair prompt
      </button>
      <span className="text-[11px]" role="status">
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed. Try again.' : ''}
      </span>
    </div>
  );
}
