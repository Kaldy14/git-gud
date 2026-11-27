import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Check, Map as MapIcon } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import type { PullRequestTourStop } from '@shared/pullRequestTour';

import { InlineCodeText } from '../overview/overviewParts';
import { plainTourText } from './tourText';
import type { TourLineCount } from './tourVisuals';

/**
 * The whole tour at a glance, from the progress strip: one row per step with its change volume (green added,
 * red removed, against the largest step), risk, whether it has a call to make, and whether it is reviewed.
 * Choosing a row opens that step. ↑/↓ move between rows; Escape closes and returns to the toggle.
 */
export function TourStepMap({ stops, step, reviewed, lines, onGo }: {
  stops: readonly Pick<PullRequestTourStop, 'title' | 'kind' | 'risk' | 'attention'>[];
  step: number;
  reviewed: readonly number[];
  lines: readonly TourLineCount[];
  onGo: (step: number) => boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // A chosen row moves focus to the new step's heading; only Escape or an outside click returns it to Map.
  const movedRef = useRef(false);
  const largest = Math.max(1, ...lines.map((count) => count.added + count.removed));

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = rows();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[Math.min(buttons.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className="btn-subtle btn-compact pr-tour-map-toggle" aria-label="Tour map: every step at a glance" title="Tour map">
          <MapIcon size={14} aria-hidden="true" />
          Map
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="pr-tour-map"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Tour map"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            rows()[step]?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (movedRef.current) event.preventDefault();
            movedRef.current = false;
          }}
          onKeyDown={onKeyDown}
        >
          <ol ref={listRef}>
            {stops.map((stop, index) => {
              const count = lines[index] ?? { added: 0, removed: 0 };
              const isReviewed = reviewed.includes(index);
              const risk = stop.risk === 'medium' || stop.risk === 'high' ? stop.risk : undefined;
              return (
                <li key={index}>
                  <button
                    type="button"
                    className="pr-tour-map-row"
                    data-current={index === step || undefined}
                    data-kind={stop.kind}
                    aria-current={index === step ? 'step' : undefined}
                    aria-label={`Step ${index + 1}: ${plainTourText(stop.title)}. ${count.added} added, ${count.removed} removed${risk ? `, ${risk} risk` : ''}${stop.attention ? ', a call to make' : ''}${isReviewed ? ', reviewed' : ''}`}
                    onClick={() => {
                      if (!onGo(index)) return;
                      movedRef.current = index !== step;
                      setOpen(false);
                    }}
                  >
                    <span className="pr-tour-map-number" aria-hidden="true">{index + 1}</span>
                    <span className="pr-tour-map-title pr-tour-inline"><InlineCodeText text={stop.title} /></span>
                    <span className="pr-tour-map-volume" aria-hidden="true">
                      <span style={{ width: `${Math.max(4, ((count.added + count.removed) / largest) * 100)}%` }}>
                        <i data-kind="added" style={{ flexGrow: count.added }} />
                        <i data-kind="deleted" style={{ flexGrow: count.removed }} />
                      </span>
                    </span>
                    <span className="pr-tour-map-risk" data-risk={risk} aria-hidden="true" />
                    <span className="pr-tour-map-attention" data-attention={stop.attention ? '' : undefined} aria-hidden="true" />
                    <span className="pr-tour-map-reviewed" aria-hidden="true">{isReviewed ? <Check size={12} /> : null}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
