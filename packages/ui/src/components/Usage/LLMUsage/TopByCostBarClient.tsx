'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import dynamic from 'next/dynamic';
import type { LineSeries } from '@nivo/line';
import { formatCurrency } from '@/utils/number';

const BarChart = dynamic(() => import('@/components/Usage/Charts/Bar/Bar'), {
  ssr: false,
});
const ContainerChart = dynamic(
  () => import('@/components/Usage/Charts/Container'),
  { ssr: false }
);

export type TopByCostBarClientProps = {
  rows: Array<{ key: string; cost: number; label?: string }>;
  title: string;
  caption?: string;
};

/**
 * Client-side renderer for the "top N by cost" cards. Lives apart from
 * `TopByCostBar` (which is a server async component) because Next.js
 * forbids `dynamic({ ssr: false })` inside server components.
 */
export default function TopByCostBarClient({
  rows,
  title,
  caption,
}: TopByCostBarClientProps) {
  const lineSeries: LineSeries[] = [
    {
      id: 'Cost',
      data: rows.map((row) => ({
        x: row.label ?? row.key,
        y: row.cost,
      })),
    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
      {rows.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 2, fontStyle: 'italic' }}
        >
          No data in the selected window.
        </Typography>
      ) : (
        <ContainerChart>
          <Box sx={{ height: 320, mt: 1 }}>
            <BarChart
              data={lineSeries}
              axisLeft={{
                legend: 'USD',
                legendOffset: -70,
                legendPosition: 'middle',
              }}
              yFormat={(v: number | string) =>
                typeof v === 'number' ? formatCurrency(v) : String(v)
              }
            />
          </Box>
        </ContainerChart>
      )}
    </Paper>
  );
}
