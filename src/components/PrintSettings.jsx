import { useState, useEffect, useRef } from 'react';
import { Printer, RotateCcw, Info } from 'lucide-react';
import { toast } from './Toast';
import InvoicePreview from './InvoicePreview';
import TwoUpSheetPreview from './TwoUpSheetPreview';
import { getProfile, getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../store';
import { getPrintSettings, savePrintSettings, buildSampleInvoice, DEFAULT_PRINT_SETTINGS } from '../utils/printSettings';

const DISPLAY_OPTION_KEYS = ['showLogo', 'showHSN', 'showAmountWords', 'showBankDetails', 'showUPI'];

function syncDisplayOptionsFromPrint(next) {
  try {
    const raw = localStorage.getItem('arthsutra_invoiceOptions');
    const current = raw ? JSON.parse(raw) : {};
    const updated = { ...current };
    for (const k of DISPLAY_OPTION_KEYS) {
      if (next[k] !== undefined) updated[k] = !!next[k];
    }
    if (next.signatureShow !== undefined) updated.showSignature = !!next.signatureShow;
    localStorage.setItem('arthsutra_invoiceOptions', JSON.stringify(updated));
    saveInvoiceDisplayOptions(updated).catch(() => {});
  } catch { /* ignore */ }
}

export default function PrintSettings() {
  const [settings, setSettings] = useState(() => {
    const s = getPrintSettings();
    let opts = {};
    try {
      const raw = localStorage.getItem('arthsutra_invoiceOptions');
      if (raw) opts = JSON.parse(raw) || {};
    } catch { /* ignore */ }
    return {
      ...s,
      paperSize: 'a4',
      ...(opts.showLogo !== undefined ? { showLogo: !!opts.showLogo } : {}),
      ...(opts.showHSN !== undefined ? { showHSN: !!opts.showHSN } : {}),
      ...(opts.showAmountWords !== undefined ? { showAmountWords: !!opts.showAmountWords } : {}),
      ...(opts.showBankDetails !== undefined ? { showBankDetails: !!opts.showBankDetails } : {}),
      ...(opts.showUPI !== undefined ? { showUPI: !!opts.showUPI } : {}),
      ...(opts.showSignature !== undefined ? { signatureShow: !!opts.showSignature } : {}),
    };
  });
  const [profile, setProfile] = useState(null);
  const previewRef = useRef(null);

  useEffect(() => {
    getProfile().then(p => setProfile(p ? { ...p, country: 'India' } : null)).catch(() => {});
    if (!localStorage.getItem('arthsutra_invoiceOptions')) {
      getInvoiceDisplayOptions().then((opts) => {
        if (!opts || typeof opts !== 'object') return;
        setSettings((prev) => {
          const next = {
            ...prev,
            ...(opts.showLogo !== undefined ? { showLogo: !!opts.showLogo } : {}),
            ...(opts.showHSN !== undefined ? { showHSN: !!opts.showHSN } : {}),
            ...(opts.showAmountWords !== undefined ? { showAmountWords: !!opts.showAmountWords } : {}),
            ...(opts.showBankDetails !== undefined ? { showBankDetails: !!opts.showBankDetails } : {}),
            ...(opts.showUPI !== undefined ? { showUPI: !!opts.showUPI } : {}),
            ...(opts.showSignature !== undefined ? { signatureShow: !!opts.showSignature } : {}),
          };
          savePrintSettings(next);
          return next;
        });
      }).catch(() => {});
    }
  }, []);

  const set = (patch) => {
    const next = { ...settings, ...patch };
    savePrintSettings(next);
    setSettings(next);
    if (DISPLAY_OPTION_KEYS.some(k => k in patch) || 'signatureShow' in patch) {
      syncDisplayOptionsFromPrint(next);
    }
  };

  const reset = () => {
    const next = { ...DEFAULT_PRINT_SETTINGS, paperSize: 'a4' };
    savePrintSettings(next);
    setSettings(next);
    syncDisplayOptionsFromPrint(next);
    toast('Print settings reset to defaults', 'info');
  };

  const previewInvoiceOptions = {
    paperSize: 'a4',
    showGST: true,
    showBankDetails: settings.showBankDetails,
    showUPI: settings.showUPI,
    showAmountWords: settings.showAmountWords,
    showHSN: settings.showHSN,
    showLogo: settings.showLogo,
    showSignature: settings.signatureShow !== false,
    showTerms: false,
    showNotes: false,
  };

  const sample = buildSampleInvoice(profile);

  return (
    <div className="glass-panel p-6 mb-6">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>
            <Printer size={18} style={{ display: 'inline', verticalAlign: -3, marginRight: 6 }} />
            Invoice Layout
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            What appears on your printed and PDF invoices. Each invoice can override via its Customize panel.
          </p>
        </div>
        <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={reset}>
          <RotateCcw size={14} /> Reset defaults
        </button>
      </div>

      <div className="print-settings-layout" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 460px)',
        gap: '1.25rem',
        marginTop: '1.25rem',
        alignItems: 'flex-start',
      }}>
        <div className="print-settings-body" style={{ minWidth: 0 }}>

          <SettingGroup title="Content">
            <ToggleRow label="Show business logo" value={settings.showLogo} onChange={v => set({ showLogo: v })} />
            <ToggleRow label="Show HSN code per item" value={settings.showHSN} onChange={v => set({ showHSN: v })}
              hint="Required for GST compliance on tax invoices." />
            <ToggleRow label="Show amount in words" value={settings.showAmountWords} onChange={v => set({ showAmountWords: v })} />
            <ToggleRow label="Show bank details" value={settings.showBankDetails} onChange={v => set({ showBankDetails: v })} />
            <ToggleRow label="Show UPI QR code" value={settings.showUPI} onChange={v => set({ showUPI: v })} />
            {settings.showUPI && (
              <SelectRow label="UPI QR size" value={settings.qrSize} onChange={v => set({ qrSize: v })}
                options={[
                  ['small', 'Small (56 × 56 px)'],
                  ['medium', 'Medium (75 × 75 px)'],
                  ['large', 'Large (100 × 100 px)'],
                ]} />
            )}
          </SettingGroup>

          <div style={{ marginTop: '1.75rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
              📄 PDF &amp; universal print features
            </h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
              Every option below is dynamic — turn on / off any time.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

              <SettingGroup title="2 Bills Per Page (Client + Self Tear Sheet)">
                <ToggleRow
                  label="Print 2 bills per A4 page (top &amp; bottom)"
                  value={settings.twoPerPageEnabled !== false}
                  onChange={v => set({ twoPerPageEnabled: v })}
                  hint="Shrinks the exact invoice proportionally so two copies stack top and bottom on one A4 portrait sheet — tear across the middle for Client & Office copies."
                />
                {settings.twoPerPageEnabled !== false && (
                  <>
                    <ToggleRow
                      label="Show dashed tear line in center"
                      value={settings.twoPerPageShowCutLine !== false}
                      onChange={v => set({ twoPerPageShowCutLine: v })}
                    />
                    <ToggleRow
                      label='Show "CLIENT COPY" / "OFFICE / SELF COPY" labels'
                      value={settings.twoPerPageShowLabels !== false}
                      onChange={v => set({ twoPerPageShowLabels: v })}
                    />
                  </>
                )}
              </SettingGroup>

              <SettingGroup title="Auto-print">
                <ToggleRow label="Auto-print on save" value={settings.autoPrintOnSave} onChange={v => set({ autoPrintOnSave: v })}
                  hint="Send to your default printer immediately after Save & Download PDF." />
              </SettingGroup>

              <SettingGroup title="Watermark">
                <ToggleRow label="Show watermark" value={settings.watermarkEnabled} onChange={v => set({ watermarkEnabled: v })}
                  hint="Big diagonal stamp across the invoice (e.g. PAID / DUPLICATE / DRAFT)." />
                {settings.watermarkEnabled && (
                  <>
                    <ToggleRow label="Use custom text instead of preset" value={settings.watermarkUseCustomText}
                      onChange={v => set({ watermarkUseCustomText: v })} />
                    {settings.watermarkUseCustomText ? (
                      <TextRow label="Custom watermark text" value={settings.watermarkCustomText}
                        onChange={v => set({ watermarkCustomText: v })}
                        placeholder="e.g. FOR INTERNAL USE" />
                    ) : (
                      <SelectRow label="Watermark text" value={settings.watermarkText} onChange={v => set({ watermarkText: v })}
                        options={[
                          ['PAID', 'PAID'], ['DUPLICATE', 'DUPLICATE'], ['DRAFT', 'DRAFT'],
                          ['OVERDUE', 'OVERDUE'], ['COPY', 'COPY'], ['ORIGINAL', 'ORIGINAL'],
                          ['CANCELLED', 'CANCELLED'], ['REPRINT', 'REPRINT'],
                        ]} />
                    )}
                    <SelectRow label="Opacity" value={String(settings.watermarkOpacity)} onChange={v => set({ watermarkOpacity: parseInt(v, 10) })}
                      options={[['5', 'Very faint (5%)'], ['10', 'Faint (10%)'], ['15', 'Medium (15%)'], ['25', 'Strong (25%)'], ['40', 'Very strong (40%)']]} />
                  </>
                )}
              </SettingGroup>

              <SettingGroup title="Multi-copy (GST rule 48)">
                <ToggleRow label="Print multiple copies with labels" value={settings.multiCopyEnabled} onChange={v => set({ multiCopyEnabled: v })}
                  hint="Applies to 1-bill-per-page PDFs — prints N labeled copies (ORIGINAL FOR RECIPIENT / DUPLICATE FOR TRANSPORTER / TRIPLICATE FOR SUPPLIER)." />
                {settings.multiCopyEnabled && (
                  <SelectRow label="Number of copies" value={String(settings.multiCopyCount)} onChange={v => set({ multiCopyCount: parseInt(v, 10) })}
                    options={[['2', '2 (Original + Duplicate — services)'], ['3', '3 (Original + Duplicate + Triplicate — goods)']]} />
                )}
              </SettingGroup>

              <SettingGroup title="Multi-page invoices">
                <ToggleRow label="Page numbers on multi-page PDFs" value={settings.pageNumbersEnabled} onChange={v => set({ pageNumbersEnabled: v })}
                  hint='Shows "Page 2 of N" bottom-right on multi-page 1-up PDFs.' />
                <ToggleRow label="Business name header on pages 2+" value={settings.pageHeaderEnabled} onChange={v => set({ pageHeaderEnabled: v })}
                  hint="Repeats your business name at the top of continuation pages on multi-page PDFs." />
              </SettingGroup>

              <SettingGroup title="Print margins (mm)">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  <NumInput label="Top" value={settings.marginTop} onChange={v => set({ marginTop: v })} />
                  <NumInput label="Bottom" value={settings.marginBottom} onChange={v => set({ marginBottom: v })} />
                  <NumInput label="Left" value={settings.marginLeft} onChange={v => set({ marginLeft: v })} />
                  <NumInput label="Right" value={settings.marginRight} onChange={v => set({ marginRight: v })} />
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  For pre-printed letterhead — shift content down to avoid your logo, or in from the edge to fit binding.
                </p>
              </SettingGroup>

              <SettingGroup title="Digital signature">
                <ToggleRow label="Show signature on invoice" value={settings.signatureShow} onChange={v => set({ signatureShow: v })} />
                {settings.signatureShow && (
                  <>
                    {settings.signatureImage ? (
                      <>
                        <div style={{ padding: '0.5rem', background: '#fff', borderRadius: 4, textAlign: 'center', marginBottom: '0.4rem' }}>
                          <img src={settings.signatureImage} alt="signature" style={{ maxHeight: 60, maxWidth: '100%' }} />
                        </div>
                        <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                          onClick={() => set({ signatureImage: '' })}>
                          Remove signature
                        </button>
                      </>
                    ) : (
                      <>
                        <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: 3 }}>Fallback signature image (PNG / JPG)</label>
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) { toast('Image too large (max 2MB)', 'warning'); return; }
                            const reader = new FileReader();
                            reader.onload = (ev) => set({ signatureImage: ev.target.result });
                            reader.readAsDataURL(file);
                          }}
                          style={{ fontSize: '0.78rem' }} />
                      </>
                    )}
                    <TextRow label="Signatory label" value={settings.signatureName} onChange={v => set({ signatureName: v })}
                      placeholder="e.g. Rakesh Kumar · Director"
                      hint='Falls back to "Authorized Signatory" if left blank.' />
                  </>
                )}
              </SettingGroup>

            </div>
          </div>

        </div>

        <div className="print-settings-preview-pane" style={{
          position: 'sticky', top: '1rem',
          maxHeight: 'calc(100vh - 2rem)',
          padding: '1rem',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: '0.9rem' }}>
              <Info size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 5 }} />
              Live preview
            </strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {settings.twoPerPageEnabled !== false ? 'A4 Tear Sheet (Top & Bottom)' : 'A4 · updates as you type'}
            </span>
          </div>
          <div style={{ overflow: 'auto', flex: 1, background: '#fff', padding: '0.75rem', borderRadius: 6, minHeight: 200 }}>
            <div style={{ zoom: settings.twoPerPageEnabled !== false ? 0.48 : 0.5, minWidth: 0 }}>
              <TwoUpSheetPreview
                enabled={settings.twoPerPageEnabled !== false}
                showLabels={settings.twoPerPageShowLabels !== false}
                showCutLine={settings.twoPerPageShowCutLine !== false}
                leftLabel={settings.twoPerPageLeftLabel || 'CLIENT COPY'}
                rightLabel={settings.twoPerPageRightLabel || 'OFFICE / SELF COPY'}
                renderPrimary={() => (
                  <InvoicePreview
                    ref={previewRef}
                    previewOnly
                    profile={sample.profile}
                    client={sample.client}
                    details={sample.details}
                    items={sample.items}
                    totals={sample.totals}
                    invoiceType={sample.invoiceType}
                    options={previewInvoiceOptions}
                    customTerms=""
                    customNotes=""
                    extraSections={[]}
                  />
                )}
                renderSecondary={() => (
                  <InvoicePreview
                    previewOnly
                    profile={sample.profile}
                    client={sample.client}
                    details={sample.details}
                    items={sample.items}
                    totals={sample.totals}
                    invoiceType={sample.invoiceType}
                    options={previewInvoiceOptions}
                    customTerms=""
                    customNotes=""
                    extraSections={[]}
                  />
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingGroup({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange, hint }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}

function SelectRow({ label, value, onChange, options, hint }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 }}>{label}</label>
      <select className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
        value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

function NumInput({ label, value, onChange, min = 0, max = 100 }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 2 }}>{label}</label>
      <input type="number" min={min} max={max} step="0.5"
        value={value ?? 0}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="form-input" style={{ fontSize: '0.8rem', padding: '0.3rem 0.4rem', width: '100%' }} />
    </div>
  );
}

function TextRow({ label, value, onChange, hint, placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 }}>{label}</label>
      <input type="text" className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
        value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}