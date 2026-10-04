import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A bordered block with a one-line header; the dashboard's only container. */
export function Section({
  id,
  title,
  aside,
  children,
  className,
}: {
  id?: string
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn("min-w-0 overflow-hidden rounded-lg border border-border", className)}>
      {title !== undefined || aside !== undefined ? (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">{title}</h2>
          {aside !== undefined ? (
            <div className="flex items-center gap-3 text-[12.5px] text-subtle">{aside}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** A small uppercase divider inside a Section ("FAILED", "PINNED IN THIS BROWSER"). */
export function GroupLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-y border-border bg-raised px-4 py-2 text-[11.5px] tracking-wide text-subtle first:border-t-0">
      <span>{children}</span>
      {aside}
    </div>
  )
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="px-4 py-5 text-[13px] text-subtle">{children}</div>
}

/** Page title block: breadcrumbs, title, metadata line, and right-aligned actions. */
export function PageHeader({
  crumbs,
  title,
  meta,
  actions,
}: {
  crumbs?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div>
      {crumbs ? <div className="mb-2 flex items-center gap-1.5 text-[13px] text-subtle">{crumbs}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="flex min-w-0 items-center gap-3 text-2xl font-semibold tracking-tight">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">{meta}</div>
      ) : null}
    </div>
  )
}

/** Consistent page width and padding under the top bar. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1240px] px-6 pt-8 pb-24", className)}>{children}</div>
}
