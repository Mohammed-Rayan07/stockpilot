import { AssistantChat } from '@/components/assistant/chat';
import { requireSession } from '@/lib/auth/guard';

export const runtime = 'nodejs';

export const metadata = { title: 'Assistant · StockPilot' };

export default async function AssistantPage() {
  await requireSession();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-muted-foreground text-sm">
          Ask questions about your inventory. Actions that change data need your approval.
        </p>
      </div>
      <AssistantChat />
    </div>
  );
}
