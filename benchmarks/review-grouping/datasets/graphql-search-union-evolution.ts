import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'graphql-search-union-evolution',
  title: 'GraphQL search union expanded through resolver, fragments, cache, and UI',
  description: 'Adding a project variant to a GraphQL search union should keep the server schema and resolver with the client fragment, cache identity, and exhaustive renderer; an unrelated schema-description edit stays separate.',
  tags: ['complex', 'graphql', 'union', 'resolver', 'frontend', 'cache', 'cross-layer', 'typescript'],
  files: [
    {
      path: 'schema/search.graphql',
      before: [
        'union SearchResult = UserSearchResult | TeamSearchResult',
        '',
        'type UserSearchResult {',
        '  user: User!',
        '}',
        '',
        'type TeamSearchResult {',
        '  team: Team!',
        '}',
        ''
      ].join('\n'),
      after: [
        'union SearchResult = UserSearchResult | TeamSearchResult | ProjectSearchResult',
        '',
        'type UserSearchResult {',
        '  user: User!',
        '}',
        '',
        'type TeamSearchResult {',
        '  team: Team!',
        '}',
        '',
        'type ProjectSearchResult {',
        '  project: Project!',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'project-search-graphql-union-member',
          contains: 'union SearchResult = UserSearchResult | TeamSearchResult | ProjectSearchResult'
        },
        {
          id: 'project-search-graphql-union-type',
          contains: 'type ProjectSearchResult {'
        }
      ]
    },
    {
      path: 'src/graphql/search-result-resolver.ts',
      before: [
        'export const SearchResult = {',
        '  __resolveType(result: SearchResultRecord) {',
        '    if (result.userId) return "UserSearchResult";',
        '    if (result.teamId) return "TeamSearchResult";',
        '    return null;',
        '  }',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const SearchResult = {',
        '  __resolveType(result: SearchResultRecord) {',
        '    if (result.userId) return "UserSearchResult";',
        '    if (result.teamId) return "TeamSearchResult";',
        '    if (result.projectId) return "ProjectSearchResult";',
        '    return null;',
        '  }',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'project-search-union-resolver',
          contains: 'if (result.projectId) return "ProjectSearchResult"'
        }
      ]
    },
    {
      path: 'src/web/queries/search.graphql',
      before: [
        'query Search($query: String!) {',
        '  search(query: $query) {',
        '    __typename',
        '    ... on UserSearchResult { user { id name } }',
        '    ... on TeamSearchResult { team { id name } }',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'query Search($query: String!) {',
        '  search(query: $query) {',
        '    __typename',
        '    ... on UserSearchResult { user { id name } }',
        '    ... on TeamSearchResult { team { id name } }',
        '    ... on ProjectSearchResult { project { id name slug } }',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'project-search-client-fragment',
          contains: '... on ProjectSearchResult { project { id name slug } }'
        }
      ]
    },
    {
      path: 'src/web/cache/search-result-key.ts',
      before: [
        'export function searchResultKey(result: SearchResult) {',
        '  if (result.__typename === "UserSearchResult") return `user:${result.user.id}`;',
        '  if (result.__typename === "TeamSearchResult") return `team:${result.team.id}`;',
        '  return assertNever(result);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function searchResultKey(result: SearchResult) {',
        '  if (result.__typename === "UserSearchResult") return `user:${result.user.id}`;',
        '  if (result.__typename === "TeamSearchResult") return `team:${result.team.id}`;',
        '  if (result.__typename === "ProjectSearchResult") return `project:${result.project.id}`;',
        '  return assertNever(result);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'project-search-cache-identity',
          contains: [
            '__typename === "ProjectSearchResult"',
            '`project:${result.project.id}`'
          ]
        }
      ]
    },
    {
      path: 'src/web/search-result-row.tsx',
      before: [
        'export function SearchResultRow({ result }: Props) {',
        '  switch (result.__typename) {',
        '    case "UserSearchResult":',
        '      return <UserResult user={result.user} />;',
        '    case "TeamSearchResult":',
        '      return <TeamResult team={result.team} />;',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function SearchResultRow({ result }: Props) {',
        '  switch (result.__typename) {',
        '    case "UserSearchResult":',
        '      return <UserResult user={result.user} />;',
        '    case "TeamSearchResult":',
        '      return <TeamResult team={result.team} />;',
        '    case "ProjectSearchResult":',
        '      return <ProjectResult project={result.project} />;',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'project-search-ui-renderer',
          contains: [
            'case "ProjectSearchResult"',
            '<ProjectResult project={result.project}'
          ]
        }
      ]
    },
    {
      path: 'schema/team.graphql',
      before: [
        '"""A team that owns projects."""',
        'type Team {',
        '  id: ID!',
        '  name: String!',
        '}',
        ''
      ].join('\n'),
      after: [
        '"""A team that owns work."""',
        'type Team {',
        '  id: ID!',
        '  name: String!',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'team-schema-description-copy',
          contains: 'A team that owns work.'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'add-project-search-result',
      chunks: [
        'project-search-graphql-union-member',
        'project-search-graphql-union-type',
        'project-search-union-resolver',
        'project-search-client-fragment',
        'project-search-cache-identity',
        'project-search-ui-renderer'
      ]
    },
    {
      id: 'team-schema-copy-edit',
      chunks: ['team-schema-description-copy']
    }
  ]
});
