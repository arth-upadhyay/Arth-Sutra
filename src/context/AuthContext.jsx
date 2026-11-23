import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

/**
 * Parses JWT payload without requiring external libraries.
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSetupComplete, setIsSetupComplete] = useState(true);

  const checkSetupStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        if (typeof data.isSetupComplete === 'boolean') {
          setIsSetupComplete(data.isSetupComplete);
          return data.isSetupComplete;
        }
      }
    } catch (err) {
      console.warn('Failed to check setup status:', err);
    }
    return true;
  }, []);

  // Initialize session on mount
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('arthsutra_token');
      const storedUser = localStorage.getItem('arthsutra_user');

      if (storedToken && storedUser) {
        const decoded = parseJwt(storedToken);
        const nowMs = Date.now();

        // Check if token has expired
        if (decoded && decoded.exp && decoded.exp * 1000 > nowMs) {
          // Token is valid! Restore user session immediately (offline-friendly)
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        } else {
          // Token expired, clear storage
          localStorage.removeItem('arthsutra_token');
          localStorage.removeItem('arthsutra_user');
          setToken(null);
          setUser(null);
        }
      }
    } catch (err) {
      console.warn('Failed to restore auth session:', err);
    } finally {
      setLoading(false);
    }

    // Check whether the first-time setup has been completed
    checkSetupStatus();

    // Listen for WebSocket 4001 rejection or expired token events
    const handleAuthExpired = () => {
      logout();
    };
    window.addEventListener('fgsb-auth-expired', handleAuthExpired);
    return () => window.removeEventListener('fgsb-auth-expired', handleAuthExpired);
  }, [checkSetupStatus]);

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Login failed');
    }

    localStorage.setItem('arthsutra_token', data.token);
    localStorage.setItem('arthsutra_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('arthsutra_token');
    localStorage.removeItem('arthsutra_user');
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((newToken, newUser) => {
    if (newToken) {
      localStorage.setItem('arthsutra_token', newToken);
      setToken(newToken);
    }
    if (newUser) {
      localStorage.setItem('arthsutra_user', JSON.stringify(newUser));
      setUser(newUser);
    }
  }, []);

  const setupAdmin = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Setup failed');
    }

    localStorage.setItem('arthsutra_token', data.token);
    localStorage.setItem('arthsutra_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setIsSetupComplete(true);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        loading,
        login,
        logout,
        updateUser,
        isSetupComplete,
        setIsSetupComplete,
        checkSetupStatus,
        setupAdmin,
        isAdmin: user?.role === 'ADMIN',
        isAccountant: user?.role === 'ACCOUNTANT' || user?.role === 'ADMIN',
        isClerk: user?.role === 'CLERK',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
