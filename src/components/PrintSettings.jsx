import { useState, useEffect, useRef } from 'react';
import { Printer, RotateCcw, Info } from 'lucide-react';
import { toast } from './Toast';
import { confirmAction } from './ConfirmModal';
import InvoicePreview from './InvoicePreview';
import { getProfile } from '../store';
import { getPrintSettings, savePrintSettings, buildSampleInvoice, DEFAULT_PRINT_SETTINGS } from '../utils/printSettings';

export default function PrintSettings() {
  const [settings, setSettings] = useState(() => {
    const s = getPrintSettings();
    return s.paperSize === 'a4' ? s : { ...s, paperSize: 'a4' };
  });
  const [profile, setProfile] = useState(null);
  const previewRef = useRef(null);

  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);

  const set = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrintSettings(next);
  };

  const reset = () => {
    setSettings({ ...DEFAULT_PRINT_SETTINGS, paperSize: 'a4' });
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, paperSize: 'a4' });
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
            <ToggleRow label='Show "Qty × Rate" line per item' value={settings.showRateLine} onChange={v => set({ showRateLine: v })} />
            <ToggleRow label="Show amount in words" value={settings.showAmountWords} onChange={v => set({ showAmountWords: v })} />
            <ToggleRow label="Show bank details" value={settings.showBankDetails} onChange={v => set({ showBankDetails: v })} />
            <ToggleRow label="Show UPI QR code" value={settings.showUPI} onChange={v => set({ showUPI: v })} />
            {settings.showUPI && (
              <SelectRow label="UPI QR size" value={settings.qrSize} onChange={v => set({ qrSize: v })}
                options={[
                  ['small', 'Small (60 × 60 px)'],
                  ['medium', 'Medium (90 × 90 px)'],
                  ['large', 'Large (120 × 120 px)'],
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

              <SettingGroup title="Auto-print">
                <ToggleRow label="Auto-print on save" value={settings.autoPrintOnSave} onChange={v => set({ autoPrintOnSave: v })}
                  hint="Send to your default printer immediately after Save & Download PDF." />
              </SettingGroup>

              <SettingGroup title="Watermark">
                <ToggleRow label="Show watermark" value={settings.watermarkEnabled} onChange={v => set({ watermarkEnabled: v })}
                  hint="Big diagonal stamp across the PDF (e.g. PAID / DUPLICATE / DRAFT)." />
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
                  hint="Prints the invoice N times with corner labels (ORIGINAL FOR RECIPIENT / DUPLICATE FOR TRANSPORTER / etc.). GST rule 48 requires 3 copies for goods, 2 for services." />
                {settings.multiCopyEnabled && (
                  <SelectRow label="Number of copies" value={String(settings.multiCopyCount)} onChange={v => set({ multiCopyCount: parseInt(v, 10) })}
                    options={[['2', '2 (Original + Duplicate — services)'], ['3', '3 (Original + Duplicate + Triplicate — goods)']]} />
                )}
              </SettingGroup>

              <SettingGroup title="Multi-page invoices">
                <ToggleRow label="Page numbers on every page" value={settings.pageNumbersEnabled} onChange={v => set({ pageNumbersEnabled: v })}
                  hint='Shows "Page 2 of 5" bottom-right on pages 2+.' />
                <ToggleRow label="Business name header on pages 2+" value={settings.pageHeaderEnabled} onChange={v => set({ pageHeaderEnabled: v })}
                  hint="Repeats your business name at the top so multi-page invoices look professional." />
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

              <SettingGroup title="Verification codes">
                <ToggleRow label="Invoice number as QR" value={settings.invoiceQrEnabled} onChange={v => set({ invoiceQrEnabled: v })}
                  hint="Prints a QR of the invoice number (or verification URL if set below) in the bottom-right corner." />
                {settings.invoiceQrEnabled && (
                  <TextRow label="Verification URL (optional)" value={settings.invoiceQrUrl} onChange={v => set({ invoiceQrUrl: v })}
                    placeholder="https://mycompany.com/verify/{invoice_number}"
                    hint="{invoice_number} gets replaced with the actual invoice #. Leave blank to encode just the number." />
                )}
                <ToggleRow label="Invoice number as barcode text" value={settings.invoiceBarcodeEnabled} onChange={v => set({ invoiceBarcodeEnabled: v })}
                  hint="Prints the invoice number in large monospace at the bottom-left for warehouse scanning / filing." />
              </SettingGroup>

              <SettingGroup title="Customer feedback QR">
                <ToggleRow label="Feedback / review QR" value={settings.feedbackQrEnabled} onChange={v => set({ feedbackQrEnabled: v })}
                  hint="Adds a QR at the bottom-left of the PDF that opens a URL — Google Reviews, feedback form, WhatsApp chat, anything you want." />
                {settings.feedbackQrEnabled && (
                  <>
                    <TextRow label="URL to encode" value={settings.feedbackQrUrl} onChange={v => set({ feedbackQrUrl: v })}
                      placeholder="e.g. https://g.page/r/YOUR_ID/review" />
                    <TextRow label="Label above QR" value={settings.feedbackQrLabel} onChange={v => set({ feedbackQrLabel: v })}
                      placeholder="Rate us · Give feedback" />
                  </>
                )}
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
                        <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: 3 }}>Upload signature (PNG / JPG)</label>
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
                    <TextRow label="Signatory name" value={settings.signatureName} onChange={v => set({ signatureName: v })}
                      placeholder="e.g. Rakesh Kumar · Director"
                      hint="Falls back to business name if left blank." />
                  </>
                )}
              </SettingGroup>

              <SettingGroup title="Terms &amp; Conditions">
                <ToggleRow label="Print T&amp;C on a separate page" value={settings.termsSeparatePage} onChange={v => set({ termsSeparatePage: v })}
                  hint="For long terms — puts them on page 2 instead of squishing on page 1. Only affects invoices with T&amp;C enabled." />
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
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>A4 · updates as you type</span>
          </div>
          <div style={{ overflow: 'auto', flex: 1, background: '#fff', padding: '0.75rem', borderRadius: 6, minHeight: 200 }}>
            <div style={{ zoom: 0.5, minWidth: 0 }}>
              <InvoicePreview
                ref={previewRef}
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