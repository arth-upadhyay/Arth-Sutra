import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ArrowLeft, Plus, Trash2, Download, UserPlus, Pencil, Settings, ChevronUp, ChevronDown, MessageCircle, Check, Loader, Truck, Printer } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// --- Co-located Custom Hooks (In same directory: ./hooks/) ---
import useInvoiceForm from './hooks/useInvoiceForm';
import useInvoiceTotals from './hooks/useInvoiceTotals';
import useInvoicePersistence from './hooks/useInvoicePersistence';
import useClientSearch from './hooks/useClientSearch';
import useProductSearch from './hooks/useProductSearch';

// --- Utils & Store (Up 2 levels: ../../) ---
import { getAllProfiles } from '../../store';
import { INVOICE_TYPES, generateEWayBillJSON, formatCurrency, getCountryConfig, getStatesForCountry, getAllUnits, addCustomUnit, removeCustomUnit, getCountriesForRegion, TDS_SECTIONS, TCS_SECTIONS, TERMS_PRESETS, getActiveAccounts, getAccountById, filterUnitsByMode, PAPER_SIZES, getPaperSize } from '../../utils';
import { getPrintSettings, savePrintSettings } from '../../utils/printSettings';
import { openWhatsAppShare } from '../../utils/share';
import { suggestGstRate } from '../../utils/hsnRates';
import { ensureToken, findOrCreateFolder, uploadPDF } from '../../services/googleDrive';

// --- Sibling UI Components (Up 1 level: ../) ---
import { confirmAction, promptAction } from '../ConfirmModal';
import PrintPreviewModal from '../PrintPreviewModal';
import DOMPurify from 'dompurify';
import InvoicePreview from '../InvoicePreview';
import HelpButton from '../HelpButton';
import ClientModal from '../ClientModal';
import { toast } from '../Toast';

// ============================================================================
// Helper Components
// ============================================================================

function RichEditor({ value, onChange, placeholder, toolbar = false }) {
  const ref = useRef(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (ref.current && !isInitialized.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
      isInitialized.current = true;
    }
  }, []);

  useEffect(() => {
    if (ref.current && isInitialized.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const applyFormat = (cmd, val) => {
    if (ref.current) ref.current.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const btnClass = "px-2 py-1 text-xs rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors min-w-[28px]";

  return (
    <div className="w-full">
      {toolbar && (
        <div className="flex gap-1.5 flex-wrap mb-2 bg-slate-900/50 p-1.5 rounded-t-md border-b border-slate-700/50">
          <button type="button" onClick={() => applyFormat('bold')} title="Bold (Ctrl+B)" className={`${btnClass} font-bold`}>B</button>
          <button type="button" onClick={() => applyFormat('italic')} title="Italic (Ctrl+I)" className={`${btnClass} italic`}>I</button>
          <button type="button" onClick={() => applyFormat('underline')} title="Underline (Ctrl+U)" className={`${btnClass} underline`}>U</button>
          <div className="w-px bg-slate-700 mx-1" />
          <button type="button" onClick={() => applyFormat('insertUnorderedList')} title="Bullet list" className={btnClass}>• List</button>
          <button type="button" onClick={() => applyFormat('insertOrderedList')} title="Numbered list" className={btnClass}>1. List</button>
          <div className="w-px bg-slate-700 mx-1" />
          <button type="button" onClick={() => applyFormat('formatBlock', '<h4>')} title="Heading" className={`${btnClass} font-bold`}>H</button>
          <button type="button" onClick={() => applyFormat('formatBlock', '<p>')} title="Paragraph" className={btnClass}>¶</button>
          <button type="button" onClick={async () => {
            const url = await promptAction({
              title: 'Insert link', message: 'Paste the URL to link to.', placeholder: 'https://example.com', confirmLabel: 'Insert',
            });
            if (url) applyFormat('createLink', url);
          }} title="Insert link" className={btnClass}>🔗</button>
          <div className="w-px bg-slate-700 mx-1" />
          <button type="button" onClick={() => applyFormat('removeFormat')} title="Clear formatting" className={btnClass}>✕</button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="w-full min-h-[100px] bg-slate-900 border border-slate-700 rounded-b-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-slate-500"
      />
    </div>
  );
}

const ACCENT_PRESETS = [
  { color: '#1e40af', label: 'Blue' }, { color: '#7c3aed', label: 'Purple' }, { color: '#0f766e', label: 'Teal' },
  { color: '#be123c', label: 'Red' }, { color: '#c2410c', label: 'Orange' }, { color: '#15803d', label: 'Green' },
  { color: '#0369a1', label: 'Sky' }, { color: '#1e293b', label: 'Dark' },
];

const PDF_STYLES = [
  { id: 'classic', label: 'Classic', desc: 'Clean with top accent bar' },
  { id: 'modern', label: 'Modern', desc: 'Bold header with color block' },
  { id: 'minimal', label: 'Minimal', desc: 'Simple, borderless layout' },
];

// ---------------------------------------------------------------------------
// SuggestingInput — plain .li-* classes (no Tailwind dependency)
// ---------------------------------------------------------------------------
function SuggestingInput({ item, suggestions, onFieldChange, onSelectProduct, onSetProductSearch, currency }) {
  const [activeIdx, setActiveIdx] = useState(-1);
  useEffect(() => { setActiveIdx(-1); }, [item.name, suggestions.length]);

  const handleKey = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0) {
        e.preventDefault(); e.stopPropagation();
        const pick = suggestions[activeIdx] ?? suggestions[0];
        if (pick) onSelectProduct(item.id, pick);
      }
    }
    else if (e.key === 'Escape') onSetProductSearch({ itemId: null, query: '' });
  };

  return (
    <div className="li-suggest-anchor" style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        className="li-input"
        value={item.name}
        onChange={(e) => onFieldChange(item.id, 'name', e.target.value)}
        onBlur={() => setTimeout(() => onSetProductSearch({ itemId: null, query: '' }), 200)}
        onKeyDown={handleKey}
        autoComplete="off"
        placeholder="Item description..."
      />
      {suggestions.length > 0 && (
        <div className="li-suggestions" role="listbox">
          {suggestions.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`li-suggestion${i === activeIdx ? ' active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={() => onSelectProduct(item.id, p)}
            >
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{p.name}</span>
              <span className="meta" style={{ flexShrink: 0 }}>
                {p.hsn && `HSN: ${p.hsn}`}{p.hsn && p.rate ? ' · ' : ''}{p.rate ? formatCurrency(p.rate, currency || 'INR') : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LineItem — plain .li-* classes (no Tailwind dependency)
// ---------------------------------------------------------------------------
const LineItem = memo(function LineItem({
  item, invoiceOptions, taxInclusive, showGST, taxLabel, units, countryTaxRates, filterUnitsByMode, invoiceMode,
  currency, profileCountry, suggestions, onFieldChange, onSelectProduct, onSetProductSearch,
  onAddCustomUnit, onRemoveCustomUnit, onRemove, clampNonNeg, isLastRow, onAddRow,
}) {
  const handleRowKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || !isLastRow) return;
    const hasContent = (item.name && item.name.trim()) || Number(item.rate) > 0 || Number(item.quantity) > 0;
    if (!hasContent) return;
    e.preventDefault();
    onAddRow?.();
  };

  return (
    <div className="li-row" data-item-id={item.id} onKeyDown={handleRowKeyDown}>

      {/* Description */}
      <div className="li-field li-field--desc">
        <label className="li-label">Description</label>
        <SuggestingInput item={item} suggestions={suggestions} onFieldChange={onFieldChange} onSelectProduct={onSelectProduct} onSetProductSearch={onSetProductSearch} currency={currency} />
      </div>

      {/* Batch No. */}
      <div className="li-field li-field--lg">
        <label className="li-label">Batch No.</label>
        <input type="text" className="li-input" value={item.batch || ''} onChange={(e) => onFieldChange(item.id, 'batch', e.target.value)} />
      </div>

      {/* Exp */}
      <div className="li-field li-field--md">
        <label className="li-label">Exp (MM/YY)</label>
        <input type="text" className="li-input" value={item.expiry || ''} onChange={(e) => onFieldChange(item.id, 'expiry', e.target.value)} placeholder="12/25" />
      </div>

      {/* CMPR */}
      <div className="li-field li-field--md">
        <label className="li-label" title="Opening MRP">OMRP</label>
        <input type="number" min="0" step="any" className="li-input" value={item.omrp ?? 0} onChange={(e) => onFieldChange(item.id, 'omrp', clampNonNeg(e.target.value))} />
      </div>

      {/* MRP */}
      <div className="li-field li-field--md">
        <label className="li-label" title="Maximum Retail Price">MRP</label>
        <input type="number" min="0" step="any" className="li-input" value={item.mrp ?? 0} onChange={(e) => onFieldChange(item.id, 'mrp', clampNonNeg(e.target.value))} />
      </div>

      {/* HSN/SAC */}
      {invoiceOptions.showHSN && (
        <div className="li-field li-field--lg" style={{ position: 'relative' }}>
          <label className="li-label">HSN/SAC</label>
          <input
            type="text"
            className="li-input"
            value={item.hsn}
            onChange={(e) => {
              const val = e.target.value;
              onFieldChange(item.id, 'hsn', val);
              const suggested = suggestGstRate(val);
              if (suggested && (item.taxPercent === undefined || item.taxPercent === 18 || item.taxPercent === 0)) {
                onFieldChange(item.id, 'taxPercent', suggested.rate);
              }
            }}
          />
          {(() => {
            const s = suggestGstRate(item.hsn);
            if (!s || !item.hsn || String(item.hsn).length < 4) return null;
            return (
              <div className="li-hsn-hint">
                → {s.rate}% · {s.label}
              </div>
            );
          })()}
        </div>
      )}

      {/* Qty */}
      <div className="li-field li-field--xs">
        <label className="li-label">Qty</label>
        <input type="number" min="0" step="any" className="li-input" value={item.quantity} onChange={(e) => onFieldChange(item.id, 'quantity', clampNonNeg(e.target.value))} />
      </div>

      {/* Unit */}
      <div className="li-field li-field--md">
        <label className="li-label">Unit</label>
        <select
          className="li-input"
          value={item.unit || 'Nos'}
          onChange={(e) => {
            if (e.target.value === '__custom__') { onAddCustomUnit(item.id); return; }
            if (e.target.value.startsWith('__remove__::')) { onRemoveCustomUnit(e.target.value.replace('__remove__::', '')); return; }
            onFieldChange(item.id, 'unit', e.target.value);
          }}
        >
          {(() => {
            const visible = filterUnitsByMode(units, invoiceMode);
            const showCurrentExtra = item.unit && !visible.some(u => u.label === item.unit);
            return (
              <>
                {showCurrentExtra && <option value={item.unit}>{item.unit}</option>}
                {visible.map(u => <option key={u.label} value={u.label}>{u.label}{u.custom ? ' ★' : ''}</option>)}
              </>
            );
          })()}
          <option value="__custom__">＋ Add custom…</option>
          {units.filter(u => u.custom).map(u => <option key={`rm-${u.label}`} value={`__remove__::${u.label}`}>− Remove "{u.label}"</option>)}
        </select>
      </div>

      {/* Rate */}
      <div className="li-field li-field--md">
        <label className="li-label">Rate</label>
        <input type="number" min="0" step="any" className="li-input" value={item.rate} onChange={(e) => onFieldChange(item.id, 'rate', clampNonNeg(e.target.value))} />
      </div>

      {/* Discount */}
      {invoiceOptions.showDiscount && (
        <div className="li-field li-field--xl">
          <label className="li-label">Discount</label>
          <div className="li-discount-row">
            <input type="number" min="0" step="any" className="li-input" value={item.discount} onChange={(e) => onFieldChange(item.id, 'discount', clampNonNeg(e.target.value))} />
            <select className="li-input" value={item.discountType === 'percent' ? 'percent' : 'fixed'} onChange={(e) => onFieldChange(item.id, 'discountType', e.target.value)}>
              <option value="fixed">₹</option>
              <option value="percent">%</option>
            </select>
            {item.discountType !== 'percent' && (
              <select className="li-input li-base" value={item.discountBase || 'net'} onChange={(e) => onFieldChange(item.id, 'discountBase', e.target.value)}>
                <option value="net">Net</option>
                <option value="unit">Unit</option>
                <option value="with-tax">W/Tax</option>
              </select>
            )}
          </div>
        </div>
      )}

      {/* GST % */}
      {showGST && (
        <div className="li-field li-field--sm">
          <label className="li-label">{taxLabel} %</label>
          <select
            className="li-input"
            value={countryTaxRates.includes(Number(item.taxPercent)) ? String(item.taxPercent) : '__custom__'}
            onChange={async (e) => {
              if (e.target.value === '__custom__') {
                const raw = await promptAction({ title: `Custom ${taxLabel} rate`, message: 'Enter a rate between 0% and 100%.', defaultValue: String(item.taxPercent || 0), inputType: 'number', confirmLabel: 'Apply rate' });
                if (raw === null) return;
                const n = parseFloat(raw);
                if (!isFinite(n) || n < 0 || n > 100) { toast('Tax rate must be between 0 and 100', 'warning'); return; }
                onFieldChange(item.id, 'taxPercent', n);
              } else {
                onFieldChange(item.id, 'taxPercent', parseFloat(e.target.value) || 0);
              }
            }}
          >
            {countryTaxRates.map(r => <option key={r} value={String(r)}>{r}%</option>)}
            <option value="__custom__">{countryTaxRates.includes(Number(item.taxPercent)) ? 'Custom…' : `${item.taxPercent}% (custom)`}</option>
          </select>
        </div>
      )}

      {/* Cess % */}
      {showGST && invoiceOptions.showCess && (profileCountry || 'India') === 'India' && (
        <div className="li-field li-field--xs">
          <label className="li-label" title="GST Compensation Cess">Cess %</label>
          <input type="number" min="0" max="500" step="any" className="li-input" value={item.cessPercent || 0} onChange={(e) => onFieldChange(item.id, 'cessPercent', clampNonNeg(e.target.value))} />
        </div>
      )}

      {/* Delete */}
      <div className="li-field li-field--del">
        <button className="li-del-btn" onClick={() => onRemove(item.id)} title="Remove Item">
          <Trash2 size={18} />
        </button>
      </div>

      {/* Item description sub-row */}
      <div className="li-desc-block">
        {item.description || item._descOpen ? (
          <textarea
            className="li-input li-textarea"
            placeholder="Additional description or notes for this item (optional)..."
            value={item.description || ''}
            onChange={(e) => onFieldChange(item.id, 'description', e.target.value)}
          />
        ) : (
          <button type="button" className="li-desc-toggle" onClick={() => onFieldChange(item.id, '_descOpen', true)}>
            <Plus size={12} /> Add description
          </button>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// MAIN GENERATOR COMPONENT
// ============================================================================

export default function InvoiceGenerator({ onBack, profile: profileProp, editingBill }) {
  const [allProfiles, setAllProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(profileProp);
  const profile = activeProfile || profileProp;

  // --- HOOK INTEGRATION ---
  const form = useInvoiceForm({ editingBill, profile });

  const totalsCalc = useInvoiceTotals({
    items: form.items,
    profile,
    client: form.client,
    details: form.details,
    showGST: form.showGST,
    taxInclusive: form.taxInclusive,
    invoiceOptions: form.invoiceOptions,
    setInvoiceOptions: form.setInvoiceOptions,
  });

  const products = useProductSearch({
    updateItem: form.updateItem,
    countryTaxRates: form.countryTaxRates,
    editingBill,
  });

  const clients = useClientSearch({
    clientName: form.client.name,
    editingBill,
    onSelect: (shape) => form.setClient(shape),
    onApplyPreferences: (cli) => form.setInvoiceOptions(prev => ({
      ...prev,
      paperSize: cli.preferredPaperSize || prev.paperSize || 'a4',
      currency: cli.preferredCurrency || prev.currency || 'INR',
      clientAutoPrint: !!cli.autoPrint,
    })),
  });

  const persistence = useInvoicePersistence({
    form,
    totals: totalsCalc.totals,
    profile,
    editingBill,
    syncStock: products.syncStock,
    clientSearch: clients,
  });

  // --- LOCAL UI STATE ---
  const previewPaneRef = useRef(null);
  const printRef = useRef(null);
  const [previewZoom, setPreviewZoom] = useState(() => {
    try { return Number(getPrintSettings().previewZoom) || 100; } catch { return 100; }
  });
  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    try { return localStorage.getItem('fgsb_previewCollapsed') === '1'; } catch { return false; }
  });
  const [showOptions, setShowOptions] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [units, setUnits] = useState(getAllUnits());

  const clientCountry = form.client.country || profile?.country || 'India';
  const clientCountryConfig = getCountryConfig(clientCountry);
  const stateOptions = (typeof getStatesForCountry === 'function')
    ? (getStatesForCountry(clientCountry) || [])
    : (clientCountryConfig.states || []);

  const allCountries = (typeof getCountriesForRegion === 'function')
    ? getCountriesForRegion()
    : [];

  useEffect(() => {
    const refetchProfiles = () => getAllProfiles().then(setAllProfiles).catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') refetchProfiles(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refetchProfiles);
    refetchProfiles();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refetchProfiles);
    };
  }, []);

  useEffect(() => {
    try {
      const s = getPrintSettings();
      if (Number(s.previewZoom) !== previewZoom) savePrintSettings({ ...s, previewZoom });
    } catch {}
  }, [previewZoom]);

  useEffect(() => {
    try { localStorage.setItem('fgsb_previewCollapsed', previewCollapsed ? '1' : '0'); } catch {}
  }, [previewCollapsed]);

  const handleFitToWidth = useCallback(() => {
    if (!previewPaneRef.current) { setPreviewZoom(100); return; }
    const pane = previewPaneRef.current;
    const scaler = pane.querySelector('.preview-scaler');
    const preview = scaler?.querySelector('.invoice-preview-container');
    const paneWidth = pane.clientWidth - 16;
    const naturalWidth = preview?.offsetWidth || 794;
    if (!(paneWidth > 0 && naturalWidth > 0)) { setPreviewZoom(100); return; }
    const ratio = paneWidth / naturalWidth;
    const nextZoom = Math.max(50, Math.min(200, Math.round(ratio * 100)));
    setPreviewZoom(nextZoom);
  }, []);

  const handleItemChange = useCallback((id, field, value) => {
    form.updateItem(id, field, value);
    if (field === 'name') products.onNameTyped(id, value);
  }, [form, products]);

  const handleAddCustomUnit = useCallback(async (itemId) => {
    const label = await promptAction({ title: 'Add custom unit', message: 'Enter a short unit label.', placeholder: 'e.g. Carat', confirmLabel: 'Add unit' });
    if (!label) return;
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 20) return;
    addCustomUnit(trimmed);
    setUnits(getAllUnits());
    handleItemChange(itemId, 'unit', trimmed);
  }, [handleItemChange]);

  const handleRemoveCustomUnit = useCallback(async (label) => {
    if (!await confirmAction({ title: `Remove unit "${label}"?`, message: 'Existing invoices keep this label unchanged.', confirmLabel: 'Remove unit', tone: 'danger' })) return;
    removeCustomUnit(label);
    setUnits(getAllUnits());
  }, []);

  const handleSave = useCallback(async () => {
    const { valid, errors, warnings } = form.validate({ totals: totalsCalc.totals });
    warnings.forEach(w => toast(w.message, 'warning'));
    if (!valid) { errors.forEach(e => toast(e.message, 'error')); return; }
    try {
      persistence.setSaving(true);
      await persistence.saveInvoice(false);
      toast('Invoice saved', 'success');
      form.clearDraft();
    } catch (err) {
      if (err?.status !== 409) toast('Save failed — try again', 'error');
    } finally {
      persistence.setSaving(false);
    }
  }, [form, totalsCalc.totals, persistence]);

  const handleBack = () => {
    if (form.isMeaningfulInvoice() && form.isDirty.current) { setLeaveModal(true); return; }
    form.clearDraft();
    onBack();
  };

  const leaveActions = {
    saveAndExit: async () => {
      try {
        persistence.setSaving(true);
        await persistence.saveInvoice(false);
        toast('Invoice saved', 'success');
        form.clearDraft();
        setLeaveModal(false);
        onBack();
      } catch { toast('Save failed', 'error'); }
      finally { persistence.setSaving(false); }
    },
    discardAndExit: () => { form.clearDraft(); setLeaveModal(false); onBack(); },
    cancel: () => setLeaveModal(false),
  };

  useEffect(() => {
    const handler = (e) => {
      if (form.isMeaningfulInvoice() && form.isDirty.current) { e.preventDefault(); e.returnValue = ''; return ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [form]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && leaveModal) { e.preventDefault(); setLeaveModal(false); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 's' || e.key === 'S') {
        if (!form.isMeaningfulInvoice()) return;
        e.preventDefault(); handleSave();
      } else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setTimeout(() => generatePDF(), 0); }
      else if (e.key === 'Enter') { e.preventDefault(); form.addItem(); }
      else if (e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); form.duplicateLastItem(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, leaveModal, handleSave]);

  // --- PRINT & PDF LOGIC ---
  const uploadToGoogleDrive = async (pdfBlob, fileName) => {
    try {
      const clientId = profile?.googleClientId;
      const folderName = profile?.googleDriveFolder || 'GST Billing Invoices';
      if (!clientId) return;
      const hasToken = await ensureToken(clientId);
      if (!hasToken) { toast('Google Drive: Please reconnect in Settings', 'warning'); return; }
      const folderId = await findOrCreateFolder(folderName);
      await uploadPDF(fileName, pdfBlob, folderId);
      toast(`Saved to Google Drive → ${folderName}`, 'success');
    } catch (err) { toast('Google Drive upload failed: ' + err.message, 'warning'); }
  };

  const buildPDF = async () => {
    const printSettings = getPrintSettings();
    const scalerEl = printRef.current.closest('.preview-scaler');
    if (scalerEl) scalerEl.style.transform = 'none';
    try { return await __buildPDFInner(printSettings); }
    finally { if (scalerEl) scalerEl.style.transform = ''; }
  };

  const __buildPDFInner = async (printSettings) => {
    const paperCfg = getPaperSize(form.invoiceOptions.paperSize, form.invoiceOptions);
    let pdf = new jsPDF({ orientation: paperCfg.jsPdfOrientation || 'portrait', unit: 'mm', format: paperCfg.jsPdfFormat, compress: true });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();
    const extraPages = printRef.current.querySelectorAll('[data-pdf-page]');
    const q = { scale: 3, imgFormat: 'JPEG', quality: 0.95 };
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }

    const captureOptions = (el) => ({
      scale: q.scale, useCORS: false, logging: false, letterRendering: true, backgroundColor: '#ffffff', imageTimeout: 15_000, width: el.scrollWidth, height: el.scrollHeight,
    });

    extraPages.forEach(el => el.style.display = 'none');
    const mainCanvas = await html2canvas(printRef.current, {
      ...captureOptions(printRef.current),
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; });
        const inv = clonedDoc.getElementById('invoice-preview');
        if (inv) {
          inv.style.width = `${paperCfg.widthMm}mm`; inv.style.overflow = 'visible'; inv.style.minHeight = 'unset'; inv.style.border = 'none'; inv.style.boxShadow = 'none'; inv.style.borderRadius = '0';
          if (printSettings.pdfDarkenOnPrint !== false) inv.classList.add('printing-mode');
        }
        clonedDoc.querySelectorAll('[data-pdf-page]').forEach(el => el.style.display = 'none');
      }
    });
    extraPages.forEach(el => el.style.display = '');

    const mTop = Math.max(0, Number(printSettings.marginTop) || 0);
    const mBottom = Math.max(0, Number(printSettings.marginBottom) || 0);
    const mLeft = Math.max(0, Number(printSettings.marginLeft) || 0);
    const mRight = Math.max(0, Number(printSettings.marginRight) || 0);
    const pdfScale = 1.0;
    const availWidth = Math.max(20, pdfWidth - mLeft - mRight);
    const availHeight = Math.max(20, pdfPageHeight - mTop - mBottom);
    const contentWidth = availWidth * pdfScale;
    const contentHeight = availHeight * pdfScale;
    const contentXOffset = mLeft + (availWidth - contentWidth) / 2;
    const contentYOffset = mTop;
    const scaledImgHeight = (mainCanvas.height * contentWidth) / mainCanvas.width;

    if (scaledImgHeight <= contentHeight + 2) {
      const mainImg = mainCanvas.toDataURL(q.imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', q.quality);
      const finalH = Math.min(scaledImgHeight, contentHeight);
      if (paperCfg.kind === 'thermal') {
        const thermalHeightMm = Math.max(30, Math.ceil(finalH + mTop + mBottom + 2));
        pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [paperCfg.widthMm, thermalHeightMm], compress: true });
      }
      pdf.addImage(mainImg, q.imgFormat, contentXOffset, contentYOffset, contentWidth, finalH, undefined, 'MEDIUM');
    } else {
       const tmp = document.createElement('canvas');
       tmp.width = mainCanvas.width; tmp.height = mainCanvas.height;
       const ctx = tmp.getContext('2d'); ctx.drawImage(mainCanvas, 0, 0);
       const mainImg = tmp.toDataURL(q.imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', q.quality);
       pdf.addImage(mainImg, q.imgFormat, contentXOffset, contentYOffset, contentWidth, scaledImgHeight, undefined, 'MEDIUM');
    }

    return pdf;
  };

  const printViaIframe = (blob) => {
    const url = URL.createObjectURL(blob);
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } };
    const timer = setTimeout(cleanup, 90_000);
    try {
      let frame = document.getElementById('fgsb-print-frame');
      if (!frame) {
        frame = document.createElement('iframe'); frame.id = 'fgsb-print-frame'; frame.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;'; document.body.appendChild(frame);
      }
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
        setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
      };
      frame.onerror = () => { clearTimeout(timer); cleanup(); };
    } catch (err) { clearTimeout(timer); cleanup(); throw err; }
  };

  const printThermalViaHtml = async () => {
    if (!printRef.current) return false;
    const receipt = printRef.current.querySelector('#invoice-preview') || printRef.current;
    if (!receipt) return false;
    const paperCfg = getPaperSize(form.invoiceOptions.paperSize, form.invoiceOptions);
    const doc = `<!DOCTYPE html><html><head><style>@page{size:${paperCfg.widthMm || 80}mm auto;margin:0;}html,body{margin:0;padding:0;background:#fff;color:#000;}#invoice-preview{margin:0!important;padding:0!important;border:none!important;box-shadow:none!important;min-height:0!important;}</style></head><body>${receipt.outerHTML}</body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;border:0;'; document.body.appendChild(iframe);
    try {
      await new Promise(r => { iframe.onload = r; iframe.srcdoc = doc; });
      iframe.contentWindow.focus(); iframe.contentWindow.print();
      setTimeout(() => { try { iframe.remove(); } catch {} }, 8000);
      return true;
    } catch { try { iframe.remove(); } catch {} return false; }
  };

  const isThermalPaper = () => getPaperSize(form.invoiceOptions.paperSize, form.invoiceOptions).kind === 'thermal';

  const withPreviewOnScreen = async (fn) => {
    if (!previewCollapsed) return fn();
    setPreviewCollapsed(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))));
    try { return await fn(); } finally { setPreviewCollapsed(true); }
  };

  const executePrint = async () => {
    if (!printRef.current) return;
    persistence.setSaving(true);
    try {
      await withPreviewOnScreen(async () => {
        if (isThermalPaper() && (getPrintSettings().thermalPrintMode || 'direct') === 'direct') {
          const ok = await printThermalViaHtml(); if (ok) return;
        }
        const pdf = await buildPDF();
        printViaIframe(pdf.output('blob'));
      });
    } catch { toast('Print failed — try Download PDF', 'error'); }
    finally { persistence.setSaving(false); }
  };

  const directPrint = async () => {
    if (!printRef.current) return;
    if (isThermalPaper()) { setShowPrintPreview(true); return; }
    await executePrint();
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    try {
      persistence.setSaving(true);
      const pdf = await withPreviewOnScreen(() => buildPDF());
      const fileName = `${form.typeConfig.prefix}_${form.details.invoiceNumber.replace(/\//g, '-')}.pdf`;
      pdf.save(fileName);

      await persistence.saveInvoice(false, { printedCount: (Number(editingBill?.printedCount) || 0) + 1, lastPrintedAt: new Date().toISOString() });
      form.clearDraft();

      const pdfBlob = pdf.output('blob');
      uploadToGoogleDrive(pdfBlob, fileName);
      if (getPrintSettings().autoPrintOnSave || form.invoiceOptions.clientAutoPrint) try { printViaIframe(pdfBlob); } catch {}
    } catch { toast('Failed to generate PDF.', 'error'); }
    finally { persistence.setSaving(false); }
  };

  const shareWhatsApp = () => {
    const cur = form.invoiceOptions.currency || 'INR';
    const lines = [
      `*Invoice: ${form.details.invoiceNumber}*`,
      `Date: ${form.details.invoiceDate ? new Date(form.details.invoiceDate).toLocaleDateString('en-IN') : ''}`,
      `Client: ${form.client?.name || ''}`,
      `Subtotal: ${formatCurrency(Number(totalsCalc.totals.subtotal) || 0, cur)}`,
      `*Total: ${formatCurrency(Number(totalsCalc.totals.total) || 0, cur)}*`,
    ];
    if (profile?.businessName) lines.push('', `— ${profile.businessName}`);
    openWhatsAppShare(form.client?.phone, lines.join('\n'));
  };

  const exportEWayBill = () => {
    try {
      if (!profile?.gstin) { toast('Set your Business GSTIN in Settings first', 'warning'); return; }
      if (!form.client?.state) { toast('Client State is required', 'warning'); return; }
      const ewb = generateEWayBillJSON(profile, form.client, form.details, form.items, totalsCalc.totals, form.invoiceType, { taxInclusive: form.taxInclusive });
      if (!ewb) { toast('Failed to format E-Way Bill', 'error'); return; }

      const blob = new Blob([JSON.stringify(ewb, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none'; a.href = url; a.download = `EWB-${form.details.invoiceNumber?.replace(/[\/\\]/g, '-') || 'draft'}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      toast('E-Way Bill JSON downloaded', 'success');
    } catch { toast('Failed to generate E-Way Bill.', 'error'); }
  };

  // --- TERMS PRESET HANDLERS ---
  const handleLoadBusinessPreset = useCallback((presetKey) => {
    if (!presetKey || presetKey === '') return;
    const preset = TERMS_PRESETS?.[presetKey];
    if (!preset) return;
    const html = Array.isArray(preset)
      ? `<ol>${preset.map(line => `<li>${line}</li>`).join('')}</ol>`
      : (typeof preset === 'string' ? preset : (preset.content || ''));
    form.setCustomTerms(html);
    form.setSelectedTermsId('');
  }, [form]);

  const handleLoadSavedTemplate = useCallback((templateId) => {
    if (!templateId) return;
    form.handleTermsSelect(templateId);
  }, [form]);

  const handleTermsFormat = useCallback((mode) => {
    form.setOption('termsFormatMode', mode);
  }, [form]);

  const termsFormatMode = form.invoiceOptions.termsFormatMode || 'compact';

  // --- RENDER ---
  return (
    <div className="generator-container">
      <div className="generator-toolbar">
        <div className="flex gap-2 items-center">
          <button className="btn btn-secondary" onClick={handleBack}><ArrowLeft size={18} /> Back</button>
          <HelpButton title="Invoice Generator — how to use">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Invoice type</strong> — Tax Invoice / Proforma / Bill of Supply etc.</li>
              <li><strong>Line items</strong> — type to auto-complete.</li>
              <li><strong>Auto-save</strong> — every 2s once meaningful.</li>
            </ul>
          </HelpButton>
          {(() => {
            const saving = persistence.autoSaveStatus === 'saving';
            const saved = persistence.autoSaveStatus === 'saved';
            const isDraft = persistence.autoSaveStatus === 'idle' && !form.isMeaningfulInvoice();
            const color = saving ? '#3b82f6' : saved ? '#059669' : isDraft ? '#d97706' : '#94a3b8';
            return (
              <button type="button" disabled={!isDraft}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, padding: '0.35rem 0.7rem', borderRadius: 999, background: `rgba(${color}, 0.12)`, border: `1px solid ${color}55`, color }}>
                {saving && <Loader size={12} className="spin" />}{saved && <Check size={12} />}
                {saving ? 'Saving…' : saved ? 'All changes saved' : isDraft ? 'Draft' : 'Ready'}
              </button>
            );
          })()}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={handleSave} disabled={persistence.saving}><Check size={18} /> Save</button>
          <button className="btn btn-secondary" onClick={generatePDF} disabled={persistence.saving}><Download size={18} /> Save & Download</button>
          <button className="btn btn-secondary" onClick={directPrint} disabled={persistence.saving}><Printer size={18} /> Print</button>
          <button className="btn btn-secondary" onClick={shareWhatsApp} disabled={persistence.saving} style={{ background: '#25d366', color: '#fff', borderColor: '#25d366' }}><MessageCircle size={18} /> WhatsApp</button>
          {(form.invoiceType === 'tax-invoice' || form.invoiceType === 'delivery-challan') && (
            <button className="btn btn-secondary" onClick={exportEWayBill}><Truck size={18} /> E-Way Bill</button>
          )}
        </div>
      </div>

      <div className={`split-view ${previewCollapsed ? 'split-view-focus' : ''}`}>
        <div className="editor-pane">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPreviewCollapsed(v => !v)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}>
              {previewCollapsed ? '◀ Show preview' : '▶ Focus mode'}
            </button>
          </div>

          {allProfiles.length > 1 && (
            <div className="glass-panel p-6 mb-6">
              <h3 className="section-title" style={{ marginBottom: '0.75rem' }}>Billing From</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                {allProfiles.map(bp => {
                  const isSelected = (activeProfile?.businessName || profileProp?.businessName) === bp.businessName;
                  return (
                    <button key={bp.id} type="button" onClick={() => setActiveProfile(bp)}
                      style={{ padding: '0.5rem 1rem', borderRadius: 8, fontSize: '0.85rem', border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)', background: isSelected ? 'rgba(59,130,246,0.08)' : 'var(--surface)', color: isSelected ? 'var(--primary)' : 'var(--text)', fontWeight: isSelected ? 700 : 400 }}>
                      {bp.businessName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="glass-panel p-6 mb-6">
            <div className="flex justify-between items-center">
              <h3 className="section-title" style={{ margin: 0 }}>Invoice Type</h3>
              <button type="button" className="btn btn-secondary" onClick={() => setShowOptions(!showOptions)}><Settings size={15} /> Customize</button>
            </div>
            <div className="type-selector" style={{ marginTop: '0.75rem' }}>
              {Object.entries(INVOICE_TYPES).map(([key, val]) => (
                <button key={key} className={`type-chip ${form.invoiceType === key ? 'type-chip-active' : ''}`} onClick={() => form.handleTypeChange(key)}>{val.label}</button>
              ))}
            </div>

            <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: 4 }}>This invoice is for</span>
              {[['goods', '🛒 Goods'], ['service', '🛠 Service'], ['mixed', '🔀 Mixed']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`type-chip ${form.invoiceOptions.invoiceMode === val ? 'type-chip-active' : ''}`}
                  onClick={() => form.setOption('invoiceMode', val)}
                >
                  {label}
                </button>
              ))}
            </div>

            {showOptions && (
              <div className="invoice-options">
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Invoice Title</label>
                  <input type="text" className="form-input" value={form.invoiceOptions.customTitle} onChange={(e) => form.setInvoiceOptions(prev => ({ ...prev, customTitle: e.target.value }))} placeholder={form.typeConfig?.title} />
                </div>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={form.invoiceOptions.currency} onChange={(e) => form.setInvoiceOptions(prev => ({ ...prev, currency: e.target.value }))}>
                    {Array.from(new Map(getCountriesForRegion().map(c => [c.currency, c])).values()).map(c => <option key={c.currency} value={c.currency}>{c.currency}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          <ClientModal show={clients.clientModal.open} onClose={clients.closeClientModal} onSave={clients.saveClientFromModal} client={clients.clientModal.client} isEditing={clients.clientModal.isEditing} defaultCountry={profile?.country} />

          <div className="glass-panel p-6 mb-6">
            <h3 className="section-title" style={{ margin: 0 }}>Billed To</h3>

            {!editingBill && persistence.clientCredit.available > 0.005 && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(3, 105, 161, 0.08)', border: '1px solid rgba(3, 105, 161, 0.3)', borderRadius: 8, fontSize: '0.85rem' }}>
                <strong style={{ color: '#0369a1' }}>💳 Client has {formatCurrency(persistence.clientCredit.available, form.invoiceOptions.currency || 'INR')} credit</strong>
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: 8 }}>
                  <input type="number" className="form-input" value={persistence.creditToApply || ''} onChange={e => persistence.setCreditToApply(Math.min(e.target.value, persistence.clientCredit.available))} style={{ width: 100 }} />
                  <button type="button" className="btn btn-secondary" onClick={() => persistence.setCreditToApply(persistence.clientCredit.available)}>Apply full</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="form-group full-width" style={{ position: 'relative' }}>
                <label className="form-label">Client Name</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input type="text" className="form-input" style={{ flex: 1 }} value={form.client.name} ref={clients.nameInputRef}
                    onChange={(e) => { form.setClient({ ...form.client, name: e.target.value }); clients.setShowSuggestions(true); }}
                    onFocus={() => { if (clients.savedClients.length > 0) clients.setShowSuggestions(true); }}
                    onKeyDown={clients.handleNameKeyDown} placeholder="Type client name to search or add new" autoComplete="off" />
                  <button type="button" className="btn btn-secondary" title="Add new client" onClick={() => clients.openAddClientModal(form.client)} style={{ padding: '0.65rem 0.85rem' }}>
                    <UserPlus size={16} />
                  </button>
                  {clients.selectedClientId && (
                    <button type="button" className="btn btn-secondary" title="Edit saved client" onClick={() => {
                      const found = clients.savedClients.find(c => c.id === clients.selectedClientId);
                      if (found) clients.openEditClientModal(found);
                    }} style={{ padding: '0.65rem 0.85rem' }}>
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
                {clients.showSuggestions && clients.savedClients.length > 0 && (
                  <div className="client-suggestions" ref={clients.suggestionsRef}>
                    {clients.filteredClients.map((cli, i) => (
                      <div key={cli.id} className="client-suggestion-row" style={i === clients.pickerIdx ? { background: 'rgba(30,64,175,0.12)' } : undefined}>
                        <button type="button" className="client-suggestion-item" onMouseEnter={() => clients.setPickerIdx(i)} onClick={() => clients.selectClient(cli)}>
                          <strong>{cli.name}</strong>
                          {cli.gstin && <span>GSTIN: {cli.gstin}</span>}
                        </button>
                        <button type="button" className="client-suggestion-edit" title="Edit this client" onClick={(e) => { e.stopPropagation(); clients.openEditClientModal(cli); }}>
                          <Pencil size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Drug Licence No. (Buyer)</label>
                <input type="text" className="form-input" value={form.client.licence || ''} onChange={(e) => form.setClient({ ...form.client, licence: e.target.value })} placeholder="e.g. 20B/21B…" />
              </div>

              <div className="form-group">
                <label className="form-label">Billing Address</label>
                <input type="text" className="form-input" value={form.client.address} onChange={(e) => form.setClient({ ...form.client, address: e.target.value })} placeholder="Street address, locality" />
              </div>

              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-input" value={clientCountry} onChange={(e) => form.setClient({ ...form.client, country: e.target.value, state: '' })}>
                  <option value="">— Select —</option>
                  {allCountries.map(c => <option key={c.name || c.code} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">City</label>
                <input type="text" className="form-input" value={form.client.city || ''} onChange={(e) => form.setClient({ ...form.client, city: e.target.value })} placeholder="e.g. Mumbai" />
              </div>

              <div className="form-group">
                <label className="form-label">PIN Code</label>
                <input type="text" className="form-input" value={form.client.pin || ''} onChange={(e) => form.setClient({ ...form.client, pin: e.target.value })} placeholder="Postal / PIN code" />
              </div>

              <div className="form-group">
                <label className="form-label">State</label>
                {stateOptions && stateOptions.length > 0 ? (
                  <select className="form-input" value={form.client.state || ''} onChange={(e) => form.setClient({ ...form.client, state: e.target.value })}>
                    <option value="">— Select —</option>
                    {stateOptions.map(s => {
                      const val = typeof s === 'string' ? s : (s.name || s.code);
                      return <option key={val} value={val}>{val}</option>;
                    })}
                  </select>
                ) : (
                  <input type="text" className="form-input" value={form.client.state || ''} onChange={(e) => form.setClient({ ...form.client, state: e.target.value })} placeholder="State" />
                )}
              </div>

              <div className="form-group">
                <label className="form-label">GSTIN</label>
                <input type="text" className="form-input" value={form.client.gstin} onChange={(e) => form.setClient({ ...form.client, gstin: e.target.value.toUpperCase() })} placeholder="Optional" />
              </div>
            </div>

            <label className="cbx-row" style={{ marginTop: '1rem' }}>
              <input type="checkbox" checked={!!form.details.shipToSameAsBilling} onChange={(e) => form.setDetails({ ...form.details, shipToSameAsBilling: e.target.checked })} />
              <span className="cbx-label">
                Ship to same as billing address
                <span className="cbx-hint">Uncheck to enter a different shipping address (uses Ship To block on the invoice)</span>
              </span>
            </label>

            {!form.details.shipToSameAsBilling && (
              <div className="grid grid-cols-2 gap-4" style={{ marginTop: '0.75rem' }}>
                <div className="form-group full-width">
                  <label className="form-label">Shipping Address</label>
                  <input type="text" className="form-input" value={form.details.shippingAddress || ''} onChange={(e) => form.setDetails({ ...form.details, shippingAddress: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Shipping City</label>
                  <input type="text" className="form-input" value={form.details.shippingCity || ''} onChange={(e) => form.setDetails({ ...form.details, shippingCity: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Shipping PIN</label>
                  <input type="text" className="form-input" value={form.details.shippingPin || ''} onChange={(e) => form.setDetails({ ...form.details, shippingPin: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Shipping State</label>
                  <input type="text" className="form-input" value={form.details.shippingState || ''} onChange={(e) => form.setDetails({ ...form.details, shippingState: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          <div className="glass-panel p-6 mb-6">
            <h3 className="section-title">Invoice Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Invoice Number</label>
                <input type="text" className="form-input" value={form.details.invoiceNumber} onChange={(e) => form.setDetails({ ...form.details, invoiceNumber: e.target.value })} />
              </div>

              <div className="form-group">
                <label className="form-label">Drug Licence No. (Seller)</label>
                <input type="text" className="form-input" value={form.details.sellerLicence || ''} onChange={(e) => form.setDetails({ ...form.details, sellerLicence: e.target.value })} placeholder="e.g. 20B/21B…" />
              </div>

              <div className="form-group">
                <label className="form-label">Invoice Date</label>
                <input type="date" className="form-input" value={form.details.invoiceDate} onChange={(e) => form.setDetails({ ...form.details, invoiceDate: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input type="date" className="form-input" value={form.details.dueDate} onChange={(e) => form.setDetails({ ...form.details, dueDate: e.target.value })} />
              </div>

              <div className="form-group">
                <label className="form-label">PO No.</label>
                <input type="text" className="form-input" value={form.details.poNumber || ''} onChange={(e) => form.setDetails({ ...form.details, poNumber: e.target.value })} placeholder="Purchase Order No." />
              </div>

              <div className="form-group">
                <label className="form-label">Place of Supply</label>
                <input type="text" className="form-input" value={form.details.placeOfSupply || ''} onChange={(e) => form.setDetails({ ...form.details, placeOfSupply: e.target.value })} placeholder="State / Region" />
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Line Items</h3>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.taxInclusive} onChange={(e) => form.setTaxInclusive(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                Prices include tax
              </label>
            </div>
            {form.items.map((item, idx) => (
              <LineItem key={item.id} item={item} invoiceOptions={form.invoiceOptions} taxInclusive={form.taxInclusive} showGST={form.showGST} taxLabel={form.taxLabel} units={units} countryTaxRates={form.countryTaxRates} filterUnitsByMode={filterUnitsByMode} invoiceMode={form.invoiceOptions.invoiceMode} currency={form.invoiceOptions.currency} profileCountry={profile?.country} suggestions={products.getSuggestions(item.id)} onFieldChange={handleItemChange} onSelectProduct={products.selectProduct} onSetProductSearch={products.setProductSearch} onAddCustomUnit={handleAddCustomUnit} onRemoveCustomUnit={handleRemoveCustomUnit} onRemove={form.removeItem} clampNonNeg={form.clampNonNeg} isLastRow={idx === form.items.length - 1} onAddRow={form.addItem} />
            ))}
            <button className="btn btn-secondary mt-2" onClick={form.addItem}><Plus size={18} /> Add Item</button>

            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Discount on total (whole bill):</span>
              <input
                type="number" min="0" step="any" className="form-input" style={{ width: 100 }}
                value={form.invoiceOptions.invoiceDiscountValue || 0}
                onChange={(e) => form.setInvoiceOptions(prev => ({ ...prev, invoiceDiscountValue: parseFloat(e.target.value) || 0 }))}
              />
              <select
                className="form-input" style={{ width: 80 }}
                value={form.invoiceOptions.invoiceDiscountType || 'fixed'}
                onChange={(e) => form.setInvoiceOptions(prev => ({ ...prev, invoiceDiscountType: e.target.value }))}
              >
                <option value="fixed">₹ (fix)</option>
                <option value="percent">% (%)</option>
              </select>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Applied after tax. For GST-compliant pre-tax discount, use per-line discount instead.
              </span>
            </div>
          </div>

          <div className="glass-panel p-6 mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Terms &amp; Conditions</h3>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                <span>P of layout</span>
                <button type="button" className={`btn ${termsFormatMode === 'compact' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }} onClick={() => handleTermsFormat('compact')}>Compact</button>
                <button type="button" className={`btn ${termsFormatMode === 'formatted' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }} onClick={() => handleTermsFormat('formatted')}>Formatted</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Insert preset (by business type)</label>
                <select className="form-input" value="" onChange={(e) => { handleLoadBusinessPreset(e.target.value); e.target.value = ''; }}>
                  <option value="">— Pick a business type —</option>
                  {Object.entries(TERMS_PRESETS || {}).map(([key, val]) => (
                    <option key={key} value={key}>{val.label || key}</option>
                  ))}
                </select>
                <span className="field-hint">Industry-specific default wording. Edit freely.</span>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Load saved template</label>
                <select className="form-input" value={form.selectedTermsId || ''} onChange={(e) => handleLoadSavedTemplate(e.target.value)}>
                  <option value="">— Choose a saved template —</option>
                  {form.termsTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="field-hint">Your saved templates from Settings → Terms.</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Terms (appears on invoice — supports rich formatting)</label>
              <RichEditor toolbar value={form.customTerms} onChange={(v) => { form.setCustomTerms(v); form.setSelectedTermsId(''); }} placeholder="Terms..." />
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label">Notes / Remarks (optional)</label>
              <RichEditor toolbar value={form.customNotes} onChange={(v) => form.setCustomNotes(v)} placeholder="Project details, special instructions, additional notes…" />
            </div>
          </div>

          <div className="glass-panel p-6 mb-6" style={{ background: 'rgba(253, 230, 138, 0.08)', borderColor: 'rgba(217, 119, 6, 0.35)' }}>
            <label className="form-label" style={{ color: '#b45309' }}>Private note (not shown on invoice)</label>
            <textarea
              className="form-input"
              style={{ background: 'rgba(255, 254, 245, 0.95)', color: '#1f2937', minHeight: 70 }}
              value={form.internalNote || ''}
              onChange={(e) => form.setInternalNote(e.target.value)}
              placeholder="e.g. Client asked for 15-day credit, follow up on 20th, referred by Ravi…"
            />
          </div>
        </div>

        {/* Live Preview */}
        <div ref={previewPaneRef} className="preview-pane" style={previewCollapsed ? { position: 'absolute', left: '-99999px', pointerEvents: 'none', opacity: 0 } : undefined}>
          <div className="preview-pane-label preview-toolbar">
            <span className="preview-toolbar-title">Live preview</span>
            <div className="preview-toolbar-controls">
              <div className="zoom-pill" role="group" aria-label="Preview zoom">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setPreviewZoom(z => Math.max(50, z - 10))}
                  title="Zoom out (छोटा करें)"
                  aria-label="Zoom out"
                >−</button>
                <button
                  type="button"
                  className="zoom-value"
                  onClick={() => setPreviewZoom(100)}
                  title="Reset to 100%"
                >{previewZoom}%</button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setPreviewZoom(z => Math.min(200, z + 10))}
                  title="Zoom in (बड़ा करें)"
                  aria-label="Zoom in"
                >+</button>
              </div>
              <button
                type="button"
                onClick={handleFitToWidth}
                className="zoom-fit-btn"
                title="Fit preview to pane width (चौड़ाई के अनुसार)"
              >Fit</button>
            </div>
          </div>
          <div className="preview-scaler" style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: 'top left' }}>
            <InvoicePreview ref={printRef} profile={profile} client={form.client} details={form.details} items={form.items} totals={totalsCalc.totals} invoiceType={form.invoiceType} customTerms={form.customTerms} customNotes={form.customNotes} extraSections={form.extraSections} options={form.invoiceOptions} />
          </div>
        </div>
      </div>

      <PrintPreviewModal isOpen={showPrintPreview} onClose={() => setShowPrintPreview(false)} onPrint={executePrint} onDownloadPdf={generatePDF} profile={profile} client={form.client} details={form.details} items={form.items} totals={totalsCalc.totals} invoiceType={form.invoiceType} customTerms={form.customTerms} customNotes={form.customNotes} extraSections={form.extraSections} invoiceOptions={form.invoiceOptions} />

      {leaveModal && (
        <div className="modal-overlay" onClick={leaveActions.cancel}>
          <div className="modal-content">
            <h3 style={{ marginTop: 0 }}>Unsaved changes</h3>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={leaveActions.cancel}>Keep editing</button>
              <button className="btn btn-secondary" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={leaveActions.discardAndExit}>Discard &amp; leave</button>
              <button className="btn btn-primary" onClick={leaveActions.saveAndExit}>Save &amp; leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}