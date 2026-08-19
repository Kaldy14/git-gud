export type BranchTreeNode<Item> =
  | {
      kind: 'branch';
      name: string;
      path: string;
      item: Item;
    }
  | {
      kind: 'folder';
      name: string;
      path: string;
      children: BranchTreeNode<Item>[];
    };

export function buildBranchTree<Item>(
  items: readonly Item[],
  getName: (item: Item) => string
): BranchTreeNode<Item>[] {
  const root: BranchTreeNode<Item>[] = [];

  for (const item of items) {
    const path = getName(item);
    const segments = path.split('/');
    let children = root;

    for (const [index, segment] of segments.entries()) {
      const isBranch = index === segments.length - 1;

      if (isBranch) {
        children.push({ kind: 'branch', name: segment, path, item });
        continue;
      }

      const folderPath = segments.slice(0, index + 1).join('/');
      const existingFolder = children.find(
        (node): node is Extract<BranchTreeNode<Item>, { kind: 'folder' }> =>
          node.kind === 'folder' && node.name === segment
      );

      if (existingFolder) {
        children = existingFolder.children;
        continue;
      }

      const folder: Extract<BranchTreeNode<Item>, { kind: 'folder' }> = {
        kind: 'folder',
        name: segment,
        path: folderPath,
        children: []
      };
      children.push(folder);
      children = folder.children;
    }
  }

  return root;
}
