export type CheckoutTransition = {
  targetRef: {
    kind: 'branch' | 'remote';
    name: string;
  };
  phase: 'running' | 'refreshing';
};
