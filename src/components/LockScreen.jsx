import { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LockScreen({ onUnlock }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please enter both username and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(username.trim(), password);
      if (onUnlock) {
        onUnlock();
      }
    } catch (err) {
      console.warn('Unlock error:', err);
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: 'var(--bg-primary)',
      padding: '2rem'
    }}>
      <div className="glass-panel" style={{ 
        maxWidth: '400px', 
        width: '100%', 
        padding: '2.5rem', 
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)'
      }}>
        
        <div style={{ 
          width: '72px', 
          height: '72px', 
          borderRadius: '20px', 
          background: 'linear-gradient(135deg, var(--primary, #4a7a4a), var(--primary-darker, #2a5a2a))', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          margin: '0 auto 1.5rem',
          boxShadow: '0 8px 16px rgba(74, 122, 74, 0.25)'
        }}>
          <Lock size={36} color="white" />
        </div>
        
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          ArthSutra
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Enter your credentials to continue
        </p>

        {error && (
          <div style={{ 
            color: '#dc2626', 
            fontSize: '0.875rem', 
            marginBottom: '1.25rem', 
            fontWeight: 500,
            background: 'rgba(220, 38, 38, 0.08)',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            border: '1px solid rgba(220, 38, 38, 0.2)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ position: 'relative' }}>
            <input 
              type="text" 
              className="form-input" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoFocus
              autoComplete="username"
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box'
              }} 
            />
          </div>

          <div style={{ position: 'relative' }}>
            <input 
              type="password" 
              className="form-input" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box'
              }} 
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="btn btn-primary" 
            style={{ 
              width: '100%', 
              padding: '0.85rem', 
              justifyContent: 'center', 
              fontSize: '1rem', 
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
            {loading ? 'Unlocking…' : <>Unlock <ArrowRight size={18} /></>}
          </button>
        </form>

      </div>
    </div>
  );
}
