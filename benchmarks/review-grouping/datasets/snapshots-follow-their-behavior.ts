import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'snapshots-follow-their-behavior',
  title: 'Shared snapshot file split by changed behavior',
  description: 'Profile and settings changes should each stay with their own test and distant snapshot hunk even though both snapshots live in one file.',
  tags: ['snapshot', 'multi-feature', 'same-file', 'tests', 'typescript'],
  files: [
    {
      path: 'src/profile/render-profile.ts',
      before: 'export const renderProfile = (user: User) => `<h1>${user.name}</h1>`;\n',
      after: 'export const renderProfile = (user: User) => `<h1>${user.displayName}</h1>`;\n',
      hunks: [
        {
          id: 'profile-rendering',
          contains: 'user.displayName'
        }
      ]
    },
    {
      path: 'src/profile/render-profile.test.ts',
      before: [
        'it("renders a profile", () => {',
        '  expect(renderProfile(user)).toMatchSnapshot();',
        '});',
        ''
      ].join('\n'),
      after: [
        'it("renders the public display name", () => {',
        '  expect(renderProfile(user)).toMatchSnapshot();',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'profile-rendering-test',
          contains: 'renders the public display name'
        }
      ]
    },
    {
      path: 'src/settings/render-settings.ts',
      before: 'export const renderSettings = () => "<button>Save</button>";\n',
      after: 'export const renderSettings = () => "<button>Save changes</button>";\n',
      hunks: [
        {
          id: 'settings-rendering',
          contains: 'Save changes'
        }
      ]
    },
    {
      path: 'src/settings/render-settings.test.ts',
      before: [
        'it("renders settings", () => {',
        '  expect(renderSettings()).toMatchSnapshot();',
        '});',
        ''
      ].join('\n'),
      after: [
        'it("renders the explicit save action", () => {',
        '  expect(renderSettings()).toMatchSnapshot();',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'settings-rendering-test',
          contains: 'renders the explicit save action'
        }
      ]
    },
    {
      path: 'src/__snapshots__/rendering.test.ts.snap',
      before: [
        'exports[`profile renders a profile 1`] = `<h1>Ada Lovelace</h1>`;',
        'exports[`header renders 1`] = `<header>Git Gud</header>`;',
        'exports[`footer renders 1`] = `<footer>Terms</footer>`;',
        'exports[`login renders 1`] = `<form>Sign in</form>`;',
        'exports[`navigation renders 1`] = `<nav>Home</nav>`;',
        'exports[`empty state renders 1`] = `<p>Nothing here</p>`;',
        'exports[`error renders 1`] = `<p>Try again</p>`;',
        'exports[`loading renders 1`] = `<p>Loading</p>`;',
        'exports[`avatar renders 1`] = `<img alt="Ada" />`;',
        'exports[`badge renders 1`] = `<span>Admin</span>`;',
        'exports[`settings renders 1`] = `<button>Save</button>`;',
        ''
      ].join('\n'),
      after: [
        'exports[`profile renders a profile 1`] = `<h1>ada</h1>`;',
        'exports[`header renders 1`] = `<header>Git Gud</header>`;',
        'exports[`footer renders 1`] = `<footer>Terms</footer>`;',
        'exports[`login renders 1`] = `<form>Sign in</form>`;',
        'exports[`navigation renders 1`] = `<nav>Home</nav>`;',
        'exports[`empty state renders 1`] = `<p>Nothing here</p>`;',
        'exports[`error renders 1`] = `<p>Try again</p>`;',
        'exports[`loading renders 1`] = `<p>Loading</p>`;',
        'exports[`avatar renders 1`] = `<img alt="Ada" />`;',
        'exports[`badge renders 1`] = `<span>Admin</span>`;',
        'exports[`settings renders 1`] = `<button>Save changes</button>`;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'profile-snapshot',
          contains: '<h1>ada</h1>'
        },
        {
          id: 'settings-snapshot',
          contains: '<button>Save changes</button>'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'profile-display-name',
      chunks: ['profile-rendering', 'profile-rendering-test', 'profile-snapshot']
    },
    {
      id: 'settings-save-label',
      chunks: ['settings-rendering', 'settings-rendering-test', 'settings-snapshot']
    }
  ]
});
