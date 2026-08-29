import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { getStoredAuth, login as apiLogin, logout as apiLogout } from '../services/authService';

type User = { username: string; role: string } | null;

type AuthContextType = {
  user: User;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: async () => {},
  logout: async () => {},
  loading: true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await getStoredAuth();
      setUser(stored.user);
      setToken(stored.token);
      setLoading(false);
    })();
  }, []);

  const handleLogin = async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setUser({ username: res.username, role: res.role });
    setToken(res.token);
  };

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login: handleLogin, logout: handleLogout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
