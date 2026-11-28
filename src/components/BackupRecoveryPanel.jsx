import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, ShieldAlert, Cloud, CloudOff, FolderSync, HardDrive,
  RefreshCw, Lock, Unlock, Download, Upload, CheckCircle2, AlertTriangle, ExternalLink, Save,
} from 'lucide-react';
import {
  getBackupHealth, testMirrorFolder, saveBackupConfig, syncMirrorNow,
  markGoogleDriveSync, exportAllData, exportEncryptedBackup,
  inspectUploadedBackup, restoreUploadedBackup, restoreLocalPreferences, saveProfile,
} from '../store';
import {
  initGoogleDrive, isConnected, disconnect, ensureToken,
  findOrCreateFolder, uploadJSON, listBackupsInFolder, downloadFileText,
} from '../services/googleDrive';
import { toast } from './Toast';
import { confirmAction } from './ConfirmModal';
import { useAuth } from '../context/AuthContext';

function formatRelativeTime(isoStr) {
  if (!isoStr) return 'Never';
  const diffMs = Date.now() - Date.parse(isoStr);
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function BackupRecoveryPanel({
  profile,
  onProfileChange,
  onSaveProfile,
  onAfterRestore,
  onHealthUpdated,
}) {
  const { isAdmin, isAccountant } = useAuth();
  const [health, setHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  // Off-PC mirror config form state
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [mirrorPath, setMirrorPath] = useState('');
  const [mirrorProvider, setMirrorProvider] = useState('');
  const [mirrorPdfs, setMirrorPdfs] = useState(true);
  const [autoSyncOnChange, setAutoSyncOnChange] = useState(true);
  const [useRecoveryPassword, setUseRecoveryPassword] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordHint, setRecoveryPasswordHint] = useState('');
  const [hasSavedRecoveryPassword, setHasSavedRecoveryPassword] = useState(false);
  const [folderTestResult, setFolderTestResult] = useState(null);
  const [savingMirror, setSavingMirror] = useState(false);
  const [syncingMirror, setSyncingMirror] = useState(false);

  // Direct Google Drive API state
  const [driveConnected, setDriveConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveEncryptPass, setDriveEncryptPass] = useState('');
  const [showDriveRestoreModal, setShowDriveRestoreModal] = useState(false);
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveLoadingList, setDriveLoadingList] = useState(false);
  const [driveUnlockModal, setDriveUnlockModal] = useState(null); // { fileName, text, password, error }
  const [driveRestoring, setDriveRestoring] = useState(false);
  const [savingDriveSettings, setSavingDriveSettings] = useState(false);

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const h = await getBackupHealth();
      setHealth(h);
      const cfg = h?.config || {};
      setMirrorEnabled(Boolean(cfg.mirrorEnabled));
      setMirrorPath(cfg.mirrorPath || '');
      setMirrorProvider(cfg.mirrorProvider || '');
      setMirrorPdfs(cfg.mirrorPdfs !== false);
      setAutoSyncOnChange(cfg.autoSyncOnChange !== false);
      setUseRecoveryPassword(Boolean(cfg.useRecoveryPassword));
      setHasSavedRecoveryPassword(Boolean(cfg.hasRecoveryPassword));
      setRecoveryPasswordHint(cfg.recoveryPasswordHint || '');
      if (onHealthUpdated) onHealthUpdated(h);
    } catch {
      /* server might not be ready */
    } finally {
      setLoadingHealth(false);
    }
  }, [onHealthUpdated]);

  useEffect(() => {
    loadHealth();
    setDriveConnected(isConnected());
  }, [loadHealth]);

  const handleTestFolder = async (pathOverride) => {
    const target = typeof pathOverride === 'string' ? pathOverride : mirrorPath;
    if (!target.trim()) {
      setFolderTestResult({ ok: false, error: 'Enter a folder path first.' });
      return;
    }
    try {
      const res = await testMirrorFolder(target);
      setFolderTestResult(res);
      if (res.ok && res.resolvedPath) {
        setMirrorPath(res.resolvedPath);
      }
    } catch (err) {
      setFolderTestResult({ ok: false, error: err.message });
    }
  };

  const handleSelectDetectedFolder = async (folder) => {
    setMirrorPath(folder.suggestedBackupPath);
    setMirrorProvider(folder.provider);
    setMirrorEnabled(true);
    await handleTestFolder(folder.suggestedBackupPath);
  };

  const handleSaveMirrorConfig = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      toast('Only Admin can change backup settings', 'warning');
      return;
    }
    if (mirrorEnabled && !mirrorPath.trim()) {
      toast('Enter or choose an off-PC folder path', 'warning');
      return;
    }
    if (useRecoveryPassword && !hasSavedRecoveryPassword && recoveryPassword.length < 4) {
      toast('Enter a Recovery Password (at least 4 characters)', 'warning');
      return;
    }

    setSavingMirror(true);
    try {
      const res = await saveBackupConfig({
        mirrorEnabled,
        mirrorPath: mirrorPath.trim(),
        mirrorProvider: mirrorProvider || 'Custom Folder',
        mirrorPdfs,
        autoSyncOnChange,
        useRecoveryPassword,
        recoveryPassword: recoveryPassword || undefined,
        recoveryPasswordHint,
        syncNow: mirrorEnabled,
      });
      setRecoveryPassword('');
      if (res.mirrorResult?.ok === false) {
        toast('Saved, but initial sync failed: ' + res.mirrorResult.error, 'warning');
      } else if (mirrorEnabled) {
        toast('Off-PC backup enabled and synced!', 'success');
      } else {
        toast('Backup settings saved', 'success');
      }
      await loadHealth();
    } catch (err) {
      toast(err.message || 'Failed to save backup settings', 'error');
    } finally {
      setSavingMirror(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncingMirror(true);
    try {
      await syncMirrorNow();
      toast('Local snapshot verified & synced to off-PC folder!', 'success');
      await loadHealth();
    } catch (err) {
      toast('Sync failed: ' + (err.message || 'unknown error'), 'error');
      await loadHealth();
    } finally {
      setSyncingMirror(false);
    }
  };

  const persistDriveProfileFields = async ({ silent = false } = {}) => {
    if (!isAccountant) {
      if (!silent) toast('Only Admin or Accountant can save Google Drive settings', 'warning');
      return false;
    }
    setSavingDriveSettings(true);
    try {
      if (onSaveProfile) {
        await onSaveProfile();
      } else {
        await saveProfile({ ...(profile || {}), country: 'India' });
      }
      if (!silent) toast('Google Drive settings saved!', 'success');
      return true;
    } catch (err) {
      if (!silent) toast(err.message || 'Failed to save Drive settings', 'error');
      return false;
    } finally {
      setSavingDriveSettings(false);
    }
  };

  const handleConnectDrive = async () => {
    const clientId = profile?.googleClientId?.trim();
    if (!clientId) {
      toast('Enter your Google OAuth Client ID first', 'warning');
      return;
    }
    setConnecting(true);
    try {
      const result = await initGoogleDrive(clientId);
      if (result.success) {
        setDriveConnected(true);
        if (isAccountant) {
          await persistDriveProfileFields({ silent: true });
        }
        toast('Connected to Google Drive!', 'success');
      } else {
        toast('Failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      toast('Connection failed: ' + err.message, 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectDrive = () => {
    disconnect();
    setDriveConnected(false);
    toast('Disconnected from Google Drive', 'info');
  };

  const handleUploadNowToDrive = async () => {
    const clientId = profile?.googleClientId?.trim();
    if (!clientId) {
      toast('Enter and save your Google OAuth Client ID first', 'warning');
      return;
    }
    setDriveUploading(true);
    try {
      if (isAccountant) {
        await persistDriveProfileFields({ silent: true });
      }
      const ok = await ensureToken(clientId);
      if (!ok) {
        toast('Google Drive authentication was cancelled or failed', 'warning');
        return;
      }
      setDriveConnected(true);
      const folderName = (profile?.googleDriveFolder || 'Arth Sutra Invoices') + ' - Backups';
      const folderId = await findOrCreateFolder(folderName);

      const dateSlug = new Date().toISOString().split('T')[0];
      let fileName;
      let content;
      if (driveEncryptPass.trim().length >= 4) {
        const res = await exportEncryptedBackup(driveEncryptPass.trim());
        content = res.encryptedText;
        fileName = `arthsutra-backup-${dateSlug}.arthbackup`;
      } else {
        content = await exportAllData(undefined, { includeRecoveryMeta: true });
        fileName = `arthsutra-backup-${dateSlug}.json`;
      }

      const uploaded = await uploadJSON(fileName, content, folderId);
      await markGoogleDriveSync().catch(() => {});
      toast(`Uploaded to Google Drive: ${uploaded.name}`, 'success');
      await loadHealth();
    } catch (err) {
      toast('Google Drive upload failed: ' + (err.message || 'unknown error'), 'error');
    } finally {
      setDriveUploading(false);
    }
  };

  const handleOpenDriveRestore = async () => {
    if (!isAdmin) {
      toast('Only Admin can restore backups', 'warning');
      return;
    }
    const clientId = profile?.googleClientId?.trim();
    if (!clientId) {
      toast('Enter your Google OAuth Client ID first', 'warning');
      return;
    }
    setShowDriveRestoreModal(true);
    setDriveLoadingList(true);
    try {
      const ok = await ensureToken(clientId);
      if (!ok) {
        setDriveFiles([]);
        toast('Google Drive authentication failed', 'warning');
        return;
      }
      setDriveConnected(true);
      const folderName = (profile?.googleDriveFolder || 'Arth Sutra Invoices') + ' - Backups';
      const folderId = await findOrCreateFolder(folderName);
      const files = await listBackupsInFolder(folderId);
      setDriveFiles(files);
    } catch (err) {
      toast('Could not list Drive backups: ' + err.message, 'error');
    } finally {
      setDriveLoadingList(false);
    }
  };

  const handlePickDriveFile = async (file) => {
    try {
      const text = await downloadFileText(file.id);
      const inspection = await inspectUploadedBackup({ text });
      if (inspection.encrypted && !inspection.unlocked) {
        setDriveUnlockModal({ fileName: file.name, text, password: '', error: '' });
        return;
      }
      await confirmAndRestoreDriveText({ fileName: file.name, text, password: '', inspection });
    } catch (err) {
      toast('Failed to read Drive backup: ' + err.message, 'error');
    }
  };

  const confirmAndRestoreDriveText = async ({ fileName, text, password, inspection }) => {
    const counts = inspection?.counts || {};
    const summary = `${counts.bills || 0} invoice(s), ${counts.clients || 0} client(s), ${counts.products || 0} product(s)`;
    const confirmed = await confirmAction({
      title: `Restore "${fileName}" from Google Drive?`,
      message: `Contains ${summary}. This will overwrite matching records on this PC.`,
      confirmLabel: 'Restore backup',
      tone: 'warning',
    });
    if (!confirmed) return;

    setDriveRestoring(true);
    try {
      await restoreUploadedBackup({ text, password, overwrite: true });
      try {
        const parsed = JSON.parse(inspection?.unlockedJsonText || text);
        if (parsed?.localStorage) restoreLocalPreferences(parsed.localStorage);
      } catch { /* non-fatal if localStorage block absent */ }
      toast('Restored from Google Drive! Reloading...', 'success');
      setDriveUnlockModal(null);
      setShowDriveRestoreModal(false);
      if (onAfterRestore) onAfterRestore();
    } catch (err) {
      toast('Restore failed: ' + err.message, 'error');
    } finally {
      setDriveRestoring(false);
    }
  };

  const handleUnlockDriveFile = async (e) => {
    e.preventDefault();
    if (!driveUnlockModal) return;
    try {
      const inspection = await inspectUploadedBackup({
        text: driveUnlockModal.text,
        password: driveUnlockModal.password,
      });
      await confirmAndRestoreDriveText({
        fileName: driveUnlockModal.fileName,
        text: driveUnlockModal.text,
        password: driveUnlockModal.password,
        inspection,
      });
    } catch (err) {
      setDriveUnlockModal(prev => prev ? { ...prev, error: err.message } : null);
    }
  };

  const detectedFolders = health?.detectedCloudFolders?.folders || [];
  const hasGDrive = Boolean(health?.detectedCloudFolders?.hasGoogleDriveDesktop);
  const protectionLevel = health?.protectionLevel || 'local-only';

  return (
    <div id="section-cloud" className="glass-panel p-6 mb-6">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Cloud size={20} color="var(--primary)" /> Off-PC Disaster Recovery &amp; Cloud Sync
          </h3>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Protect your business data so even if this PC crashes, gets wiped, or is stolen, every bill, client, product, and PDF can be restored on another PC.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadHealth} disabled={loadingHealth} style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}>
          <RefreshCw size={14} /> {loadingHealth ? 'Checking…' : 'Re-scan PC Drives'}
        </button>
      </div>

      {/* ---- Protection Health Status Banner ---- */}
      <div
        className={`notice ${
          protectionLevel === 'protected'
            ? 'notice-info'
            : protectionLevel === 'warning'
              ? 'notice-warn'
              : 'notice-danger'
        }`}
        style={{ marginBottom: '1.25rem', alignItems: 'flex-start' }}
      >
        <span className="notice-icon" style={{ marginTop: 2 }}>
          {protectionLevel === 'protected' ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
        </span>
        <div style={{ flex: 1 }}>
          {protectionLevel === 'protected' ? (
            <>
              <strong>PC Crash Protection: Active</strong>
              <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', lineHeight: 1.5 }}>
                {health?.config?.mirrorEnabled && health?.config?.lastMirrorStatus === 'ok' && (
                  <div>
                    Off-PC Mirror: <code>{health.config.mirrorPath}</code> · Synced{' '}
                    <strong>{formatRelativeTime(health.config.lastMirrorSyncAt)}</strong>
                    {health.config.useRecoveryPassword ? ' · 🔒 Encrypted (.arthbackup)' : ' · Portable SQLite + JSON'}
                  </div>
                )}
                {health?.config?.lastDriveSyncAt && (
                  <div>
                    Google Drive API upload: <strong>{formatRelativeTime(health.config.lastDriveSyncAt)}</strong>
                  </div>
                )}
                <div>
                  Database Integrity: <strong>{health?.integrity?.ok ? 'Verified OK' : health?.integrity?.detail}</strong> · Local Snapshots: <strong>{health?.localBackups?.count || 0}</strong>
                </div>
              </div>
            </>
          ) : protectionLevel === 'warning' ? (
            <>
              <strong>Off-PC Sync Needs Attention</strong>
              <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', lineHeight: 1.5 }}>
                {health?.config?.lastMirrorError
                  ? <>Last mirror sync failed: <strong>{health.config.lastMirrorError}</strong></>
                  : <>Last off-PC backup was <strong>{formatRelativeTime(health?.latestOffPcSyncAt)}</strong>. Trigger a sync now.</>}
              </div>
            </>
          ) : (
            <>
              <strong>At Risk: Backups are currently on this PC only</strong>
              <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', lineHeight: 1.5 }}>
                Your local database and daily snapshots live inside <code>{health?.dataDir || 'data/'}</code>.
                If this PC&apos;s drive fails or Windows is reinstalled, local backups would be lost too. Connect{' '}
                <strong>Google Drive for Desktop</strong>, <strong>OneDrive</strong>, or a <strong>USB / D: drive</strong> below.
              </div>
            </>
          )}
        </div>
        {mirrorEnabled && (
          <button type="button" className="btn btn-primary" onClick={handleSyncNow} disabled={syncingMirror} style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem', whiteSpace: 'nowrap' }}>
            <FolderSync size={14} /> {syncingMirror ? 'Syncing…' : 'Sync Off-PC Now'}
          </button>
        )}
      </div>

      {/* ---- Option 1: Automatic Cloud/External Folder Mirror ---- */}
      <form onSubmit={handleSaveMirrorConfig} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '1.15rem', marginBottom: '1rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <h4 style={{ fontSize: '0.95rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HardDrive size={17} color="var(--primary)" />
            Automatic Off-PC Mirror Folder (Google Drive Desktop / OneDrive / USB)
          </h4>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={mirrorEnabled}
              onChange={(e) => setMirrorEnabled(e.target.checked)}
              disabled={!isAdmin}
              style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
            />
            Enable Auto-Mirror
          </label>
        </div>

        {/* Detected cloud folders */}
        {detectedFolders.length > 0 && (
          <div style={{ marginBottom: '0.85rem' }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              Detected cloud folders on this PC (click to select):
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {detectedFolders.map((f) => {
                const selected = mirrorPath.toLowerCase() === f.suggestedBackupPath.toLowerCase();
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => handleSelectDetectedFolder(f)}
                    className={`type-chip ${selected ? 'type-chip-active' : ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}
                  >
                    <Cloud size={13} />
                    <span><strong>{f.provider}</strong> ({f.rootPath})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Google Drive Desktop install guide when not yet mounted */}
        {!hasGDrive && (
          <div style={{ padding: '0.75rem 0.9rem', borderRadius: 8, background: 'var(--card-bg)', border: '1px dashed var(--border)', marginBottom: '0.85rem', fontSize: '0.8rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Cloud size={15} color="var(--primary)" /> Want to auto-backup to Google Drive with zero API setup?
            </div>
            <ol style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
              <li>
                <a href="https://www.google.com/drive/download/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                  Install Google Drive for Desktop <ExternalLink size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
                </a>{' '}
                and sign in with your Google account — a <strong>G:\My Drive</strong> drive appears on your PC.
              </li>
              <li>Click <strong>Re-scan PC Drives</strong> above and select <strong>Google Drive for Desktop</strong>.</li>
              <li>Arth-Sutra will automatically copy your full database, recovery bundle, and PDFs into <code>G:\My Drive\ArthSutra Backups</code> whenever you save invoices.</li>
            </ol>
          </div>
        )}

        <div className="form-group" style={{ marginBottom: '0.75rem' }}>
          <label className="form-label" style={{ fontSize: '0.8rem' }}>Backup Mirror Folder Path (Google Drive, OneDrive, D:\ drive, or USB drive)</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1, minWidth: 240 }}
              value={mirrorPath}
              onChange={(e) => { setMirrorPath(e.target.value); setFolderTestResult(null); }}
              placeholder="e.g. G:\My Drive\ArthSutra Backups or C:\Users\...\OneDrive\ArthSutra Backups"
              disabled={!isAdmin}
            />
            <button type="button" className="btn btn-secondary" onClick={() => handleTestFolder()} disabled={!isAdmin || !mirrorPath.trim()}>
              Verify Folder
            </button>
          </div>
          {folderTestResult && (
            <div style={{ fontSize: '0.76rem', marginTop: '0.35rem', color: folderTestResult.ok ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {folderTestResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <span>{folderTestResult.ok ? `Writable & verified: ${folderTestResult.resolvedPath}` : folderTestResult.error}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoSyncOnChange}
              onChange={(e) => setAutoSyncOnChange(e.target.checked)}
              disabled={!isAdmin}
              style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
            />
            <span>Auto-sync automatically within 10s whenever invoices, clients, inventory, or settings change</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={mirrorPdfs}
              onChange={(e) => setMirrorPdfs(e.target.checked)}
              disabled={!isAdmin}
              style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
            />
            <span>Also sync <code>Saved Invoices/</code> PDFs into this folder (incremental — only copies new/updated PDFs)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useRecoveryPassword}
              onChange={(e) => setUseRecoveryPassword(e.target.checked)}
              disabled={!isAdmin}
              style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
            />
            <span>
              <strong><Lock size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> Encrypt off-PC backups with a Recovery Password</strong> (<code>.arthbackup</code> AES-256-GCM)
            </span>
          </label>
        </div>

        {useRecoveryPassword && (
          <div style={{ padding: '0.75rem', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--border)', marginBottom: '0.85rem' }}>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.76rem' }}>
                  {hasSavedRecoveryPassword ? 'Change Recovery Password (leave blank to keep current)' : 'Recovery Password *'}
                </label>
                <input
                  type="password"
                  className="form-input"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  placeholder={hasSavedRecoveryPassword ? '•••••••• (saved)' : 'Min 4 characters'}
                  disabled={!isAdmin}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.76rem' }}>Password Hint (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={recoveryPasswordHint}
                  onChange={(e) => setRecoveryPasswordHint(e.target.value)}
                  placeholder="e.g. Same as shop safe PIN + year"
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.45rem 0 0' }}>
              Keep this password safe. You will enter it when restoring <code>.arthbackup</code> files on a replacement PC.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {!isAdmin
              ? 'Sign in as Admin to change off-PC backup destination.'
              : 'Writes latest snapshot + 30 rolling daily snapshots + HOW-TO-RESTORE.txt'}
          </span>
          {isAdmin && (
            <button type="submit" className="btn btn-primary" disabled={savingMirror}>
              <FolderSync size={15} /> {savingMirror ? 'Saving & Syncing…' : (mirrorEnabled ? 'Save & Sync Now' : 'Save Settings')}
            </button>
          )}
        </div>
      </form>

      {/* ---- Option 2: Direct Google Drive API Upload & Restore ---- */}
      <details style={{ fontSize: '0.85rem' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '0.5rem 0', fontWeight: 600 }}>
          Alternative: Direct Google Drive API Upload &amp; Restore (works without installing Drive Desktop)
        </summary>
        <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border)', marginTop: '0.35rem' }}>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group full-width">
              <label className="form-label">Google OAuth Client ID</label>
              <input
                type="text"
                name="googleClientId"
                className="form-input"
                value={profile?.googleClientId || ''}
                onChange={onProfileChange}
                disabled={!isAccountant}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Drive Folder Name</label>
              <input
                type="text"
                name="googleDriveFolder"
                className="form-input"
                value={profile?.googleDriveFolder || ''}
                onChange={onProfileChange}
                disabled={!isAccountant}
                placeholder="Arth Sutra Invoices"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Connection Status</label>
              <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
                {isAccountant && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
                    onClick={() => persistDriveProfileFields({ silent: false })}
                    disabled={savingDriveSettings}
                  >
                    <Save size={14} /> {savingDriveSettings ? 'Saving…' : 'Save Drive Settings'}
                  </button>
                )}
                {driveConnected ? (
                  <>
                    <span className="status-badge" style={{ background: 'var(--info-bg)', color: 'var(--info-text)' }}>
                      <Cloud size={14} /> Connected
                    </span>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={handleDisconnectDrive}>
                      <CloudOff size={14} /> Disconnect
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={handleConnectDrive} disabled={connecting}>
                    <Cloud size={16} /> {connecting ? 'Connecting…' : 'Connect Google Drive'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem', padding: '0.75rem', borderRadius: 8, background: 'var(--bg-secondary)' }}>
            <input
              type="password"
              className="form-input"
              style={{ maxWidth: 240, fontSize: '0.8rem' }}
              value={driveEncryptPass}
              onChange={(e) => setDriveEncryptPass(e.target.value)}
              placeholder="Optional encryption password"
            />
            <button type="button" className="btn btn-primary" style={{ fontSize: '0.8rem' }} onClick={handleUploadNowToDrive} disabled={driveUploading}>
              <Upload size={14} /> {driveUploading ? 'Uploading…' : 'Upload Backup to Drive'}
            </button>
            {isAdmin && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleOpenDriveRestore}>
                <Download size={14} /> Restore from Google Drive…
              </button>
            )}
          </div>
        </div>
      </details>

      {/* ---- Drive Restore List Modal ---- */}
      {showDriveRestoreModal && (
        <div className="modal-overlay" onClick={() => !driveRestoring && setShowDriveRestoreModal(false)}>
          <div className="modal-content" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginTop: 0 }}>Restore from Google Drive</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Folder: <em>{(profile?.googleDriveFolder || 'Arth Sutra Invoices')} - Backups</em>
            </p>
            {driveLoadingList ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading backups from Google Drive…</p>
            ) : driveFiles.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No `.arthbackup` or `.json` backup files found in this Google Drive folder.</p>
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {driveFiles.map((f) => (
                  <div key={f.id} className="surface-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.8rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.name.endsWith('.arthbackup') ? '🔒 ' : ''}{f.name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('en-IN') : ''}
                        {f.size ? ` · ${(Number(f.size) / 1024).toFixed(1)} KB` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.76rem', padding: '0.35rem 0.7rem' }}
                      onClick={() => handlePickDriveFile(f)}
                      disabled={driveRestoring}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setShowDriveRestoreModal(false)} disabled={driveRestoring}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Drive Encrypted Backup Unlock Modal ---- */}
      {driveUnlockModal && (
        <div className="modal-overlay" onClick={() => !driveRestoring && setDriveUnlockModal(null)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Lock size={18} /> Unlock Encrypted Backup
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Enter your Recovery Password to decrypt <strong>{driveUnlockModal.fileName}</strong>.
            </p>
            {driveUnlockModal.error && (
              <div style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.6rem' }}>{driveUnlockModal.error}</div>
            )}
            <form onSubmit={handleUnlockDriveFile}>
              <input
                type="password"
                className="form-input"
                autoFocus
                value={driveUnlockModal.password}
                onChange={(e) => setDriveUnlockModal(prev => ({ ...prev, password: e.target.value, error: '' }))}
                placeholder="Recovery Password"
                style={{ width: '100%', marginBottom: '0.85rem' }}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn btn-secondary" onClick={() => setDriveUnlockModal(null)} disabled={driveRestoring}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={driveRestoring || !driveUnlockModal.password}>
                  <Unlock size={15} /> {driveRestoring ? 'Restoring…' : 'Unlock & Restore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
