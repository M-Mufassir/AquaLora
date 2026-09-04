import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { getStoredAuth, login as apiLogin, logout as apiLogout } from '../services/authService';

export type User = {
  username: string;
  nodeCode?: string;
  displayName?: string;
  role: string;
  masterNodeId?: number;
} | null;

type AuthContextType = {
  user: User;
  token: string | null;
  login: (nodeCode: string, password: string) => Promise<void>;
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
      if (stored.user?.role === 'super_admin') {
        await apiLogout();
        setUser(null);
        setToken(null);
      } else {
        setUser(stored.user);
        setToken(stored.token);
      }
      setLoading(false);
    })();
  }, []);

  const handleLogin = async (nodeCode: string, password: string) => {
    const res = await apiLogin(nodeCode, password);
    setUser({
      username: res.nodeCode,
      nodeCode: res.nodeCode,
      displayName: res.displayName,
      role: res.role,
      masterNodeId: res.masterNodeId,
    });
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

