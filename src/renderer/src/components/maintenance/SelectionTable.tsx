import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';

import { headerCheckboxState } from './maintenanceSelection';

export type SelectionColumn<T> = {
  id: string;
  header: ReactNode;
  className?: string;
  render: (item: T) => ReactNode;
};

export type SelectionTableProps<T> = {
  items: readonly T[];
  columns: ReadonlyArray<SelectionColumn<T>>;
  getId: (item: T) => string;
  getName: (item: T) => string;
  /** Plural noun used in "Select all visible …". */
  pluralNoun: string;
  isEligible: (item: T) => boolean;
  /** Protected rows show a lock instead of a checkbox. */
  isProtected: (item: T) => boolean;
  selected: ReadonlySet<string>;
  /** The plan is stale or a mutation is running. */
  disabled: boolean;
  isAtLimit: boolean;
  limitTitle: string;
  onToggleAll: () => void;
  onRowClick: (id: string, shift: boolean) => void;
};

/**
 * Table with a header select-all checkbox, row and checkbox selection, and
 * Shift-click ranges. Range logic lives in the caller so it can honour the
 * current visible order and the per-cleanup limit.
 */
export function SelectionTable<T>({
  items,
  columns,
  getId,
  getName,
  pluralNoun,
  isEligible,
  isProtected,
  selected,
  disabled,
  isAtLimit,
  limitTitle,
  onToggleAll,
  onRowClick
}: SelectionTableProps<T>): ReactElement {
  const headerRef = useRef<HTMLInputElement>(null);
  const eligibleIds = items.filter(isEligible).map(getId);
  const headerState = headerCheckboxState(selected, eligibleIds);

  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = headerState === 'some';
    }
  }, [headerState]);

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, id: string, enabled: boolean): void {
    if (!enabled || (event.target as HTMLElement).closest('input, button, a, code')) {
      return;
    }

    onRowClick(id, event.shiftKey);
  }

  return (
    <table className="w-full table-fixed border-collapse text-left text-[11.5px]">
      <thead className="sticky top-0 z-[1] bg-[var(--bg-panel)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">
        <tr className="border-b border-[var(--border)]">
          <th className="w-10 py-1.5 pl-4 pr-1">
            <input
              ref={headerRef}
              type="checkbox"
              className="align-middle"
              checked={headerState === 'all'}
              disabled={disabled || eligibleIds.length === 0 || (headerState === 'none' && isAtLimit)}
              aria-checked={headerState === 'some' ? 'mixed' : headerState === 'all'}
              aria-label={`Select all visible ${pluralNoun}`}
              title={eligibleIds.length === 0 ? `No visible ${pluralNoun} can be selected` : `Select all visible ${pluralNoun}`}
              onChange={onToggleAll}
            />
          </th>
          {columns.map((column) => (
            <th key={column.id} className={`px-2 py-1.5 ${column.className ?? ''}`}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {items.map((item) => {
          const id = getId(item);
          const eligible = isEligible(item);
          const isSelected = selected.has(id);
          const blockedByLimit = eligible && !isSelected && isAtLimit;
          const enabled = eligible && !disabled && !blockedByLimit;

          return (
            <tr
              key={id}
              className={`align-top ${isSelected ? 'bg-[var(--select-bg)]' : enabled ? 'hover:bg-[var(--bg-hover)]' : ''} ${eligible ? '' : 'text-[var(--text-3)]'} ${enabled ? 'cursor-pointer' : ''}`}
              onMouseDown={(event) => {
                // Shift-click selects a range; keep it from also selecting text.
                if (event.shiftKey && enabled) {
                  event.preventDefault();
                }
              }}
              onClick={(event) => handleRowClick(event, id, enabled)}
            >
              <td className="py-1.5 pl-4 pr-1">
                {isProtected(item) ? (
                  <Lock size={13} className="mt-0.5 text-[var(--text-3)]" aria-label={`${getName(item)} is protected`} />
                ) : (
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={isSelected}
                    disabled={!enabled}
                    aria-label={`Select ${getName(item)}`}
                    title={blockedByLimit ? limitTitle : undefined}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const native = event.nativeEvent as Partial<globalThis.MouseEvent>;
                      onRowClick(id, Boolean(native.shiftKey));
                    }}
                  />
                )}
              </td>
              {columns.map((column) => (
                <td key={column.id} className={`min-w-0 px-2 py-1.5 ${column.className ?? ''}`}>{column.render(item)}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
