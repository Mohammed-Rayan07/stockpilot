'use client';

import type { Content } from '@google/genai';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPost } from '@/lib/client-api';

type ChatResponse = { reply: string; history: Content[]; proposals: ToolProposal[] };
type ToolProposal = { id: string; toolName: string; description: string };

type Message =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'proposal'; id: string; proposal: ToolProposal; status: 'pending' | 'approved' | 'rejected' };

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `m${nextId}`;
}

export function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const historyRef = useRef<Content[]>([]);

  async function onSend(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { kind: 'user', id: newId(), text }]);
    setInput('');
    setSending(true);

    try {
      const result = await apiPost<ChatResponse>('/api/ai/chat', {
        message: text,
        history: historyRef.current,
      });

      historyRef.current = result.history;

      setMessages((prev) => [
        ...prev,
        { kind: 'assistant', id: newId(), text: result.reply },
        ...result.proposals.map(
          (proposal): Message => ({
            kind: 'proposal',
            id: newId(),
            proposal,
            status: 'pending',
          }),
        ),
      ]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not reach the assistant.';
      setMessages((prev) => [...prev, { kind: 'assistant', id: newId(), text: `⚠ ${message}` }]);
    } finally {
      setSending(false);
    }
  }

  async function onDecide(message: Message & { kind: 'proposal' }, approve: boolean) {
    setDecidingId(message.id);

    try {
      await apiPost(`/api/ai/actions/${message.proposal.id}/${approve ? 'approve' : 'reject'}`);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id && m.kind === 'proposal'
            ? { ...m, status: approve ? 'approved' : 'rejected' }
            : m,
        ),
      );
      toast.success(approve ? 'Action approved.' : 'Action cancelled.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-lg border">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
            <p>
              Ask about your stock, sales, or reorder timing. Try &ldquo;which products are
              low on stock?&rdquo;
            </p>
          </div>
        ) : (
          messages.map((message) => {
            if (message.kind === 'proposal') {
              return (
                <ProposalCard
                  key={message.id}
                  message={message}
                  deciding={decidingId === message.id}
                  onDecide={(approve) => onDecide(message, approve)}
                />
              );
            }

            return (
              <div
                key={message.id}
                className={message.kind === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  className={
                    message.kind === 'user'
                      ? 'bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'
                      : 'bg-muted max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'
                  }
                >
                  {message.text}
                </p>
              </div>
            );
          })
        )}
        {sending && (
          <div className="flex justify-start">
            <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm">
              Thinking…
            </p>
          </div>
        )}
      </div>

      <form onSubmit={onSend} className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend(e);
            }
          }}
          placeholder="Ask about your inventory…"
          className="min-h-10 flex-1 resize-none"
          maxLength={2000}
          disabled={sending}
        />
        <Button type="submit" disabled={sending || !input.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}

function ProposalCard({
  message,
  deciding,
  onDecide,
}: {
  message: Message & { kind: 'proposal' };
  deciding: boolean;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div className="bg-card rounded-lg border p-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Proposed action
      </p>
      <p className="mt-1 text-sm">{message.proposal.description}</p>

      {message.status === 'pending' ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={deciding} onClick={() => onDecide(true)}>
            {deciding ? 'Confirming…' : 'Confirm'}
          </Button>
          <Button size="sm" variant="outline" disabled={deciding} onClick={() => onDecide(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          {message.status === 'approved' ? 'Approved and applied.' : 'Cancelled.'}
        </p>
      )}
    </div>
  );
}
