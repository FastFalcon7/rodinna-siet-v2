import { useAuth } from './auth/AuthContext';
import { AuthScreen } from './auth/AuthScreen';
import { Home } from './Home';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="min-h-dvh grid place-items-center">
        <span className="text-sm text-neutral-500">Načítavam…</span>
      </main>
    );
  }

  return user ? <Home /> : <AuthScreen />;
}
