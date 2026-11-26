import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isModB,
  isWithinPullRequestWorkspace,
  pullRequestShortcutKey,
  setSingleKeyShortcutsEnabled,
  singleKeyShortcutsEnabled,
  subscribeSingleKeyShortcuts
} from './pullRequestShortcuts';

// A fake element whose `closest` matches any selector containing one of `ancestors`.
function element(tagName = 'DIV', ancestors: string[] = [], isContentEditable = false): EventTarget {
  return {
    tagName,
    isContentEditable,
    closest: (selector: string) => (ancestors.some((ancestor) => selector.includes(ancestor)) ? {} : null)
  } as unknown as EventTarget;
}

function key(value: string, init: Partial<KeyboardEvent> & { altGraph?: boolean } = {}) {
  const { altGraph = false, ...rest } = init;
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: element(),
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
    ...rest
  };
}

describe('pullRequestShortcutKey', () => {
  it('returns letters lower-case only without modifiers', () => {
    expect(pullRequestShortcutKey(key('j'))).toBe('j');
    expect(pullRequestShortcutKey(key('J', { shiftKey: true }))).toBeUndefined();
    expect(pullRequestShortcutKey(key('j', { ctrlKey: true }))).toBeUndefined();
    expect(pullRequestShortcutKey(key('j', { altKey: true }))).toBeUndefined();
    expect(pullRequestShortcutKey(key('J', { metaKey: true }))).toBeUndefined();
  });

  it('matches punctuation by key with Shift or AltGr but never Ctrl or Meta', () => {
    expect(pullRequestShortcutKey(key('?', { shiftKey: true }))).toBe('?');
    expect(pullRequestShortcutKey(key('[', { altKey: true }))).toBe('[');
    expect(pullRequestShortcutKey(key(']', { ctrlKey: true, altKey: true, altGraph: true }))).toBe(']');
    expect(pullRequestShortcutKey(key('/', { ctrlKey: true }))).toBeUndefined();
    expect(pullRequestShortcutKey(key('/', { metaKey: true }))).toBeUndefined();
  });

  it('accepts arrows only without modifiers', () => {
    expect(pullRequestShortcutKey(key('ArrowDown'))).toBe('ArrowDown');
    expect(pullRequestShortcutKey(key('ArrowDown', { shiftKey: true }))).toBeUndefined();
  });

  it('ignores handled, composing, editable and overlay events', () => {
    expect(pullRequestShortcutKey(key('j', { defaultPrevented: true }))).toBeUndefined();
    expect(pullRequestShortcutKey(key('j', { isComposing: true }))).toBeUndefined();
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(pullRequestShortcutKey(key('j', { target: element(tag) }))).toBeUndefined();
    }
    expect(pullRequestShortcutKey(key('j', { target: element('DIV', [], true) }))).toBeUndefined();
    for (const role of ['menu', 'dialog', 'listbox']) {
      expect(pullRequestShortcutKey(key('j', { target: element('BUTTON', [`role="${role}"`]) }))).toBeUndefined();
    }
  });

  it('ignores keys that are not shortcuts', () => {
    expect(pullRequestShortcutKey(key('Enter'))).toBeUndefined();
    expect(pullRequestShortcutKey(key('1'))).toBeUndefined();
  });
});

describe('isWithinPullRequestWorkspace', () => {
  it('accepts targets inside the workspace', () => {
    expect(isWithinPullRequestWorkspace(element('BUTTON', ['data-pull-request-workspace']))).toBe(true);
    expect(isWithinPullRequestWorkspace(element('BUTTON'))).toBe(false);
    expect(isWithinPullRequestWorkspace(null)).toBe(false);
  });
});

describe('isModB', () => {
  it('uses Meta on macOS and Ctrl elsewhere', () => {
    expect(isModB(key('b', { metaKey: true }), true)).toBe(true);
    expect(isModB(key('b', { ctrlKey: true }), true)).toBe(false);
    expect(isModB(key('b', { ctrlKey: true }), false)).toBe(true);
    expect(isModB(key('B', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });
});

describe('single-key shortcut preference', () => {
  afterEach(() => setSingleKeyShortcutsEnabled(true));

  it('is on by default and notifies subscribers when changed', () => {
    expect(singleKeyShortcutsEnabled()).toBe(true);
    const listener = vi.fn();
    const unsubscribe = subscribeSingleKeyShortcuts(listener);
    setSingleKeyShortcutsEnabled(false);
    expect(singleKeyShortcutsEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setSingleKeyShortcutsEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
