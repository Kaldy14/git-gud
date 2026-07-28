import type {
  Dashboard,
  GitHubRepositorySummary
} from '@shared/types';

export function dashboardRepositoryOptions(
  repositories: GitHubRepositorySummary[],
  dashboard: Dashboard | undefined,
  editingTileId: string | undefined
): GitHubRepositorySummary[] {
  const editingTile = dashboard?.tiles.find(
    (tile) => tile.id === editingTileId && tile.kind === 'github-actions'
  );

  if (
    editingTile?.kind === 'github-actions' &&
    !repositories.some(
      (repository) =>
        repository.owner === editingTile.owner &&
        repository.name === editingTile.repository
    )
  ) {
    return [
      {
        owner: editingTile.owner,
        name: editingTile.repository,
        fullName: `${editingTile.owner}/${editingTile.repository}`,
        url: '',
        isPrivate: false,
        defaultBranch: ''
      },
      ...repositories
    ];
  }

  return repositories;
}
