import { Query, type Language, type Node as SyntaxNode, type Tree } from 'web-tree-sitter';

import type {
  ReviewSyntaxIdentifier,
  ReviewSyntaxIdentifierRole,
  ReviewSyntaxLanguage
} from './reviewStructure';

const codeIdentifierTypes = [
  'identifier',
  'nested_identifier',
  'property_identifier',
  'shorthand_property_identifier',
  'shorthand_property_identifier_pattern',
  'type_identifier'
];
let queryRolesByTree = new WeakMap<Tree, Map<number, ReviewSyntaxIdentifierRole>>();
let queryCaptureScans = 0;

export function syntaxIdentifiersForLines(
  tree: Tree,
  lines: readonly number[],
  language: ReviewSyntaxLanguage
): ReviewSyntaxIdentifier[] {
  const identifiers = new Map<string, ReviewSyntaxIdentifier>();
  const nodeTypes = language === 'graphql' ? ['name'] : codeIdentifierTypes;
  const queriedRoles = queryRolesForTree(tree, language);

  for (const line of new Set(lines)) {
    if (line <= 0) {
      continue;
    }

    const nodes = tree.rootNode.descendantsOfType(
      nodeTypes,
      { row: line - 1, column: 0 },
      { row: line - 1, column: Number.MAX_SAFE_INTEGER }
    );

    for (const node of nodes) {
      if (!node || node.startPosition.row !== line - 1 || hasNonCodeAncestor(node)) {
        continue;
      }

      const role = queriedRoles.get(node.id) ?? identifierRole(node, language);
      const scope = syntaxScope(node, language);
      const qualifiedName = qualifiedIdentifierName(node, role, scope, language);
      const identifier = {
        name: node.text,
        role,
        scope,
        qualifiedName
      };

      identifiers.set(
        `${identifier.role}\0${identifier.qualifiedName ?? identifier.scope ?? ''}\0${identifier.name}`,
        identifier
      );
    }
  }

  return [...identifiers.values()].sort((left, right) =>
    identifierRoleRank(left.role) - identifierRoleRank(right.role) ||
    (left.qualifiedName ?? left.scope ?? left.name).localeCompare(
      right.qualifiedName ?? right.scope ?? right.name
    ) ||
    left.name.localeCompare(right.name)
  );
}

function queryRolesForTree(
  tree: Tree,
  language: ReviewSyntaxLanguage
): Map<number, ReviewSyntaxIdentifierRole> {
  const cached = queryRolesByTree.get(tree);

  if (cached) {
    return cached;
  }

  const queriedRoles = new Map<number, ReviewSyntaxIdentifierRole>();
  const query = syntaxQuery(tree.language, language);
  queryCaptureScans += 1;

  for (const capture of query.captures(tree.rootNode)) {
    const role = captureRole(capture.name);
    const current = queriedRoles.get(capture.node.id);

    if (role && (!current || identifierRoleRank(role) < identifierRoleRank(current))) {
      queriedRoles.set(capture.node.id, role);
    }
  }

  queryRolesByTree.set(tree, queriedRoles);
  return queriedRoles;
}

export function reviewSyntaxQueryStatsForTests(): { queryCaptureScans: number } {
  return { queryCaptureScans };
}

export function resetReviewSyntaxQueryCacheForTests(): void {
  queryRolesByTree = new WeakMap();
  queryCaptureScans = 0;
}

function syntaxQuery(language: Language, syntaxLanguage: ReviewSyntaxLanguage): Query {
  let query = syntaxQueries.get(language);

  if (!query) {
    query = new Query(language, querySource(syntaxLanguage));
    syntaxQueries.set(language, query);
  }

  return query;
}

function querySource(language: ReviewSyntaxLanguage): string {
  return language === 'graphql'
    ? graphqlRoleQuery
    : language === 'javascript' || language === 'jsx'
      ? javascriptRoleQuery
      : typescriptRoleQuery;
}

function captureRole(captureName: string): ReviewSyntaxIdentifierRole | undefined {
  return captureName.startsWith('role.')
    ? captureName.slice('role.'.length) as ReviewSyntaxIdentifierRole
    : undefined;
}

function qualifiedIdentifierName(
  node: SyntaxNode,
  role: ReviewSyntaxIdentifierRole,
  scope: string | undefined,
  language: ReviewSyntaxLanguage
): string | undefined {
  if (role === 'declaration' || role === 'member') {
    return scope;
  }

  if (language === 'graphql' && role === 'reference') {
    return scope;
  }

  if (role === 'reference' || role === 'call') {
    const memberExpression = nearestPropertyAccess(node);
    return memberExpression?.text;
  }

  return undefined;
}

function nearestPropertyAccess(node: SyntaxNode): SyntaxNode | undefined {
  let current = node.parent;

  while (current && !statementBoundaryNodes.has(current.type)) {
    if (
      (current.type === 'member_expression' || current.type === 'subscript_expression') &&
      containsNode(current, node)
    ) {
      return current;
    }

    current = current.parent;
  }

  return undefined;
}

function identifierRole(
  node: SyntaxNode,
  language: ReviewSyntaxLanguage
): ReviewSyntaxIdentifierRole {
  if (language === 'graphql') {
    return graphqlIdentifierRole(node);
  }

  const parent = node.parent;

  if (parent && isNameField(parent, node)) {
    if (codeMemberNodes.has(parent.type)) {
      return 'member';
    }

    if (codeDeclarationNodes.has(parent.type)) {
      return 'declaration';
    }
  }

  if (hasAncestor(node, codeImportNodes)) {
    return 'import';
  }

  if (hasAncestor(node, codeDecoratorNodes)) {
    return 'decorator';
  }

  if (isCallTarget(node)) {
    return 'call';
  }

  if (node.type === 'type_identifier' || hasAncestor(node, codeTypeNodes)) {
    return 'type-reference';
  }

  return 'reference';
}

function graphqlIdentifierRole(node: SyntaxNode): ReviewSyntaxIdentifierRole {
  const parent = node.parent;

  if (!parent) {
    return 'reference';
  }

  if (parent.type === 'named_type') {
    return 'type-reference';
  }

  if (graphqlMemberNodes.has(parent.type) && firstDirectName(parent)?.equals(node)) {
    return 'member';
  }

  if (graphqlDeclarationNodes.has(parent.type) && firstDirectName(parent)?.equals(node)) {
    return 'declaration';
  }

  return 'reference';
}

function syntaxScope(node: SyntaxNode, language: ReviewSyntaxLanguage): string | undefined {
  const names: string[] = [];
  let current = node.parent;

  while (current) {
    const name = syntaxOwnerName(current, language);

    if (name) {
      names.push(name);
    }

    current = current.parent;
  }

  return names.reverse().join('.') || undefined;
}

function syntaxOwnerName(node: SyntaxNode, language: ReviewSyntaxLanguage): string | undefined {
  if (language === 'graphql') {
    if (graphqlDeclarationNodes.has(node.type) || graphqlMemberNodes.has(node.type)) {
      return firstDirectName(node)?.text;
    }

    return undefined;
  }

  if (!codeDeclarationNodes.has(node.type) && !codeMemberNodes.has(node.type)) {
    return undefined;
  }

  return node.childForFieldName('name')?.text;
}

function firstDirectName(node: SyntaxNode): SyntaxNode | undefined {
  return node.namedChildren.find((child): child is SyntaxNode => child?.type === 'name');
}

function isNameField(parent: SyntaxNode, node: SyntaxNode): boolean {
  return parent.childForFieldName('name')?.equals(node) ?? false;
}

function isCallTarget(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node;

  while (current?.parent) {
    const parent: SyntaxNode = current.parent;

    if (parent.type === 'call_expression') {
      const target = parent.childForFieldName('function');
      return target ? containsNode(target, node) : false;
    }

    if (statementBoundaryNodes.has(parent.type)) {
      return false;
    }

    current = parent;
  }

  return false;
}

function containsNode(container: SyntaxNode, node: SyntaxNode): boolean {
  return container.startIndex <= node.startIndex && container.endIndex >= node.endIndex;
}

function hasAncestor(node: SyntaxNode, types: ReadonlySet<string>): boolean {
  let current = node.parent;

  while (current) {
    if (types.has(current.type)) {
      return true;
    }

    if (statementBoundaryNodes.has(current.type)) {
      return false;
    }

    current = current.parent;
  }

  return false;
}

function hasNonCodeAncestor(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node;

  while (current) {
    if (nonCodeNodes.has(current.type)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function identifierRoleRank(role: ReviewSyntaxIdentifierRole): number {
  return role === 'declaration'
    ? 0
    : role === 'member'
      ? 1
      : role === 'decorator'
        ? 2
        : role === 'import'
          ? 3
          : role === 'call'
            ? 4
            : role === 'type-reference'
              ? 5
              : 6;
}

const codeDeclarationNodes = new Set([
  'class_declaration',
  'enum_declaration',
  'function_declaration',
  'generator_function_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'variable_declarator'
]);

const codeMemberNodes = new Set([
  'method_definition',
  'method_signature',
  'property_signature',
  'public_field_definition'
]);

const codeImportNodes = new Set([
  'import_clause',
  'import_specifier',
  'import_statement',
  'named_imports',
  'namespace_import'
]);

const codeDecoratorNodes = new Set(['decorator']);

const codeTypeNodes = new Set([
  'type_annotation',
  'type_arguments',
  'type_parameter',
  'type_query',
  'type_identifier'
]);

const graphqlDeclarationNodes = new Set([
  'enum_type_definition',
  'fragment_definition',
  'input_object_type_definition',
  'interface_type_definition',
  'object_type_definition',
  'operation_definition',
  'scalar_type_definition',
  'union_type_definition'
]);

const graphqlMemberNodes = new Set([
  'enum_value_definition',
  'field',
  'field_definition',
  'input_value_definition'
]);

const statementBoundaryNodes = new Set([
  'class_declaration',
  'export_statement',
  'expression_statement',
  'function_declaration',
  'import_statement',
  'lexical_declaration',
  'method_definition',
  'program',
  'return_statement',
  'source_file',
  'statement_block',
  'variable_declaration'
]);

const nonCodeNodes = new Set([
  'comment',
  'regex',
  'string',
  'string_fragment',
  'template_string'
]);

const syntaxQueries = new WeakMap<Language, Query>();

const typescriptRoleQuery = String.raw`
  (class_declaration name: (_) @role.declaration)
  (interface_declaration name: (_) @role.declaration)
  (type_alias_declaration name: (_) @role.declaration)
  (enum_declaration name: (_) @role.declaration)
  (function_declaration name: (_) @role.declaration)
  (generator_function_declaration name: (_) @role.declaration)
  (variable_declarator name: (_) @role.declaration)
  (method_definition name: (_) @role.member)
  (method_signature name: (_) @role.member)
  (property_signature name: (_) @role.member)
  (public_field_definition name: (_) @role.member)
  (import_specifier name: (_) @role.import)
  (import_clause (identifier) @role.import)
  (call_expression function: (identifier) @role.call)
  (call_expression function: (member_expression property: (property_identifier) @role.call))
  (type_identifier) @role.type-reference
  (decorator (identifier) @role.decorator)
  (decorator (call_expression function: (identifier) @role.decorator))
`;

const javascriptRoleQuery = String.raw`
  (class_declaration name: (_) @role.declaration)
  (function_declaration name: (_) @role.declaration)
  (generator_function_declaration name: (_) @role.declaration)
  (variable_declarator name: (_) @role.declaration)
  (method_definition name: (_) @role.member)
  (field_definition property: (_) @role.member)
  (import_specifier name: (_) @role.import)
  (import_clause (identifier) @role.import)
  (call_expression function: (identifier) @role.call)
  (call_expression function: (member_expression property: (property_identifier) @role.call))
`;

const graphqlRoleQuery = String.raw`
  (input_object_type_definition (name) @role.declaration)
  (interface_type_definition (name) @role.declaration)
  (object_type_definition (name) @role.declaration)
  (enum_type_definition (name) @role.declaration)
  (scalar_type_definition (name) @role.declaration)
  (union_type_definition (name) @role.declaration)
  (operation_definition (name) @role.declaration)
  (fragment_definition (fragment_name (name) @role.declaration))
  (input_value_definition (name) @role.member)
  (field_definition (name) @role.member)
  (enum_value_definition (enum_value (name) @role.member))
  (field (name) @role.reference)
  (named_type (name) @role.type-reference)
`;
