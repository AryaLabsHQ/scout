import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { formatBytes, formatPercent, formatBytesPerSec } from "@/lib/format"

type Unit = "%" | "bytes" | "bytes/s" | "°C"

interface MetricsChartProps {
  data: Record<string, unknown>[]
  dataKeys: { key: string; color: string; label?: string }[]
  unit?: Unit
  height?: number
  type?: "area" | "line"
}

function formatYAxis(value: number, unit: Unit): string {
  if (unit === "%") return `${Math.round(value)}%`
  if (unit === "bytes") return formatBytes(value)
  if (unit === "bytes/s") return formatBytesPerSec(value)
  if (unit === "°C") return `${Math.round(value)}°`
  return String(value)
}

function formatTooltipValue(value: unknown, unit: Unit): string {
  const n = typeof value === "number" ? value : 0
  if (unit === "%") return formatPercent(n)
  if (unit === "bytes") return formatBytes(n)
  if (unit === "bytes/s") return formatBytesPerSec(n)
  if (unit === "°C") return `${n.toFixed(1)} °C`
  return String(n)
}

export function MetricsChart({
  data,
  dataKeys,
  unit = "%",
  height = 200,
  type = "area",
}: MetricsChartProps) {
  const gradientIds = dataKeys.map((dk) => `grad-${dk.key}-${dk.color.replace("#", "")}`)

  const yFormatter = (v: number) => formatYAxis(v, unit)
  const tooltipFormatter = (value: unknown, name: string | number | undefined) => {
    const nameStr = String(name ?? "")
    const dk = dataKeys.find((k) => k.key === nameStr)
    return [formatTooltipValue(value, unit), dk?.label ?? nameStr] as [string, string]
  }

  const commonProps = {
    data,
    margin: { top: 4, right: 4, bottom: 0, left: 0 },
  }

  const axisProps = {
    xAxis: (
      <XAxis
        dataKey="time"
        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        tickLine={false}
        axisLine={false}
        minTickGap={48}
      />
    ),
    yAxis: (
      <YAxis
        tickFormatter={yFormatter}
        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        tickLine={false}
        axisLine={false}
        width={48}
        domain={unit === "%" ? [0, 100] : ["auto", "auto"]}
      />
    ),
  }

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          {axisProps.xAxis}
          {axisProps.yAxis}
          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
          />
          {dataKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} iconType="plainline" />}
          {dataKeys.map((dk) => (
            <Line
              key={dk.key}
              type="monotone"
              dataKey={dk.key}
              stroke={dk.color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart {...commonProps}>
        <defs>
          {dataKeys.map((dk, i) => (
            <linearGradient key={dk.key} id={gradientIds[i]} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={dk.color} stopOpacity={0.16} />
              <stop offset="95%" stopColor={dk.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        {axisProps.xAxis}
        {axisProps.yAxis}
        <Tooltip
          formatter={tooltipFormatter}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
        />
        {dataKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} iconType="plainline" />}
        {dataKeys.map((dk, i) => (
          <Area
            key={dk.key}
            type="monotone"
            dataKey={dk.key}
            stroke={dk.color}
            strokeWidth={1.5}
            fill={`url(#${gradientIds[i]})`}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}
