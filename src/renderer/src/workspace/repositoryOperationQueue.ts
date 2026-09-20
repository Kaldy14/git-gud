export type RepositoryOperationQueue = {
  schedule<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T>;
};

export function createRepositoryOperationQueue(): RepositoryOperationQueue {
  const tails = new Map<string, Promise<void>>();

  function schedule<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(repositoryKey) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );

    tails.set(repositoryKey, tail);
    void tail.then(() => {
      if (tails.get(repositoryKey) === tail) {
        tails.delete(repositoryKey);
      }
    });

    return result;
  }

  return { schedule };
}
