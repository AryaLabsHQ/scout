---
title: Parallel Data Fetching with Route Composition
impact: CRITICAL
impactDescription: eliminates server-side waterfalls
tags: server, loaders, parallel-fetching, composition, tanstack-start
---

## Parallel Data Fetching with Route Composition

Route `loader`s and sibling route modules run in a tree. Restructure with composition so independent
fetches start together instead of chaining sequentially through parent components.

**Incorrect (child loader waits for parent shell work):**

```tsx
// routes/dashboard/route.tsx
export const Route = createFileRoute("/dashboard")({
  loader: async () => {
    const shell = await fetchShellConfig();
    return { shell };
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { shell } = Route.useLoaderData();
  return (
    <div>
      <Header config={shell} />
      <Sidebar /> {/* Sidebar's loader only starts after parent resolves */}
    </div>
  );
}
```

**Correct (sibling routes fetch in parallel):**

```tsx
// routes/dashboard/route.tsx — layout only, no blocking fetch
export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

// routes/dashboard/_layout/header.tsx
export const Route = createFileRoute("/dashboard/_layout/header")({
  loader: () => fetchHeader(),
  component: Header,
});

// routes/dashboard/_layout/sidebar.tsx
export const Route = createFileRoute("/dashboard/_layout/sidebar")({
  loader: () => fetchSidebarItems(),
  component: Sidebar,
});

function DashboardLayout() {
  return (
    <div>
      <Header />
      <Sidebar />
      <Outlet />
    </div>
  );
}
```

**Correct (parallelize inside a single loader):**

```tsx
export const Route = createFileRoute("/marketing/")({
  loader: async () => {
    const [hero, pricing, testimonials] = await Promise.all([
      fetchHero(),
      fetchPricing(),
      fetchTestimonials(),
    ]);
    return { hero, pricing, testimonials };
  },
});
```

**Dashboard HttpApi data:** Prefer parallel atom registry prefetch (see `tanstack-start`
dehydration) over serial `await` in one mega-loader when the dashboard route uses `ssr: false`.
