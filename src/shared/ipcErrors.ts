// Electron prefixes errors thrown in the main process with the IPC channel and the error class.
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/;

/** Removes Electron's IPC wrapper so the main-process message reads as written. */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(IPC_ERROR_PREFIX, '');
}
