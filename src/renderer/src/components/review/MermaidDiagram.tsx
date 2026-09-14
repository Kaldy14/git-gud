import { useEffect, useState } from 'react';
import { ReviewImageGalleryDialog } from './ReviewImageGalleryDialog';

let renderer: Promise<typeof import('mermaid')['default']> | undefined;
let nextDiagramId = 0;

function loadRenderer() {
  renderer ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: 'dark',
      fontFamily: 'system-ui, sans-serif',
      htmlLabels: false,
      // Comments are untrusted. Diagram directives must not relax these settings.
      secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels']
    });
    return mermaid;
  });
  return renderer;
}

export function MermaidDiagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ src: string } | { error: string }>();
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        if (source.length > 50_000) throw new Error('Diagram is too large to render.');
        const mermaid = await loadRenderer();
        if (cancelled) return;
        const { svg } = await mermaid.render(`review-mermaid-${++nextDiagramId}`, source);
        // Display as an inert image, never inject comment-generated SVG into the app DOM.
        if (!cancelled) setResult({ src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      } catch {
        if (!cancelled) setResult({ error: 'Diagram could not be rendered. The Mermaid source is shown below.' });
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [source]);

  const failed = result && 'error' in result;
  return (
    <div className="review-mermaid">
      <div className="review-mermaid-toolbar">
        <span>Mermaid diagram</span>
        <div>
          {result && 'src' in result ? (
            <button type="button" className="btn-ghost btn-compact" onClick={() => setExpanded(true)}>Expand diagram</button>
          ) : null}
          {!failed ? (
            <button type="button" className="btn-ghost btn-compact" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>
              {showSource ? 'Show diagram' : 'Show source'}
            </button>
          ) : null}
        </div>
      </div>
      {failed ? <p role="status">{result.error}</p> : !result && !showSource ? <p role="status">Rendering diagram…</p> : null}
      {showSource || failed ? <pre><code className="language-mermaid">{source}</code></pre> : result && 'src' in result ? (
        <div className="review-mermaid-canvas" tabIndex={0} role="region" aria-label="Mermaid diagram, scroll to view">
          <img src={result.src} alt="Rendered Mermaid diagram" onError={() => setResult({ error: 'Diagram could not be displayed. The Mermaid source is shown below.' })} />
        </div>
      ) : null}
      {expanded && result && 'src' in result ? <ReviewImageGalleryDialog
        selection={{ images: [{ src: result.src, alt: 'Mermaid diagram' }], index: 0 }}
        onClose={() => setExpanded(false)}
      /> : null}
    </div>
  );
}
