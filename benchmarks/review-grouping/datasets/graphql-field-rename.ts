import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'graphql-field-rename',
  title: 'GraphQL field rename across server and client',
  description: 'The schema field, resolver, and client query should be reviewed together; an unrelated health-schema description edit remains separate.',
  tags: ['graphql', 'api-contract', 'cross-language', 'cross-file', 'typescript'],
  files: [
    {
      path: 'schema/user.graphql',
      before: [
        'type User {',
        '  id: ID!',
        '  displayName: String!',
        '}',
        ''
      ].join('\n'),
      after: [
        'type User {',
        '  id: ID!',
        '  fullName: String!',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'full-name-schema-field',
          contains: 'fullName: String!'
        }
      ]
    },
    {
      path: 'src/graphql/user-resolver.ts',
      before: [
        'export const User = {',
        '  displayName: (user: UserRecord) => user.profile.name',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const User = {',
        '  fullName: (user: UserRecord) => user.profile.name',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'full-name-resolver',
          contains: 'fullName: (user: UserRecord)'
        }
      ]
    },
    {
      path: 'src/web/queries/current-user.graphql',
      before: [
        'query CurrentUser {',
        '  currentUser {',
        '    id',
        '    displayName',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'query CurrentUser {',
        '  currentUser {',
        '    id',
        '    fullName',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'full-name-client-query',
          contains: '    fullName'
        }
      ]
    },
    {
      path: 'schema/health.graphql',
      before: [
        '"""Service status."""',
        'type Health { status: String! }',
        ''
      ].join('\n'),
      after: [
        '"""Current service status."""',
        'type Health { status: String! }',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'health-schema-description',
          contains: 'Current service status'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'user-full-name-contract',
      chunks: [
        'full-name-schema-field',
        'full-name-resolver',
        'full-name-client-query'
      ]
    },
    {
      id: 'health-schema-copy',
      chunks: ['health-schema-description']
    }
  ]
});
