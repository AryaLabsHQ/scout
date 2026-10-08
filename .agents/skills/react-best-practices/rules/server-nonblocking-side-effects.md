---
title: Use Non-Blocking Side Effects After Response
impact: MEDIUM
impactDescription: faster response times
tags: server, async, logging, analytics, side-effects, cloudflare, tanstack-start
---

## Use Non-Blocking Side Effects After Response

Schedule logging, analytics, and other side effects so they do not block the response. TanStack
Start has no `after()` API — defer at the **Worker boundary** with `ctx.waitUntil()`, or
fire-and-forget only when the client does not need the result.

**Incorrect (blocks response):**

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await updateDatabase(request);

    const userAgent = request.headers.get("user-agent") || "unknown";
    await logUserAction({ userAgent });

    return Response.json({ status: "success" });
  },
};
```

**Correct (non-blocking on Cloudflare Workers):**

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await updateDatabase(request);

    const userAgent = request.headers.get("user-agent") || "unknown";
    ctx.waitUntil(logUserAction({ userAgent }));

    return Response.json({ status: "success" });
  },
};
```

**Correct (safe fire-and-forget inside createServerFn):**

Only when analytics/logging failure must not fail the mutation and the client does not read the
side-effect result:

```typescript
import { createServerFn } from "@tanstack/react-start";

export const submitForm = createServerFn({ method: "POST" }).handler(async ({ data }) => {
  const result = await saveForm(data);

  void trackAnalytics({ formId: data.id }).catch(console.error);

  return result;
});
```

**Not equivalent to `waitUntil`:** `void` inside `createServerFn` still runs before the RPC response
is sent. For true post-response work (audit logs, webhooks), enqueue from the Worker handler with
`ctx.waitUntil()` or a queue.

**Common use cases:**

- Analytics tracking
- Audit logging
- Sending notifications
- Cache invalidation
- Cleanup tasks

**Important:** Only defer work that is safe to run after the client receives a response. Mutations
the client depends on must complete before returning.
