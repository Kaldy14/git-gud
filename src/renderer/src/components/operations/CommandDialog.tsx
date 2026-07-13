import type { FormEvent, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';

type CommandDialogTone = 'default' | 'danger';

type CommandDialogTextField = {
  id: string;
  kind: 'text';
  label: string;
  value: string;
  placeholder?: string;
  helper?: string;
  required?: boolean;
  autoFocus?: boolean;
};

type CommandDialogSelectField = {
  id: string;
  kind: 'select';
  label: string;
  value: string;
  options: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  helper?: string;
};

type CommandDialogCheckboxField = {
  id: string;
  kind: 'checkbox';
  label: string;
  checked: boolean;
  helper?: string;
};

type CommandDialogField = CommandDialogTextField | CommandDialogSelectField | CommandDialogCheckboxField;

export type CommandDialogValues = {
  text: Record<string, string>;
  checked: Record<string, boolean>;
};

export type CommandDialogConfig = {
  id: string;
  title: string;
  description?: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: CommandDialogTone;
  fields: CommandDialogField[];
  onSubmit: (values: CommandDialogValues) => void;
};

type CommandDialogProps = {
  dialog: CommandDialogConfig;
  onClose: () => void;
};

export function CommandDialog({ dialog, onClose }: CommandDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const [fields, setFields] = useState<CommandDialogField[]>(dialog.fields);
  const canSubmit = useMemo(
    () => fields.every((field) => field.kind !== 'text' || !field.required || field.value.trim().length > 0),
    [fields]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    dialog.onSubmit(collectValues(fields));
    onClose();
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={dialog.description || dialog.detail ? descriptionId : undefined}
      className="w-full max-w-[440px] rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/60"
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <span className={dialog.tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--accent-2)]'}>
            {dialog.tone === 'danger' ? <AlertTriangle size={17} /> : <Check size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-semibold text-[var(--text-1)]">{dialog.title}</h2>
            {dialog.description ? <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--text-2)]">{dialog.description}</p> : null}
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={14} />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          {dialog.detail ? (
            <p id={dialog.description ? undefined : descriptionId} className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2 text-xs leading-5 text-[var(--text-2)]">
              {dialog.detail}
            </p>
          ) : null}
          {fields.map((field) => (
            <DialogField key={field.id} field={field} onChangeField={setDialogField} />
          ))}
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-3">
          <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>
            {dialog.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={dialog.tone === 'danger' ? 'btn-subtle h-8 border-[var(--danger-border)] text-xs text-[var(--danger-text)]' : 'btn-primary h-8 text-xs'}
            type="submit"
            disabled={!canSubmit}
          >
            {dialog.confirmLabel}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );

  function setDialogField(nextField: CommandDialogField): void {
    setFields((currentFields) => currentFields.map((field) => (field.id === nextField.id ? nextField : field)));
  }
}

function DialogField({
  field,
  onChangeField
}: {
  field: CommandDialogField;
  onChangeField: (field: CommandDialogField) => void;
}): ReactElement {
  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5 text-xs text-[var(--text-2)]">
        <input
          className="mt-0.5"
          type="checkbox"
          checked={field.checked}
          onChange={(event) => onChangeField({ ...field, checked: event.target.checked })}
        />
        <span className="min-w-0">
          <span className="block font-semibold text-[var(--text-1)]">{field.label}</span>
          {field.helper ? <span className="mt-1 block leading-5 text-[var(--text-3)]">{field.helper}</span> : null}
        </span>
      </label>
    );
  }

  return (
    <label className="block text-xs text-[var(--text-2)]">
      <span className="mb-1.5 block font-semibold text-[var(--text-1)]">{field.label}</span>
      {field.kind === 'text' ? (
        <input
          className="h-9 w-full rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
          value={field.value}
          placeholder={field.placeholder}
          autoFocus={field.autoFocus}
          onChange={(event) => onChangeField({ ...field, value: event.target.value })}
        />
      ) : (
        <select
          className="h-9 w-full rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
          value={field.value}
          onChange={(event) => onChangeField({ ...field, value: event.target.value })}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {field.helper ? <span className="mt-1.5 block leading-5 text-[var(--text-3)]">{field.helper}</span> : null}
      {field.kind === 'select' ? (
        <span className="mt-2 block space-y-1">
          {field.options
            .filter((option) => option.description)
            .map((option) => (
              <span key={option.value} className="block text-[11px] leading-4 text-[var(--text-3)]">
                <span className="font-semibold text-[var(--text-2)]">{option.label}:</span> {option.description}
              </span>
            ))}
        </span>
      ) : null}
    </label>
  );
}

function collectValues(fields: CommandDialogField[]): CommandDialogValues {
  const text: Record<string, string> = {};
  const checked: Record<string, boolean> = {};

  for (const field of fields) {
    if (field.kind === 'checkbox') {
      checked[field.id] = field.checked;
    } else {
      text[field.id] = field.value;
    }
  }

  return { text, checked };
}
