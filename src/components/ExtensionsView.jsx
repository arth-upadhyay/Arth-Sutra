import React, { useState, useEffect } from 'react';
import {
  Blocks,
  FileCode2,
  Download,
  Copy,
  Check,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  Code2,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function ExtensionsView() {
  const { token } = useAuth();
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for Tally Export custom UI
  const [bills, setBills] = useState([]);
  const [selectedBillId, setSelectedBillId] = useState('');
  const [xmlPreview, setXmlPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);

  const fetchPlugins = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/plugins', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch plugins`);
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch (err) {
      console.error('Failed to load plugins:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchBills = async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/bills', { headers });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.bills || []);
      setBills(list.filter(b => !b.isTrashed));
      if (list.length > 0 && !selectedBillId) {
        setSelectedBillId(list[0].id);
      }
    } catch (err) {
      console.warn('Failed to fetch bills for exporter:', err);
    }
  };

  useEffect(() => {
    fetchPlugins();
    fetchBills();
  }, [token]);

  const handlePreviewXml = async (billId) => {
    if (!billId) return;
    setPreviewLoading(true);
    setExportMessage(null);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/plugins/tally/${encodeURIComponent(billId)}`, { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const text = await res.text();
      setXmlPreview(text);
    } catch (err) {
      setExportMessage({ type: 'error', text: 'Error previewing XML: ' + err.message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadXml = async (billId) => {
    if (!billId) return;
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/plugins/tally/${encodeURIComponent(billId)}`, { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const selectedBill = bills.find(b => b.id === billId);
      const filename = `tally-${selectedBill?.invoiceNumber || billId}.xml`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setExportMessage({ type: 'success', text: `Downloaded "${filename}" successfully!` });
    } catch (err) {
      setExportMessage({ type: 'error', text: 'Export failed: ' + err.message });
    }
  };

  const handleCopyXml = () => {
    if (!xmlPreview) return;
    navigator.clipboard.writeText(xmlPreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="view-container" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
            }}>
              <Blocks size={22} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Extensions & Plugins
              </h1>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Extend Arth-Sutra backend endpoints, integrations, and custom UI components.
              </p>
            </div>
          </div>
        </div>

        <button
          className="btn-secondary"
          onClick={fetchPlugins}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem' }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>Reload Plugins</span>
        </button>
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          color: '#ef4444',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Plugin Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        {loading ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', gridColumn: '1 / -1' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem', opacity: 0.7 }} />
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Discovering active plugins...</p>
          </div>
        ) : plugins.length === 0 ? (
          <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', gridColumn: '1 / -1' }}>
            <Blocks size={40} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
            <h3 style={{ margin: '0 0 0.5rem' }}>No plugins detected</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto' }}>
              Drop custom extension scripts into the <code>plugins/</code> folder to add custom API endpoints and automations.
            </p>
          </div>
        ) : (
          plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="glass-panel"
              style={{
                padding: '1.5rem',
                borderRadius: 12,
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'var(--primary-light, rgba(59, 130, 246, 0.15))',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <FileCode2 size={18} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>{plugin.name}</h3>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        v{plugin.version} • by {plugin.author || 'Custom'}
                      </span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.55rem',
                    borderRadius: 20,
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}>
                    <CheckCircle2 size={12} /> Active
                  </span>
                </div>

                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
                  {plugin.description}
                </p>

                {plugin.endpoints && plugin.endpoints.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Registered Endpoints:
                    </span>
                    <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {plugin.endpoints.map((ep, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            padding: '0.25rem 0.5rem',
                            borderRadius: 6,
                            background: 'var(--bg-secondary, rgba(0,0,0,0.05))',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{ep.method}</span>
                          <span style={{ color: 'var(--text-primary)' }}>{ep.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  ID: <code>{plugin.id}</code>
                </span>
                {plugin.ui?.badge && (
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '0.15rem 0.5rem',
                    borderRadius: 12,
                    background: 'var(--primary-light)',
                    color: 'var(--primary)',
                  }}>
                    {plugin.ui.badge}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Dynamic UI Component: Tally ERP Exporter Widget */}
      {plugins.some(p => p.id === 'tally-export') && (
        <div
          className="glass-panel"
          style={{
            padding: '1.75rem',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            marginBottom: '2rem',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Sparkles size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Tally ERP XML Exporter
              </h2>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Select a completed sales bill to export into Tally XML format (Sales Voucher view).
              </p>
            </div>
          </div>

          {exportMessage && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: 8,
              fontSize: '0.875rem',
              marginBottom: '1rem',
              background: exportMessage.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${exportMessage.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: exportMessage.type === 'success' ? '#15803d' : '#b91c1c',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              {exportMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{exportMessage.text}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.25rem' }}>
            <div style={{ flex: '1 1 280px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                Select Invoice to Export:
              </label>
              <select
                className="form-input"
                value={selectedBillId}
                onChange={(e) => {
                  setSelectedBillId(e.target.value);
                  setXmlPreview('');
                  setExportMessage(null);
                }}
                style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              >
                {bills.length === 0 ? (
                  <option value="">No invoices available</option>
                ) : (
                  bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.invoiceNumber || 'INV-?'} — {b.clientName || 'Counter Sale'} ({b.invoiceDate}) — ₹{Number(b.totalAmount || 0).toLocaleString('en-IN')}
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              className="btn-secondary"
              onClick={() => handlePreviewXml(selectedBillId)}
              disabled={!selectedBillId || previewLoading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1rem' }}
            >
              <Code2 size={16} />
              <span>{previewLoading ? 'Generating...' : 'Preview XML'}</span>
            </button>

            <button
              className="btn-primary"
              onClick={() => handleDownloadXml(selectedBillId)}
              disabled={!selectedBillId}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.25rem' }}
            >
              <Download size={16} />
              <span>Download Tally XML</span>
            </button>
          </div>

          {/* XML Preview Box */}
          {xmlPreview && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Generated XML Envelope Preview:
                </span>
                <button
                  className="btn-secondary"
                  onClick={handleCopyXml}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy XML'}</span>
                </button>
              </div>
              <pre
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                  padding: '1rem',
                  borderRadius: 8,
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  fontFamily: 'Consolas, Monaco, monospace',
                  lineHeight: 1.45,
                  margin: 0,
                  border: '1px solid #1e293b',
                }}
              >
                <code>{xmlPreview}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Developer / Enterprise Extension Documentation Box */}
      <div
        className="glass-panel"
        style={{
          padding: '1.5rem',
          borderRadius: 12,
          border: '1px dashed var(--border-color)',
          background: 'rgba(248, 250, 252, 0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Info size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Building Custom Plugins</h3>
        </div>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Arth-Sutra automatically hot-loads JavaScript plugins placed inside the root <code>plugins/</code> folder (or <code>%APPDATA%\arth-sutra\plugins</code> in production).
          A valid plugin exports a simple object with routes and metadata:
        </p>
        <pre
          style={{
            padding: '0.85rem',
            borderRadius: 6,
            background: 'var(--bg-secondary, #f1f5f9)',
            fontSize: '0.8rem',
            fontFamily: 'Consolas, monospace',
            margin: 0,
            overflowX: 'auto',
          }}
        >
{`export default {
  name: 'my-custom-plugin',
  displayName: 'My Custom Integration',
  version: '1.0.0',
  registerRoutes(app, { db, sqlite, bills }) {
    app.get('/api/plugins/my-custom-endpoint', (req, res) => {
      res.json({ status: 'ok', time: new Date().toISOString() });
    });
  }
};`}
        </pre>
      </div>
    </div>
  );
}
