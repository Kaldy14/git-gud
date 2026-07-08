import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';

import { WorkspaceShell } from '@renderer/workspace/WorkspaceShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

function RootRouteComponent(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

const rootRoute = createRootRoute({
  component: RootRouteComponent
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: WorkspaceShell
});

const routeTree = rootRoute.addChildren([indexRoute]);

const router = createRouter({
  routeTree,
  history: createMemoryHistory({
    initialEntries: ['/']
  })
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter(): ReactElement {
  return <RouterProvider router={router} />;
}
