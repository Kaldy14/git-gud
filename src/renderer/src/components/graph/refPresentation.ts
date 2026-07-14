export function branchNameFromRemoteRef(refName: string): string {
  const slashIndex = refName.indexOf('/');
  return slashIndex === -1 ? refName : refName.slice(slashIndex + 1);
}
