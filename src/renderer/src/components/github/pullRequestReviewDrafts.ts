export function retainUnsubmittedOrFailedDrafts<TDraft extends { id: string }>(
  drafts: TDraft[],
  submittedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>
): TDraft[] {
  return drafts.filter(
    (draft) => !submittedIds.has(draft.id) || failedIds.has(draft.id)
  );
}
