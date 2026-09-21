import { useState, useEffect } from 'react';
import { Lock, ArrowRight, ShieldCheck } from 'lucide-react';
import { getProfile } from '../store';
import { toast } from './Toast';

export default function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [savedHash, setSavedHash] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the user's profile on boot to check if they have a modern secure PIN set
  useEffect(() => {
    getProfile()
      .then(profile => {
        if (profile && profile.appPasswordHash) {
          setSavedHash(profile.appPasswordHash);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password) return;

    // LEGACY FALLBACK: If no hash is found in the profile, fall back to the old hardcoded password
    if (!savedHash) {
      if (password === 'ARTH') {
        onUnlock();
      } else {
        toast('Incorrect password', 'error');
      }
      return;
    }

    // MODERN SECURE CHECK: Hash the user input and compare it to the stored hash
    try {
      const msgBuffer = new TextEncoder().encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashedInput = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (hashedInput === savedHash) {
        onUnlock();
      } else {
        toast('Incorrect PIN / Password', 'error');
        setPassword('');
      }
    } catch (err) {
      console.error("Hashing failed", err);
      toast('Security check failed', 'error');
    }
  };

  if (loading) return null; // Avoid flashing the login screen while checking DB

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
          background: 'linear-gradient(135deg, var(--primary), var(--primary-darker, #1e3a8a))', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          margin: '0 auto 1.5rem',
          boxShadow: '0 8px 16px rgba(30, 64, 175, 0.2)'
        }}>
          {savedHash ? <ShieldCheck size={36} color="white" /> : <Lock size={36} color="white" />}
        </div>
        
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          ArthSutra
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2.5rem' }}>
          {savedHash ? 'Enter your secure PIN to access your data' : 'Enter the default password to continue'}
        </p>

        <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ position: 'relative' }}>
            <input 
              type="password" 
              className="form-input" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={savedHash ? 'Enter PIN...' : 'Password'}
              autoFocus
              style={{ 
                padding: '0.85rem 1rem', 
                fontSize: '1rem', 
                borderRadius: '12px',
                textAlign: 'center',
                letterSpacing: savedHash ? '0.2em' : 'normal'
              }} 
            />
          </div>
          
          <button type="submit" className="btn btn-primary" style={{ 
            width: '100%', 
            padding: '0.85rem', 
            justifyContent: 'center', 
            fontSize: '1rem', 
            borderRadius: '12px' 
          }}>
            Unlock <ArrowRight size={18} />
          </button>
        </form>

      </div>
    </div>
  );
}