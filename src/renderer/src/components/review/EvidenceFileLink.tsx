import { useInsertionEffect } from 'react';
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees';
import type { CodeReference } from '@shared/codeReference';

const icons = createFileTreeIconResolver({ set: 'complete', colored: true });

export function EvidenceFileLink({ reference, onOpen }: {
  reference: CodeReference;
  onOpen: (reference: CodeReference) => void;
}) {
  useInsertionEffect(() => {
    if (document.getElementById('evidence-file-icons')) return;
    const sprite = document.createElement('div');
    sprite.id = 'evidence-file-icons';
    sprite.hidden = true;
    // Trusted bundled icon symbols, never finding content.
    sprite.innerHTML = getBuiltInSpriteSheet('complete');
    document.body.appendChild(sprite);
  }, []);
  const icon = icons.resolveIcon('file-tree-icon-file', reference.path);
  const location = `${reference.path}${reference.line ? `:${reference.line}` : ''}`;
  const filename = reference.path.split('/').at(-1);
  return (
    <a className="evidence-file-chip" href={reference.path}
      title={`${location} · Open in your selected code editor`}
      aria-label={`Open ${location} in your selected code editor`}
      onClick={event => { event.preventDefault(); onOpen(reference); }}>
      <svg aria-hidden="true" viewBox={icon.viewBox ?? '0 0 16 16'} data-icon-token={icon.token}>
        <use href={`#${icon.name}`} />
      </svg>
      <span className="evidence-file-chip-name">{filename}</span>
      {reference.line ? <span className="evidence-file-chip-line">:{reference.line}</span> : null}
    </a>
  );
}
