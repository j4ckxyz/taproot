import { useEffect, useState } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import type { User } from '@shared/types';
import { auth, type AuthStatus } from './lib/api';
import { Spinner } from './components/ui';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage, rememberPage } from './pages/SettingsPage';
import { usePrefs } from './lib/prefs';
import { createContext, useContext } from 'react';

interface Session {
  user: User;
  status: AuthStatus;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [location, navigate] = useLocation();
  useEffect(() => rememberPage(location), [location]);

  const refresh = async () => {
    const s = await auth.status();
    setStatus(s);
    setUser(s.user);
  };

  useEffect(() => {
    refresh().catch(() => setStatus({ appName: 'Taproot', needsSetup: false, allowSignup: false, user: null }));
  }, []);

  useEffect(() => {
    if (status) document.title = status.appName;
  }, [status]);

  // Preferences follow the account; pull them in once per sign-in.
  useEffect(() => {
    if (user) usePrefs.getState().hydrate(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!status) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPage
        status={status}
        onAuthed={(u) => {
          setUser(u);
          setStatus({ ...status, needsSetup: false });
          navigate('/');
        }}
      />
    );
  }

  return (
    <SessionCtx.Provider value={{ user, status, refresh, setUser }}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/p/:id">{(p) => <ProjectPage id={p.id} />}</Route>
        <Route path="/settings/:tab?">{(p) => <SettingsPage tab={p.tab ?? 'preferences'} />}</Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </SessionCtx.Provider>
  );
}
