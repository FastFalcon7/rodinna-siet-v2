import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserPublic, LoginInput, RegisterInput } from '@rodinna/shared-types';
import { authApi } from '../lib/api';

interface AuthState {
  user: UserPublic | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: zisti aktuálnu session pri načítaní.
  useEffect(() => {
    authApi
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (input: LoginInput) => {
    const r = await authApi.login(input);
    setUser(r.user);
  };

  const register = async (input: RegisterInput) => {
    const r = await authApi.register(input);
    setUser(r.user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth musí byť vnútri <AuthProvider>');
  return ctx;
}
