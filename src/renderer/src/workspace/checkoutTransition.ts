export type CheckoutTransition = {
  targetBranch: string;
  phase: 'running' | 'refreshing';
};
