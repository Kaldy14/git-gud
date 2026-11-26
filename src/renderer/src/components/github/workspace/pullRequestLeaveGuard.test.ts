import { describe, expect, it, vi } from 'vitest';

import { createLeaveGate, createUnsavedTextRegistry } from './pullRequestLeaveGuard';

function setup(...unsaved: string[]) {
  const registry = createUnsavedTextRegistry();
  for (const id of unsaved) registry.report(id, true);
  const onPendingChange = vi.fn();
  return { registry, gate: createLeaveGate(registry, onPendingChange), onPendingChange };
}

describe('pull request leave guard', () => {
  it('leaves at once when no editor holds text', () => {
    const { gate, onPendingChange } = setup();
    const action = vi.fn();
    gate.request(action);
    expect(action).toHaveBeenCalledOnce();
    expect(onPendingChange).not.toHaveBeenCalled();
  });

  it('asks while any editor holds text and stops asking once all are cleared', () => {
    const { registry, gate, onPendingChange } = setup('composer', 'summary');
    const action = vi.fn();
    gate.request(action);
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(action).not.toHaveBeenCalled();
    gate.keep();

    registry.report('composer', false);
    expect(registry.hasUnsavedText()).toBe(true);
    registry.report('summary', false);
    gate.request(action);
    expect(action).toHaveBeenCalledOnce();
  });

  it('notifies subscribers only when unsaved text appears or goes away', () => {
    const { registry } = setup();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.report('composer', true);
    registry.report('summary', true);
    registry.report('composer', false);
    expect(listener).toHaveBeenCalledOnce();
    registry.report('summary', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays armed after a discard that switched nothing', () => {
    const { gate } = setup('composer');
    gate.request(() => undefined);
    gate.discard();
    const next = vi.fn();
    gate.request(next);
    expect(next).not.toHaveBeenCalled();
  });

  it('declines a second request while one is pending and runs only the first on discard', () => {
    const { gate } = setup('composer');
    const first = vi.fn();
    const second = vi.fn();
    const secondKept = vi.fn();
    gate.request(first);
    gate.request(second, secondKept);
    expect(secondKept).toHaveBeenCalledOnce();
    gate.discard();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('reports "Keep editing" to the caller', () => {
    const { gate, onPendingChange } = setup('composer');
    const action = vi.fn();
    const kept = vi.fn();
    gate.request(action, kept);
    gate.keep();
    expect(kept).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });
});
