import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';

import type { GitReviewSyntaxNode } from '@shared/types';

import {
  resetReviewSyntaxQueryCacheForTests,
  reviewSyntaxQueryStatsForTests,
  syntaxIdentifiersForLines
} from './reviewSyntaxIdentifiers';
import {
  reviewStructureContextName,
  reviewStructureEnclosingSymbols,
  type ReviewPatchSyntax,
  type ReviewStructureProvider,
  type ReviewSyntaxHunk,
  type ReviewSyntaxLanguage,
  type ReviewSyntaxOwner,
  type ReviewSyntaxOwnerKind
} from './reviewStructure';
import {
  canAnalyzeReviewSyntaxContext,
  clearReviewSyntaxCache,
  clearReviewSyntaxCacheForRepository,
  parseReviewDocuments,
  releaseReviewSyntaxDocument,
  resetReviewSyntaxCacheForTests as resetReviewSyntaxDocumentCacheForTests,
  reviewSyntaxCacheStatsForTests,
  reviewSyntaxCacheUsageForTests,
  setReviewSyntaxCacheLimitsForTests,
  reviewSyntaxLanguage
} from './reviewTreeSitterRuntime';

export type { ReviewSyntaxIdentifier, ReviewSyntaxIdentifierRole } from './reviewStructure';
export type {
  ReviewPatchSyntax,
  ReviewStructureProvider,
  ReviewSyntaxHunk,
  ReviewSyntaxLanguage,
  ReviewSyntaxOwner,
  ReviewSyntaxOwnerKind
} from './reviewStructure';
export {
  canAnalyzeReviewSyntaxContext,
  clearReviewSyntaxCache,
  clearReviewSyntaxCacheForRepository,
  releaseReviewSyntaxDocument,
  reviewSyntaxCacheStatsForTests,
  reviewSyntaxCacheUsageForTests,
  reviewSyntaxLanguage,
  reviewSyntaxQueryStatsForTests,
  setReviewSyntaxCacheLimitsForTests
};
export type { ReviewSyntaxCacheStats } from './reviewTreeSitterRuntime';

export function resetReviewSyntaxCacheForTests(): void {
  resetReviewSyntaxDocumentCacheForTests();
  resetReviewSyntaxQueryCacheForTests();
}

type FileContext = {
  oldContents: string;
  newContents: string;
};

type HunkLineRanges = {
  oldLines: number[];
  newLines: number[];
};

type LineRange = {
  startLine: number;
  endLine: number;
};

export async function analyzeReviewPatchSyntax(
  filePath: string,
  patch: string,
  context: FileContext,
  documentKey = filePath
): Promise<ReviewPatchSyntax | undefined> {
  const language = reviewSyntaxLanguage(filePath);

  if (!language) {
    return undefined;
  }

  try {
    const { oldDocument, newDocument } = await parseReviewDocuments(language, context, documentKey);
    const hunkRanges = changedLinesByHunk(patch);
    const oldSourceLines = context.oldContents.split('\n');
    const newSourceLines = context.newContents.split('\n');
    const oldErrorRanges = syntaxErrorLineRanges(oldDocument.tree);
    const newErrorRanges = syntaxErrorLineRanges(newDocument.tree);

    return {
      language,
      hunks: hunkRanges.map((range) => {
        const oldOwners = ownersForLines(oldDocument.tree, oldSourceLines, range.oldLines, language);
        const newOwners = ownersForLines(newDocument.tree, newSourceLines, range.newLines, language);

        return {
          hasErrors:
            linesIntersectRanges(range.oldLines, oldErrorRanges) ||
            linesIntersectRanges(range.newLines, newErrorRanges),
          oldOwners,
          newOwners,
          oldIdentifiers: syntaxIdentifiersForLines(oldDocument.tree, range.oldLines, language),
          newIdentifiers: syntaxIdentifiersForLines(newDocument.tree, range.newLines, language),
          structuralFingerprints: memberTypeFingerprints(
            membersForLines(oldDocument.tree, oldSourceLines, range.oldLines, language),
            membersForLines(newDocument.tree, newSourceLines, range.newLines, language)
          )
        };
      }),
      oldNodes: structuralNodes(oldDocument.tree, language),
      newNodes: structuralNodes(newDocument.tree, language),
      hasErrors: oldDocument.tree.rootNode.hasError || newDocument.tree.rootNode.hasError
    };
  } catch {
    return undefined;
  }
}

export const treeSitterReviewStructureProvider: ReviewStructureProvider = {
  analyze: ({ filePath, patch, context, documentKey }) =>
    analyzeReviewPatchSyntax(filePath, patch, context, documentKey)
};

export function syntaxEnclosingSymbols(hunk: ReviewSyntaxHunk | undefined): string[] {
  return reviewStructureEnclosingSymbols(hunk);
}

export function syntaxContextName(hunk: ReviewSyntaxHunk | undefined): string | undefined {
  return reviewStructureContextName(hunk);
}

function changedLinesByHunk(patch: string): HunkLineRanges[] {
  const lines = patch.split('\n');
  const hunks: HunkLineRanges[] = [];
  let current: HunkLineRanges | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);

    if (header) {
      current = { oldLines: [], newLines: [] };
      hunks.push(current);
      oldLine = Number.parseInt(header[1]!, 10);
      newLine = Number.parseInt(header[2]!, 10);
      continue;
    }

    if (!current || line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      current.oldLines.push(oldLine);
      oldLine += 1;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      current.newLines.push(newLine);
      newLine += 1;
    } else if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return hunks;
}

function ownersForLines(
  tree: Tree,
  sourceLines: readonly string[],
  lines: readonly number[],
  language: ReviewSyntaxLanguage
): ReviewSyntaxOwner[] {
  const owners = new Map<string, ReviewSyntaxOwner>();

  for (const line of new Set(lines)) {
    for (const owner of ownersAtLine(tree, sourceLines, line, language)) {
      owners.set(`${owner.kind}\0${owner.qualifiedName}`, owner);
    }
  }

  return [...owners.values()].sort((left, right) =>
    left.startLine - right.startLine ||
    right.endLine - left.endLine ||
    left.qualifiedName.localeCompare(right.qualifiedName)
  );
}

function ownersAtLine(
  tree: Tree,
  sourceLines: readonly string[],
  line: number,
  language: ReviewSyntaxLanguage
): ReviewSyntaxOwner[] {
  let node = syntaxNodeAtLine(tree, sourceLines, line);

  if (!node) {
    return [];
  }
  const classified: Array<{ kind: ReviewSyntaxOwnerKind; name: string; node: SyntaxNode }> = [];

  while (node) {
    const kind = ownerKind(node.type, language);
    const name = kind ? ownerName(node, language) : undefined;

    if (kind && name) {
      classified.push({ kind, name, node });
    }

    node = node.parent;
  }

  const owners: ReviewSyntaxOwner[] = [];
  const scope: string[] = [];

  for (const candidate of classified.reverse()) {
    scope.push(candidate.name);
    owners.push({
      kind: candidate.kind,
      name: candidate.name,
      qualifiedName: scope.join('.'),
      startLine: candidate.node.startPosition.row + 1,
      endLine: candidate.node.endPosition.row + 1
    });
  }

  return owners;
}

function syntaxNodeAtLine(tree: Tree, sourceLines: readonly string[], line: number): SyntaxNode | null {
  if (line <= 0) {
    return null;
  }

  const sourceLine = sourceLines[line - 1];

  if (sourceLine === undefined) {
    return null;
  }

  const indentation = sourceLine.match(/^\s*/)?.[0] ?? '';
  return tree.rootNode.namedDescendantForPosition({
    row: line - 1,
    column: Buffer.byteLength(indentation)
  });
}

function ownerKind(nodeType: string, language: ReviewSyntaxLanguage): ReviewSyntaxOwnerKind | undefined {
  if (language === 'graphql') {
    if (graphqlTypeNodes.has(nodeType)) {
      return 'graphql-type';
    }

    if (nodeType === 'operation_definition') {
      return 'graphql-operation';
    }

    if (nodeType === 'fragment_definition') {
      return 'graphql-fragment';
    }

    if (nodeType === 'field_definition' || nodeType === 'input_value_definition' || nodeType === 'field') {
      return 'graphql-field';
    }

    return undefined;
  }

  return codeOwnerKinds.get(nodeType);
}

const graphqlTypeNodes = new Set([
  'enum_type_definition',
  'input_object_type_definition',
  'interface_type_definition',
  'object_type_definition',
  'scalar_type_definition',
  'union_type_definition'
]);

const codeOwnerKinds = new Map<string, ReviewSyntaxOwnerKind>([
  ['class_declaration', 'class'],
  ['interface_declaration', 'interface'],
  ['type_alias_declaration', 'type'],
  ['enum_declaration', 'enum'],
  ['function_declaration', 'function'],
  ['generator_function_declaration', 'function'],
  ['method_definition', 'method'],
  ['method_signature', 'method'],
  ['public_field_definition', 'member'],
  ['property_signature', 'member'],
  ['variable_declarator', 'variable']
]);

function ownerName(node: SyntaxNode, language: ReviewSyntaxLanguage): string | undefined {
  const fieldName = node.childForFieldName('name')?.text.trim();

  if (fieldName) {
    return fieldName;
  }

  if (language === 'graphql') {
    return node.namedChildren.find((child) => child?.type === 'name')?.text.trim();
  }

  return undefined;
}

type SyntaxMember = {
  name: string;
  type: string;
};

function membersForLines(
  tree: Tree,
  sourceLines: readonly string[],
  lines: readonly number[],
  language: ReviewSyntaxLanguage
): SyntaxMember[] {
  const members = new Map<string, SyntaxMember>();

  for (const line of new Set(lines)) {
    const node = syntaxNodeAtLine(tree, sourceLines, line);
    let current = node;

    while (current) {
      const kind = ownerKind(current.type, language);

      if (kind === 'member' || kind === 'graphql-field') {
        const name = ownerName(current, language);
        const type = memberType(current, language);

        if (name && type) {
          members.set(name, { name, type });
        }
        break;
      }

      current = current.parent;
    }
  }

  return [...members.values()];
}

function syntaxErrorLineRanges(tree: Tree): LineRange[] {
  if (!tree.rootNode.hasError) {
    return [];
  }

  const ranges = new Map<string, LineRange>();
  const pending: SyntaxNode[] = [tree.rootNode];

  while (pending.length > 0) {
    const node = pending.pop()!;

    if (node.isError || node.isMissing) {
      const range = {
        startLine: node.startPosition.row + 1,
        endLine: Math.max(node.startPosition.row, node.endPosition.row) + 1
      };
      ranges.set(`${range.startLine}:${range.endLine}`, range);
      continue;
    }

    for (const child of node.children) {
      if (child && (child.hasError || child.isError || child.isMissing)) {
        pending.push(child);
      }
    }
  }

  return [...ranges.values()];
}

function linesIntersectRanges(lines: readonly number[], ranges: readonly LineRange[]): boolean {
  return lines.some((line) =>
    ranges.some((range) => line >= range.startLine && line <= range.endLine)
  );
}

function memberType(node: SyntaxNode, language: ReviewSyntaxLanguage): string | undefined {
  if (language === 'graphql') {
    return node.namedChildren.find((child) => child?.type === 'type')?.text;
  }

  return node.childForFieldName('type')?.text;
}

function memberTypeFingerprints(
  oldMembers: readonly SyntaxMember[],
  newMembers: readonly SyntaxMember[]
): string[] {
  const oldByName = new Map(oldMembers.map((member) => [member.name, member]));
  const newByName = new Map(newMembers.map((member) => [member.name, member]));
  const pairs: Array<[SyntaxMember, SyntaxMember]> = [];
  const pairedOld = new Set<string>();
  const pairedNew = new Set<string>();

  for (const [name, oldMember] of oldByName) {
    const newMember = newByName.get(name);

    if (newMember) {
      pairs.push([oldMember, newMember]);
      pairedOld.add(name);
      pairedNew.add(name);
    }
  }

  const remainingOld = oldMembers.filter((member) => !pairedOld.has(member.name));
  const remainingNew = newMembers.filter((member) => !pairedNew.has(member.name));

  if (remainingOld.length === remainingNew.length) {
    remainingOld.forEach((member, index) => pairs.push([member, remainingNew[index]!]));
  }

  return [...new Set(pairs.flatMap(([oldMember, newMember]) => {
    const oldType = normalizeMemberType(oldMember.type);
    const newType = normalizeMemberType(newMember.type);

    return oldType && newType && oldType !== newType
      ? [`member-type:${oldType}->${newType}`]
      : [];
  }))];
}

function normalizeMemberType(value: string): string {
  const withoutAnnotation = value.replace(/^\s*:\s*/, '').trim();
  const scalarMatch = /Scalars\s*\[\s*['"]([A-Za-z_]\w*)['"]\s*\](?:\s*\[\s*['"](?:input|output)['"]\s*\])?/.exec(withoutAnnotation);

  if (scalarMatch?.[1]) {
    return normalizeNamedType(scalarMatch[1]);
  }

  const unionParts = withoutAnnotation
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:null|undefined)$/.test(part));
  const core = unionParts.length === 1 ? unionParts[0]! : withoutAnnotation;
  const arrayMatch = /^\[\s*(.+?)\s*\]!?$/.exec(core) ?? /^(.+?)\[\]$/.exec(core);

  if (arrayMatch?.[1]) {
    return `list<${normalizeMemberType(arrayMatch[1])}>`;
  }

  return normalizeNamedType(core.replace(/[!?]/g, '').trim());
}

function normalizeNamedType(value: string): string {
  const words = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const key = words.join(':');

  if (key === 'string') {
    return 'scalar:string';
  }

  if (key === 'int' || key === 'float' || key === 'number') {
    return 'scalar:number';
  }

  if (key === 'boolean' || key === 'bool') {
    return 'scalar:boolean';
  }

  if (key === 'id') {
    return 'scalar:id';
  }

  return key ? `named:${key}` : '';
}

function structuralNodes(tree: Tree, language: ReviewSyntaxLanguage): GitReviewSyntaxNode[] {
  const ranges = new Map<string, GitReviewSyntaxNode>();
  const pending: SyntaxNode[] = [tree.rootNode];

  while (pending.length > 0) {
    const node = pending.pop()!;
    const kind = structuralNodeKind(node, language);

    if (kind && node.endPosition.row > node.startPosition.row) {
      const range = {
        kind,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1
      };
      const key = `${range.startLine}:${range.endLine}`;
      const existing = ranges.get(key);

      if (!existing || structuralKindRank(kind) < structuralKindRank(existing.kind)) {
        ranges.set(key, range);
      }
    }

    for (const child of node.namedChildren) {
      if (child) {
        pending.push(child);
      }
    }
  }

  return [...ranges.values()].sort((left, right) =>
    left.startLine - right.startLine ||
    right.endLine - left.endLine ||
    structuralKindRank(left.kind) - structuralKindRank(right.kind)
  );
}

function structuralNodeKind(
  node: SyntaxNode,
  language: ReviewSyntaxLanguage
): GitReviewSyntaxNode['kind'] | undefined {
  if (language === 'graphql') {
    if (graphqlStructuralDeclarations.has(node.type)) {
      return 'graphql';
    }

    if (graphqlStructuralBlocks.has(node.type)) {
      return 'block';
    }

    if (node.type === 'field_definition' || node.type === 'input_value_definition') {
      return 'member';
    }

    return undefined;
  }

  if (codeStructuralDeclarations.has(node.type)) {
    return 'declaration';
  }

  if (node.type === 'export_statement' && node.childForFieldName('declaration')) {
    return 'declaration';
  }

  if (codeStructuralBlocks.has(node.type)) {
    return 'block';
  }

  if (node.type === 'public_field_definition' || node.type === 'property_signature') {
    return 'member';
  }

  return undefined;
}

const codeStructuralDeclarations = new Set([
  'class_declaration',
  'enum_declaration',
  'function_declaration',
  'generator_function_declaration',
  'interface_declaration',
  'lexical_declaration',
  'type_alias_declaration',
  'variable_declaration'
]);

const codeStructuralBlocks = new Set([
  'arrow_function',
  'catch_clause',
  'do_statement',
  'else_clause',
  'finally_clause',
  'for_in_statement',
  'for_statement',
  'function_expression',
  'if_statement',
  'method_definition',
  'object',
  'object_type',
  'statement_block',
  'switch_case',
  'switch_statement',
  'ternary_expression',
  'try_statement',
  'while_statement'
]);

const graphqlStructuralDeclarations = new Set([
  'definition',
  'fragment_definition',
  'operation_definition',
  ...graphqlTypeNodes
]);

const graphqlStructuralBlocks = new Set([
  'enum_values_definition',
  'fields_definition',
  'input_fields_definition',
  'selection_set'
]);

function structuralKindRank(kind: GitReviewSyntaxNode['kind']): number {
  return kind === 'declaration' || kind === 'graphql' ? 0 : kind === 'block' ? 1 : 2;
}
