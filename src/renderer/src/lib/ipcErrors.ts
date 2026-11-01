// Electron prefixes errors thrown in the main process with the IPC channel and the error class.
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/;

/** Returns the main-process error text a person should read, without Electron's IPC wrapper. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(IPC_ERROR_PREFIX, '') : fallback;
}
