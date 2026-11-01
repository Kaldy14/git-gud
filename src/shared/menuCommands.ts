/** Application-menu commands the main process forwards to the focused workspace window. */
export const MENU_COMMAND_EVENT = 'app:menu-command';

export const menuCommands = [
  'new-tab',
  'open-repository',
  'reopen-closed-tab',
  'close-tab',
  'next-tab',
  'previous-tab',
  'open-settings'
] as const;

export type MenuCommand = (typeof menuCommands)[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return menuCommands.includes(value as MenuCommand);
}
