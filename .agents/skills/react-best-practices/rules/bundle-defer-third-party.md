---
title: Defer Non-Critical Third-Party Libraries
impact: MEDIUM
impactDescription: loads after hydration
tags: bundle, third-party, analytics, defer
---

## Defer Non-Critical Third-Party Libraries

Analytics, logging, and error tracking don't block user interaction. Load them after hydration with
dynamic `import()`.

**Incorrect (blocks initial bundle):**

```tsx
import posthog from "posthog-js";

export function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY);
  }, []);

  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

**Correct (loads after hydration):**

```tsx
import { useEffect } from "react";

export function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(import.meta.env.VITE_POSTHOG_KEY);
    });
  }, []);

  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

**Correct (lazy component wrapper):**

```tsx
import { lazy, Suspense } from "react";

const Analytics = lazy(() => import("./analytics").then((m) => ({ default: m.Analytics })));

export function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}
```
