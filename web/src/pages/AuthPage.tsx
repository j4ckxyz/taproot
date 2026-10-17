import { useState } from 'react';
import type { User } from '@shared/types';
import { auth, type AuthStatus } from '../lib/api';
import { Button, Field, Input, Logo } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';

export function AuthPage({ status, onAuthed }: { status: AuthStatus; onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>(status.needsSetup ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = status.needsSetup
        ? await auth.setup({ email, name, password })
        : mode === 'signup'
          ? await auth.signup({ email, name, password })
          : await auth.login({ email, password });
      onAuthed(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === 'signup';
  return (
    <div className="paper-dots hero-glow relative grid min-h-full place-items-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={52} className="mx-auto mb-4 rounded-[14px] shadow-lg shadow-accent/25" />
          <h1 className="text-2xl font-semibold tracking-tight">{status.needsSetup ? `Welcome to ${status.appName}` : `Sign in to ${status.appName}`}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {status.needsSetup ? 'Create the first account. It becomes the admin.' : 'Grow big projects from one idea.'}
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 shadow-xl shadow-black/[0.04]">
          {signup && (
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="What should we call you?" />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
          </Field>
          <Field label="Password" hint={signup ? 'At least 8 characters.' : undefined}>
            <Input
              type="password"
              required
              minLength={signup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? 'new-password' : 'current-password'}
            />
          </Field>
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button variant="primary" className="w-full" disabled={busy}>
            {status.needsSetup ? 'Create admin account' : signup ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        {!status.needsSetup && status.allowSignup && (
          <p className="mt-4 text-center text-sm text-muted">
            {signup ? 'Have an account? ' : 'New here? '}
            <button className="font-semibold text-accent" onClick={() => setMode(signup ? 'login' : 'signup')}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
