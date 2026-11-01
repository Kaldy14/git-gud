import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FolderGit2 } from 'lucide-react';

type RepositoryDropOverlayProps = {
  disabled: boolean;
  onOpenPaths: (paths: string[]) => void;
};

/** Accepts folders dragged from Finder anywhere in the window and opens them as repositories. */
export function RepositoryDropOverlay({ disabled, onOpenPaths }: RepositoryDropOverlayProps): ReactElement | null {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const latestRef = useRef({ disabled, onOpenPaths });

  useEffect(() => {
    latestRef.current = { disabled, onOpenPaths };
  });

  useEffect(() => {
    function carriesFiles(event: DragEvent): boolean {
      return Boolean(event.dataTransfer?.types.includes('Files'));
    }

    function handleDragEnter(event: DragEvent): void {
      if (!carriesFiles(event) || latestRef.current.disabled) return;
      dragDepthRef.current += 1;
      setIsDragging(true);
    }

    function handleDragOver(event: DragEvent): void {
      if (!carriesFiles(event)) return;
      // Always cancel the default so Electron never navigates to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = latestRef.current.disabled ? 'none' : 'copy';
    }

    function handleDragLeave(event: DragEvent): void {
      if (!carriesFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragging(false);
    }

    function handleDrop(event: DragEvent): void {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);

      if (latestRef.current.disabled) return;
      const paths = [...(event.dataTransfer?.files ?? [])]
        .map((file) => window.api.getPathForFile(file))
        .filter(Boolean);
      if (paths.length > 0) latestRef.current.onOpenPaths(paths);
    }

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  if (!isDragging) {
    return null;
  }

  return (
    <div className="repository-drop-overlay" role="status" aria-live="polite">
      <div className="repository-drop-overlay-card">
        <FolderGit2 size={28} aria-hidden="true" />
        <p>Drop to open as a repository</p>
        <span>Each dropped Git folder opens in its own tab.</span>
      </div>
    </div>
  );
}
