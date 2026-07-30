import type { ReviewPatchInput } from './reviewPlan';
import { analyzeReviewStructure } from './reviewStructure';
import {
  canAnalyzeReviewSyntaxContext,
  releaseReviewSyntaxDocument,
  treeSitterReviewStructureProvider
} from './reviewSyntax';

export async function attachReviewSyntax(
  repoPath: string,
  input: ReviewPatchInput
): Promise<ReviewPatchInput> {
  if (
    !input.fileContext ||
    input.diff.omittedReason ||
    !canAnalyzeReviewSyntaxContext(input.fileContext)
  ) {
    return input;
  }

  const documentKey = `${repoPath}\0${input.source}\0${input.path}`;

  try {
    const syntax = await analyzeReviewStructure(treeSitterReviewStructureProvider, {
      filePath: input.path,
      patch: input.diff.patch,
      context: input.fileContext,
      documentKey
    });

    return syntax ? { ...input, syntax } : input;
  } finally {
    if (input.source === 'commit') {
      releaseReviewSyntaxDocument(documentKey);
    }
  }
}
