import { describe, expect, it } from 'vitest';

import { shortcutBarItems, shortcutDialogSections, shortcutKeyLabel } from './pullRequestShortcutList';

const labels = (items: ReturnType<typeof shortcutBarItems>) => items.map((item) => item.label);

describe('shortcut bar', () => {
  it('shows the workspace keys on every tab', () => {
    expect(labels(shortcutBarItems('overview'))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar']);
    expect(labels(shortcutBarItems('conversation'))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar']);
  });

  it('adds the diff keys on Code and the step keys on Tour', () => {
    expect(labels(shortcutBarItems('code'))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar', 'files', 'viewed', 'lines', 'comment']);
    // Blocks walks blocks; the line cursor and C belong to the files view.
    expect(labels(shortcutBarItems('blocks'))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar', 'blocks', 'viewed']);
    expect(labels(shortcutBarItems('tour'))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar', 'steps', 'reviewed', 'files', 'viewed', 'lines', 'comment']);
  });

  it('drops the step and diff keys on a Tour without a usable tour', () => {
    expect(labels(shortcutBarItems('tour', true, false))).toEqual(['switch PR', 'switch tabs', 'search', 'sidebar']);
    expect(labels(shortcutBarItems('code', true, false))).toContain('viewed');
  });

  it('keeps only modified shortcuts when single-key shortcuts are off', () => {
    expect(labels(shortcutBarItems('code', false))).toEqual(['sidebar']);
  });
});

describe('shortcuts dialog', () => {
  it('lists every shortcut once, by area', () => {
    const sections = shortcutDialogSections();
    expect(sections.map((section) => section.area)).toEqual(['Pull requests', 'Tabs', 'Tour', 'Diff']);
    expect(sections.flatMap((section) => section.shortcuts).some((shortcut) => shortcut.keys.includes('?'))).toBe(true);
  });

  it('leaves out keys that do nothing without a usable tour', () => {
    const areas = (tab: 'tour' | 'code') => shortcutDialogSections({ tab, tourUsable: false }).map((section) => section.area);
    expect(areas('code')).toEqual(['Pull requests', 'Tabs', 'Diff']);
    expect(areas('tour')).toEqual(['Pull requests', 'Tabs']);
  });

  it('shows Mod as ⌘ on macOS and Ctrl elsewhere', () => {
    expect(shortcutKeyLabel('Mod', true)).toBe('⌘');
    expect(shortcutKeyLabel('Mod', false)).toBe('Ctrl');
    expect(shortcutKeyLabel('J', false)).toBe('J');
  });
});
