import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getCountryConfig, getStatesForCountry, validateTaxId, PAPER_SIZES } from '../utils';

export default function ClientModal({ show, onClose, onSave, client, isEditing }) {
  const emptyForm = {
    name: '', address: '', city: '', pin: '', state: '', gstin: '', licence: '', email: '', phone: '',
    country: 'India', isSEZ: false,
    preferredPaperSize: '',
    preferredCurrency: 'INR',
    preferredLayoutFormat: '',
    autoPrint: false,
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [taxIdWarning, setTaxIdWarning] = useState('');

  useEffect(() => {
    if (show && client) {
      setForm({
        name: client.name || '', address: client.address || '', city: client.city || '',
        pin: client.pin || '', state: client.state || '', gstin: client.gstin || '',
        licence: client.licence || '',
        email: client.email || '', phone: client.phone || '', country: 'India',
        isSEZ: !!client.isSEZ,
        preferredPaperSize: client.preferredPaperSize || '',
        preferredCurrency: 'INR',
        preferredLayoutFormat: client.preferredLayoutFormat || '',
        autoPrint: !!client.autoPrint,
      });
    } else if (show) {
      setForm({ ...emptyForm });
    }
    setTaxIdWarning('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, client]);

  if (!show) return null;

  const cc = getCountryConfig('India');
  const stateOptions = getStatesForCountry('India');

  const handleTaxIdBlur = () => {
    const result = validateTaxId('India', form.gstin);
    setTaxIdWarning(result.ok ? '' : result.message);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, country: 'India', preferredCurrency: 'INR' });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>{isEditing ? 'Edit Client' : 'Add New Client'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Client / Business Name *</label>
            <input type="text" className="form-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Acme Pharma Distributors" />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Address</label>
            <input type="text" className="form-input" value={form.address} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} placeholder="Street address, locality" />
          </div>
          <div className="form-group">
            <label className="form-label">City</label>
            <input type="text" className="form-input" value={form.city} onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))} placeholder="e.g. Bhopal" />
          </div>
          <div className="form-group">
            <label className="form-label">{cc.postalLabel}</label>
            <input type="text" className="form-input" value={form.pin} onChange={e => setForm(prev => ({ ...prev, pin: e.target.value }))} placeholder="e.g. 462001" />
          </div>
          <div className="form-group">
            <label className="form-label">{cc.stateLabel}</label>
            <select className="form-input" value={form.state} onChange={e => setForm(prev => ({ ...prev, state: e.target.value }))}>
              <option value="">Select {cc.stateLabel}</option>
              {form.state && !stateOptions.includes(form.state) && (
                <option value={form.state}>{form.state}</option>
              )}
              {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{cc.taxIdLabel}</label>
            <input type="text" className="form-input"
              style={taxIdWarning ? { borderColor: '#f59e0b' } : undefined}
              value={form.gstin}
              onChange={e => { setForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() })); if (taxIdWarning) setTaxIdWarning(''); }}
              onBlur={handleTaxIdBlur}
              placeholder={cc.taxIdPlaceholder} maxLength={20} />
            {taxIdWarning && <small style={{ color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>⚠ {taxIdWarning}</small>}
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Drug Licence No.</label>
            <input type="text" className="form-input" value={form.licence || ''} onChange={e => setForm(prev => ({ ...prev, licence: e.target.value }))} placeholder="e.g. 20B/21B…" />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="client@example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input type="tel" className="form-input" value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+91 98765 43210" />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.isSEZ}
                onChange={e => setForm(prev => ({ ...prev, isSEZ: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
              <span><strong>SEZ unit / Developer</strong> — supplies will be charged IGST regardless of state (Section 16, IGST Act).</span>
            </label>
          </div>

          <div className="form-group" style={{ gridColumn: 'span 2', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
              Invoice preferences (optional)
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
              Auto-applied when you create a new invoice for this client. Leave blank to use app-wide defaults.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>Preferred invoice layout</label>
                <select className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredLayoutFormat}
                  onChange={e => setForm(prev => ({ ...prev, preferredLayoutFormat: e.target.value }))}>
                  <option value="">Use app default (Pharma)</option>
                  <option value="pharma">💊 Pharma — Batch, Expiry, OMRP</option>
                  <option value="diagnostic">🧪 Diagnostic — PKG column</option>
                  <option value="mixed">🔀 Both — syringes + kits on same invoice</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>Preferred paper size</label>
                <select className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredPaperSize}
                  onChange={e => setForm(prev => ({ ...prev, preferredPaperSize: e.target.value }))}>
                  <option value="">Use app default</option>
                  {Object.entries(PAPER_SIZES).map(([key, ps]) => (
                    <option key={key} value={key}>{ps.label}</option>
                  ))}
                </select>
              </div>
              <label style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.2rem' }}>
                <input type="checkbox" checked={!!form.autoPrint}
                  onChange={e => setForm(prev => ({ ...prev, autoPrint: e.target.checked }))}
                  style={{ width: 15, height: 15, accentColor: 'var(--primary)' }} />
                <span><strong>Auto-print on save for this client</strong> — overrides global setting</span>
              </label>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>{isEditing ? 'Update Client' : 'Save Client'}</button>
        </div>
      </div>
    </div>
  );
}