import { useState } from 'react';
import { UserPlus, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function SetupScreen({ onComplete }) {
  const { setupAdmin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Please choose an admin username');
      return;
    }
    if (cleanUsername.length < 3) {
      setError('Username must be at least 3 characters long');
      return;
    }
    if (!password) {
      setError('Please enter a password');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await setupAdmin(cleanUsername, password);
      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      console.warn('Setup error:', err);
      setError(err.message || 'Failed to create admin account');
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
        maxWidth: '440px', 
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
          <UserPlus size={36} color="white" />
        </div>
        
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
          Welcome to ArthSutra
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          First-Time Setup: Create your master administrator account to secure your financial data.
        </p>

        {error && (
          <div style={{ 
            color: '#dc2626', 
            fontSize: '0.875rem', 
            marginBottom: '1.25rem', 
            fontWeight: 500,
            background: 'rgba(220, 38, 38, 0.08)',
            padding: '0.6rem 0.85rem',
            borderRadius: '8px',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            textAlign: 'left'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          <div style={{ position: 'relative', textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
              Create Username
            </label>
            <input 
              type="text" 
              className="form-input" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin"
              autoFocus
              autoComplete="username"
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
                width: '100%',
                boxSizing: 'border-box'
              }} 
            />
          </div>

          <div style={{ position: 'relative', textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
              Create Password
            </label>
            <input 
              type="password" 
              className="form-input" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 4 characters"
              autoComplete="new-password"
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
                width: '100%',
                boxSizing: 'border-box'
              }} 
            />
          </div>

          <div style={{ position: 'relative', textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
              Confirm Password
            </label>
            <input 
              type="password" 
              className="form-input" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
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
              fontWeight: 600,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '0.35rem'
            }}>
            {loading ? 'Creating Account…' : <>Create Account & Start <ArrowRight size={18} /></>}
          </button>
        </form>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '1.25rem', marginBottom: 0 }}>
          🔒 Your data is stored locally on your machine in SQLite with AES-256-GCM encryption.
        </p>

      </div>
    </div>
  );
}
