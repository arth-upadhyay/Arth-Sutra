import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

export default function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Accepts ARTH or Arth as the password
    if (password === 'ARTH' || password === 'Arth') {
      onUnlock();
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div style={{ 
      display: 'flex', height: '100vh', width: '100vw', 
      alignItems: 'center', justifyContent: 'center', 
      backgroundColor: '#0f172a', zIndex: 9999, position: 'fixed', top: 0, left: 0 
    }}>
      <form onSubmit={handleSubmit} style={{ 
        background: '#1e293b', padding: '40px', borderRadius: '12px', 
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)', textAlign: 'center', 
        maxWidth: '400px', width: '90%', boxSizing: 'border-box'
      }}>
        <div style={{ 
          display: 'inline-flex', padding: '15px', borderRadius: '50%', 
          background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', marginBottom: '20px' 
        }}>
          <Lock size={32} />
        </div>
        <h2 style={{ color: '#fff', fontSize: '24px', margin: '0 0 10px 0', fontWeight: 'bold' }}>
          Billing Locked
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '25px' }}>
          Enter password to access the dashboard.
        </p>
        
        <div style={{ position: 'relative' }}>
          <input 
            type="password" 
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder="Password"
            style={{ 
              width: '100%', padding: '12px 45px 12px 15px', borderRadius: '8px', 
              border: error ? '1px solid #ef4444' : '1px solid #334155', 
              background: '#0f172a', color: '#fff', fontSize: '16px', 
              outline: 'none', boxSizing: 'border-box' 
            }}
            autoFocus
          />
          <button type="submit" style={{ 
            position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', 
            background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '6px', 
            padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            <ArrowRight size={18} />
          </button>
        </div>
        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', textAlign: 'left', margin: '10px 0 0 0' }}>
            Incorrect password. Try again.
          </p>
        )}
      </form>
    </div>
  );
}