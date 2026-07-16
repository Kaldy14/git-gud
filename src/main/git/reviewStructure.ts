import type { GitReviewSyntaxContext } from '@shared/types';

export type ReviewSyntaxLanguage = 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'graphql';

export type ReviewSyntaxIdentifierRole =
  | 'declaration'
  | 'member'
  | 'reference'
  | 'type-reference'
  | 'call'
  | 'import'
  | 'decorator';

export type ReviewSyntaxIdentifier = {
  name: string;
  role: ReviewSyntaxIdentifierRole;
  scope?: string;
  qualifiedName?: string;
};

export type ReviewSyntaxOwnerKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'member'
  | 'variable'
  | 'graphql-type'
  | 'graphql-operation'
  | 'graphql-fragment'
  | 'graphql-field';

export type ReviewSyntaxOwner = {
  kind: ReviewSyntaxOwnerKind;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
};

export type ReviewSyntaxHunk = {
  hasErrors: boolean;
  oldOwners: ReviewSyntaxOwner[];
  newOwners: ReviewSyntaxOwner[];
  oldIdentifiers: ReviewSyntaxIdentifier[];
  newIdentifiers: ReviewSyntaxIdentifier[];
  structuralFingerprints: string[];
};

export type ReviewPatchSyntax = GitReviewSyntaxContext & {
  hunks: ReviewSyntaxHunk[];
};

export type ReviewStructureRequest = {
  filePath: string;
  patch: string;
  context: {
    oldContents: string;
    newContents: string;
  };
  documentKey?: string;
};

export interface ReviewStructureProvider {
  analyze(request: ReviewStructureRequest): Promise<ReviewPatchSyntax | undefined>;
}

export async function analyzeReviewStructure(
  provider: ReviewStructureProvider | undefined,
  request: ReviewStructureRequest
): Promise<ReviewPatchSyntax | undefined> {
  if (!provider) {
    return undefined;
  }

  try {
    return await provider.analyze(request);
  } catch {
    return undefined;
  }
}

export function reviewStructureEnclosingSymbols(hunk: ReviewSyntaxHunk | undefined): string[] {
  const symbols = new Set<string>();

  for (const owner of [...(hunk?.oldOwners ?? []), ...(hunk?.newOwners ?? [])]) {
    if (isRelationshipOwner(owner.kind)) {
      symbols.add(owner.name);

      if (owner.qualifiedName !== owner.name) {
        symbols.add(owner.qualifiedName);
      }
    }
  }

  return [...symbols];
}

export function reviewStructureContextName(hunk: ReviewSyntaxHunk | undefined): string | undefined {
  const owners = hunk?.newOwners.length ? hunk.newOwners : hunk?.oldOwners ?? [];

  return [...owners].reverse().find((owner) => isRelationshipOwner(owner.kind))?.qualifiedName;
}

function isRelationshipOwner(kind: ReviewSyntaxOwnerKind): boolean {
  return kind !== 'member' && kind !== 'variable' && kind !== 'graphql-field';
}
