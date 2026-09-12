'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/client-api';

type Mode = 'login' | 'register';

// Seeded by lib/db/seed.ts: 2 suppliers, 6 products, ~60 sales already in the database.
const DEMO_EMAIL = 'demo@stockpilot.app';
const DEMO_PASSWORD = 'demo-password-123';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      if (mode === 'register') {
        await apiPost('/api/auth/register', { email, password, name });
      } else {
        await apiPost('/api/auth/login', { email, password });
      }

      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {mode === 'register' && (
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
          {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        {fieldErrors.email && <p className="text-destructive text-sm">{fieldErrors.email}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
        />
        {fieldErrors.password && (
          <p className="text-destructive text-sm">{fieldErrors.password}</p>
        )}
        {mode === 'register' && !fieldErrors.password && (
          <p className="text-muted-foreground text-sm">At least 10 characters.</p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </Button>

      {mode === 'login' && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={submitting}
          onClick={() => {
            setEmail(DEMO_EMAIL);
            setPassword(DEMO_PASSWORD);
          }}
        >
          Use the demo account
        </Button>
      )}
    </form>
  );
}
