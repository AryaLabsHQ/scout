import { useState } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import type { SystemMetricsSample } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail } from "@/server/systems"
import { useRefreshInterval } from "@/hooks/use-refresh-interval"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { Page, PageHeader, Section } from "@/components/section"
import { cn } from "@/lib/utils"

type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d"
const TIME_RANGES: ReadonlyArray<TimeRange> = ["1h", "6h", "24h", "7d", "30d"]

/**
 * Container and overlay interfaces (veth pairs, CNI bridges, flannel, Docker
 * bridges, loopback) are hidden by default so the network chart shows the
 * host's real links; "All interfaces" brings them back.
 */
const VIRTUAL_INTERFACE = /^(lo|veth|cni|flannel|docker|br-|virbr|kube-|cali|vxlan)/

const SERIES = ["#ededed", "#a1a1a1", "#707070", "#4a4a4a"] as const

export const Route = createFileRoute("/systems_/$systemId/metrics")({
  loader: async ({ params }) => ({ detail: await fetchSystemDetail({ data: { systemId: params.systemId } }) }),
  component: SystemMetricsPage,
})

function buildChartData(
  samples: ReadonlyArray<SystemMetricsSample>,
  range: TimeRange,
  extractor: (sample: SystemMetricsSample) => Record<string, number>,
) {
  const long = range === "7d" || range === "30d"
  return samples.map((sample) => ({
    time: new Date(sample.timestamp).toLocaleString([], long
      ? { month: "short", day: "numeric", hour: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" }),
    ...extractor(sample),
  }))
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Section title={title}>
      <div className="px-2 pt-3 pb-1">{children}</div>
    </Section>
  )
}

function SystemMetricsPage() {
  const { systemId } = Route.useParams()
  const { detail } = Route.useLoaderData()
  const [range, setRange] = useState<TimeRange>("1h")
  const [allInterfaces, setAllInterfaces] = useState(false)
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const metricsAtom = HubClient.query("systems.metrics", { id: systemId, range })
  useRefreshInterval(metricsAtom, range === "1h" ? 15_000 : 60_000)
  const metricsResult = useAtomValue(metricsAtom)
  const samples = lastValue(metricsResult, [])

  const interfaces = [...new Set(samples.flatMap((sample) => Object.keys(sample.networkRxBytesPerSecByInterface)))]
  const shownInterfaces = allInterfaces ? interfaces : interfaces.filter((name) => !VIRTUAL_INTERFACE.test(name))
  const hiddenCount = interfaces.length - shownInterfaces.length
  const hasGpu = samples.some((sample) => sample.gpuPercent !== null)
  const tempLabels = [...new Set(samples.flatMap((sample) => Object.keys(sample.temperaturesCelsius)))]

  return (
    <Page>
      <PageHeader
        crumbs={
          <>
            <Link to="/systems/$systemId" params={{ systemId }} className="hover:text-foreground">
              {system?.hostname ?? systemId}
            </Link>
            <span>/</span>
            <span>Metrics</span>
          </>
        }
        title="Metrics"
        actions={
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {TIME_RANGES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                className={cn(
                  "h-7 rounded px-2.5 font-mono text-xs",
                  value === range ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartSection title="CPU">
          <MetricsChart
            data={buildChartData(samples, range, (sample) => ({ cpu: sample.cpuPercent }))}
            dataKeys={[{ key: "cpu", color: SERIES[0], label: "CPU" }]}
            unit="%"
            height={180}
          />
        </ChartSection>
        <ChartSection title="Memory">
          <MetricsChart
            data={buildChartData(samples, range, (sample) => ({ mem: sample.memoryPercent }))}
            dataKeys={[{ key: "mem", color: SERIES[0], label: "Memory" }]}
            unit="%"
            height={180}
          />
        </ChartSection>
        <ChartSection title="Disk I/O">
          <MetricsChart
            data={buildChartData(samples, range, (sample) => ({
              read: sample.diskReadBytesPerSec,
              write: sample.diskWriteBytesPerSec,
            }))}
            dataKeys={[
              { key: "read", color: SERIES[0], label: "Read" },
              { key: "write", color: SERIES[2], label: "Write" },
            ]}
            unit="bytes/s"
            height={180}
            type="line"
          />
        </ChartSection>
        <Section
          title="Network · received"
          aside={
            interfaces.length > 0 ? (
              <button
                type="button"
                onClick={() => setAllInterfaces((value) => !value)}
                className="hover:text-foreground"
              >
                {allInterfaces ? "Host interfaces only" : `All interfaces${hiddenCount > 0 ? ` (+${hiddenCount})` : ""}`}
              </button>
            ) : undefined
          }
        >
          <div className="px-2 pt-3 pb-1">
            <MetricsChart
              data={buildChartData(samples, range, (sample) =>
                Object.fromEntries(
                  shownInterfaces.map((name) => [`rx_${name}`, sample.networkRxBytesPerSecByInterface[name] ?? 0]),
                ),
              )}
              dataKeys={shownInterfaces.map((name, index) => ({
                key: `rx_${name}`,
                color: SERIES[index % SERIES.length]!,
                label: name,
              }))}
              unit="bytes/s"
              height={180}
              type="line"
            />
          </div>
        </Section>
        {hasGpu ? (
          <ChartSection title="GPU">
            <MetricsChart
              data={buildChartData(samples, range, (sample) => ({
                gpu: sample.gpuPercent ?? 0,
                gpuMem: sample.gpuMemoryPercent ?? 0,
              }))}
              dataKeys={[
                { key: "gpu", color: SERIES[0], label: "GPU" },
                { key: "gpuMem", color: SERIES[2], label: "VRAM" },
              ]}
              unit="%"
              height={180}
            />
          </ChartSection>
        ) : null}
        {tempLabels.length > 0 ? (
          <ChartSection title="Temperature">
            <MetricsChart
              data={buildChartData(samples, range, (sample) =>
                Object.fromEntries(tempLabels.map((label) => [`temp_${label}`, sample.temperaturesCelsius[label] ?? 0])),
              )}
              dataKeys={tempLabels.map((label, index) => ({
                key: `temp_${label}`,
                color: SERIES[index % SERIES.length]!,
                label,
              }))}
              unit="°C"
              height={180}
              type="line"
            />
          </ChartSection>
        ) : null}
      </div>
    </Page>
  )
}
