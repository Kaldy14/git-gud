import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'tsx-prop-migration',
  title: 'React prop migration across component and call sites',
  description: 'Replacing a scalar avatar prop with a structured prop groups the component contract, render logic, application callers, and story.',
  tags: ['typescript', 'tsx', 'react', 'props', 'cross-file'],
  files: [
    {
      path: 'src/components/user-card.tsx',
      before: [
        'interface UserCardProps {',
        '  name: string;',
        '  avatarUrl: string;',
        '}',
        '',
        'export function UserCard({ name, avatarUrl }: UserCardProps) {',
        '  return <img src={avatarUrl} alt={`${name} avatar`} />;',
        '}',
        ''
      ].join('\n'),
      after: [
        'interface UserCardProps {',
        '  name: string;',
        '  avatar: { src: string; alt: string };',
        '}',
        '',
        'export function UserCard({ name, avatar }: UserCardProps) {',
        '  return <img src={avatar.src} alt={avatar.alt || `${name} avatar`} />;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'user-card-prop-contract-and-render',
          contains: [
            'avatar: { src: string; alt: string };',
            'src={avatar.src}'
          ]
        }
      ]
    },
    {
      path: 'src/pages/profile-page.tsx',
      before: [
        'export function ProfilePage({ user }: ProfilePageProps) {',
        '  return <UserCard name={user.name} avatarUrl={user.photoUrl} />;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function ProfilePage({ user }: ProfilePageProps) {',
        '  return (',
        '    <UserCard',
        '      name={user.name}',
        '      avatar={{ src: user.photoUrl, alt: user.photoAlt }}',
        '    />',
        '  );',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'profile-page-user-card-props',
          contains: 'avatar={{ src: user.photoUrl, alt: user.photoAlt }}'
        }
      ]
    },
    {
      path: 'src/components/team-member-row.tsx',
      before: [
        'export const TeamMemberRow = ({ member }: Props) => (',
        '  <UserCard name={member.displayName} avatarUrl={member.avatar} />',
        ');',
        ''
      ].join('\n'),
      after: [
        'export const TeamMemberRow = ({ member }: Props) => (',
        '  <UserCard',
        '    name={member.displayName}',
        '    avatar={{ src: member.avatar, alt: `Photo of ${member.displayName}` }}',
        '  />',
        ');',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'team-row-user-card-props',
          contains: 'avatar={{ src: member.avatar, alt: `Photo of ${member.displayName}` }}'
        }
      ]
    },
    {
      path: 'src/components/user-card.stories.tsx',
      before: [
        'export const Default: Story = {',
        '  args: { name: "Ada", avatarUrl: "/avatars/ada.png" },',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const Default: Story = {',
        '  args: {',
        '    name: "Ada",',
        '    avatar: { src: "/avatars/ada.png", alt: "Ada Lovelace" },',
        '  },',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'user-card-story-props',
          contains: 'avatar: { src: "/avatars/ada.png", alt: "Ada Lovelace" }'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'user-card-avatar-prop-migration',
      chunks: [
        'user-card-prop-contract-and-render',
        'profile-page-user-card-props',
        'team-row-user-card-props',
        'user-card-story-props'
      ]
    }
  ]
});
