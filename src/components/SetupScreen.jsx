import { useState, useRef } from 'react';
import { UserPlus, ArrowRight, Upload, Lock, Unlock, CheckCircle2, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { restoreLocalPreferences } from '../store';
import { toast } from './Toast';

export default function SetupScreen({ onComplete }) {
  const { setupAdmin, updateUser, setIsSetupComplete, checkSetupStatus } = useAuth();
  const [mode, setMode] = useState('new'); // 'new' | 'restore'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Restore-from-backup state
  const fileRef = useRef(null);
  const [backupFile, setBackupFile] = useState(null);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [inspection, setInspection] = useState(null);
  const [restoring, setRestoring] = useState(false);

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

  const inspectBackupFile = async (file, pwd = '') => {
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (pwd) fd.append('password', pwd);
      const res = await fetch('/api/auth/setup-inspect-backup', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read backup file');
      setInspection(data);
    } catch (err) {
      setError(err.message || 'Could not inspect backup file');
    } finally {
      setLoading(false);
    }
  };

  const handlePickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackupFile(f);
    setRecoveryPassword('');
    setInspection(null);
    await inspectBackupFile(f, '');
  };

  const handleUnlockEncrypted = async (e) => {
    e.preventDefault();
    if (!backupFile || !recoveryPassword) return;
    await inspectBackupFile(backupFile, recoveryPassword);
  };

  const handleRestoreSubmit = async (e) => {
    e.preventDefault();
    if (!backupFile || !inspection?.unlocked) return;
    setError('');

    const needsAdmin = !inspection.hasUsers;
    if (needsAdmin) {
      if (!username.trim() || username.trim().length < 3) {
        setError('Create an admin username (at least 3 characters) for the restored data.');
        return;
      }
      if (!password || password.length < 4) {
        setError('Create an admin password (at least 4 characters).');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setRestoring(true);
    try {
      if (inspection.unlockedJsonText) {
        try {
          const parsed = JSON.parse(inspection.unlockedJsonText);
          if (parsed?.localStorage) restoreLocalPreferences(parsed.localStorage);
        } catch { /* ignore */ }
      }

      const fd = new FormData();
      fd.append('file', backupFile);
      if (recoveryPassword) fd.append('password', recoveryPassword);
      if (needsAdmin) {
        fd.append('adminUsername', username.trim());
        fd.append('adminPassword', password);
      }

      const res = await fetch('/api/auth/setup-restore', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');

      if (data.token && data.user) {
        updateUser(data.token, data.user);
        setIsSetupComplete(true);
        toast('Backup restored and admin account created!', 'success', 5000);
        if (onComplete) onComplete();
      } else {
        const names = (data.restoredUsernames || []).join(', ');
        toast(
          names
            ? `Backup restored! Sign in with your restored account (${names}).`
            : 'Backup restored! Please sign in.',
          'success',
          6000
        );
        await checkSetupStatus();
      }
    } catch (err) {
      setError(err.message || 'Restore failed');
    } finally {
      setRestoring(false);
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
        maxWidth: '480px', 
        width: '100%', 
        padding: '2.25rem', 
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0,0,0,0.05)'
      }}>
        
        <div style={{ 
          width: '68px', 
          height: '68px', 
          borderRadius: '18px', 
          background: 'linear-gradient(135deg, var(--primary, #4a7a4a), var(--primary-darker, #2a5a2a))', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          margin: '0 auto 1.25rem',
          boxShadow: '0 8px 16px rgba(74, 122, 74, 0.25)'
        }}>
          {mode === 'restore' ? <RotateCcw size={32} color="white" /> : <UserPlus size={32} color="white" />}
        </div>
        
        <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
          Welcome to ArthSutra
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
          {mode === 'new'
            ? 'First-Time Setup: Create your master administrator account to secure your financial data.'
            : 'Moving to a new PC or recovering after a crash? Restore your entire business from a backup file.'}
        </p>

        {/* Mode Switcher */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.35rem', padding: '0.3rem', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => { setMode('new'); setError(''); }}
            className={`type-chip ${mode === 'new' ? 'type-chip-active' : ''}`}
            style={{ justifyContent: 'center', padding: '0.5rem', fontSize: '0.82rem', fontWeight: 600 }}
          >
            New Business
          </button>
          <button
            type="button"
            onClick={() => { setMode('restore'); setError(''); }}
            className={`type-chip ${mode === 'restore' ? 'type-chip-active' : ''}`}
            style={{ justifyContent: 'center', padding: '0.5rem', fontSize: '0.82rem', fontWeight: 600 }}
          >
            Restore Backup
          </button>
        </div>

        {error && (
          <div style={{ 
            color: '#dc2626', 
            fontSize: '0.85rem', 
            marginBottom: '1.1rem', 
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

        {mode === 'new' ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                  padding: '0.8rem 1rem', 
                  fontSize: '0.98rem', 
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
                  padding: '0.8rem 1rem', 
                  fontSize: '0.98rem', 
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
                  padding: '0.8rem 1rem', 
                  fontSize: '0.98rem', 
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
                marginTop: '0.25rem'
              }}>
              {loading ? 'Creating Account…' : <>Create Account & Start <ArrowRight size={18} /></>}
            </button>
          </form>
        ) : (
          <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input
              ref={fileRef}
              type="file"
              accept=".arthbackup,.json,.sqlite"
              onChange={handlePickFile}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={loading || restoring}
              style={{ width: '100%', padding: '0.85rem', justifyContent: 'center', borderRadius: '12px' }}
            >
              <Upload size={17} /> {backupFile ? `Selected: ${backupFile.name}` : 'Choose Backup File (.arthbackup, .json, .sqlite)'}
            </button>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '-0.5rem 0 0', textAlign: 'center' }}>
              Tip: Browse to your Google Drive (<code>G:\My Drive\ArthSutra Backups</code>), OneDrive, or USB drive.
            </p>

            {inspection && inspection.encrypted && !inspection.unlocked && (
              <form onSubmit={handleUnlockEncrypted} style={{ padding: '0.85rem', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Lock size={15} /> Encrypted Backup — Enter Recovery Password
                </div>
                <input
                  type="password"
                  className="form-input"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  placeholder="Enter Recovery Password"
                  autoFocus
                />
                <button type="submit" className="btn btn-primary" disabled={loading || !recoveryPassword} style={{ justifyContent: 'center' }}>
                  <Unlock size={15} /> {loading ? 'Decrypting…' : 'Unlock Backup'}
                </button>
              </form>
            )}

            {inspection && inspection.unlocked && (
              <form onSubmit={handleRestoreSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ padding: '0.85rem', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: '0.8rem', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                    <CheckCircle2 size={15} /> Backup Verified ({String(inspection.format || '').toUpperCase()})
                  </div>
                  {inspection.businessName && <div>Business: <strong>{inspection.businessName}</strong></div>}
                  <div>
                    Invoices: <strong>{inspection.counts?.bills || 0}</strong> · Clients: <strong>{inspection.counts?.clients || 0}</strong> · Products: <strong>{inspection.counts?.products || 0}</strong>
                  </div>
                  {inspection.exportedAt && (
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      Snapshot date: {new Date(inspection.exportedAt).toLocaleString('en-IN')}
                    </div>
                  )}
                  {inspection.hasUsers && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.76rem', color: 'var(--text-primary)' }}>
                      Includes your existing login accounts ({inspection.counts?.users || 1}). You will sign in with your existing password after restore.
                    </div>
                  )}
                </div>

                {!inspection.hasUsers && (
                  <div style={{ padding: '0.85rem', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Create Admin Login for Restored Data</div>
                    <input type="text" className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin username (min 3 chars)" />
                    <input type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 4 chars)" />
                    <input type="password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" />
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={restoring}
                  style={{ width: '100%', padding: '0.85rem', justifyContent: 'center', fontSize: '0.98rem', fontWeight: 600, borderRadius: '12px' }}
                >
                  {restoring ? 'Restoring Business Data…' : <>Restore &amp; Continue <ArrowRight size={18} /></>}
                </button>
              </form>
            )}
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginTop: '1.25rem', marginBottom: 0 }}>
          🔒 Your data is stored locally on your machine in SQLite with AES-256-GCM encryption.
        </p>

      </div>
    </div>
  );
}
