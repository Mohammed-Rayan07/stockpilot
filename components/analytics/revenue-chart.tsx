'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatINR, toMinor } from '@/lib/money';

export type RevenuePoint = { date: string; revenue: string };

// The date string is an IST calendar day ('YYYY-MM-DD') from the service. Parsed as UTC
// midnight and re-formatted in the same zone, the label always lands on that same day.
function formatDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const chartData = data.map((point) => ({
    label: formatDateLabel(point.date),
    // Recharts needs a plain number to plot; the minor-unit integer (paise) keeps this
    // off floating-point major-unit values, and formatINR converts it back for display.
    revenueMinor: toMinor(point.revenue),
  }));

  const isEmpty = data.every((point) => toMinor(point.revenue) === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue over time</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
            No sales recorded in this window yet.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => formatINR(String(v / 100))}
                />
                <Tooltip
                  formatter={(value) => formatINR(String(Number(value) / 100))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="revenueMinor"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RevenueChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue over time</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}
