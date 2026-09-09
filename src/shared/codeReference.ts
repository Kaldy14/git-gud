export type CodeReference = { path: string; line?: number };

/** Only repository-relative references; external URLs keep their normal behavior. */
export function parseCodeReference(value: string): CodeReference | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return undefined; }
  const match = /^(.*?)(?::([1-9]\d*)(?:-[1-9]\d*)?|#L([1-9]\d*)(?:-L?[1-9]\d*)?)?$/.exec(decoded);
  if (!match) return undefined;
  const path = match[1].replace(/^\.\//, '');
  if (!path || /^[a-z]+:/i.test(path) || /[\\\s?#:]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32) || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) return undefined;
  // Avoid turning ordinary prose or fragment-only anchors into file links.
  if (!path.includes('/') && !path.includes('.')) return undefined;
  const line = match[2] || match[3] ? Number(match[2] || match[3]) : undefined;
  if (line !== undefined && !Number.isSafeInteger(line)) return undefined;
  return { path, ...(line === undefined ? {} : { line }) };
}
