import { ReorderTable } from '@/components/reorder/reorder-table';
import { requireSession } from '@/lib/auth/guard';
import { getReorderAdvice } from '@/lib/services/reorder';

export const runtime = 'nodejs';

export const metadata = { title: 'Reorder Advisor · StockPilot' };

export default async function ReorderPage() {
  const session = await requireSession();
  const advice = await getReorderAdvice(session.userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reorder Advisor</h1>
        <p className="text-muted-foreground text-sm">
          Every product at or below its reorder point, with the working behind each
          suggestion.
        </p>
      </div>

      <ReorderTable
        items={advice.items}
        assumptions={advice.assumptions}
        lookbackDays={advice.lookbackDays}
        safetyDays={advice.safetyDays}
      />
    </div>
  );
}
