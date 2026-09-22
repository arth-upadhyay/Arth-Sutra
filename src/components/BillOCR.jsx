import { useState, useRef, useEffect } from 'react';
import { X, Upload, Loader, Wand2, Package, Sparkles, Trash2, Plus } from 'lucide-react';
import { toast } from './Toast';
import tesseractPkg from 'tesseract.js/package.json';
import { getAllProducts } from '../store';

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;

const DATE_RES = [
  /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/,
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})\b/i,
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const parseDateFrom = (text) => {
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (!m) continue;
    let y, mo, d;
    if (/^\d/.test(m[2])) {
      d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]);
    } else {
      d = Number(m[1]); mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]);
    }
    if (y < 100) y = 2000 + y;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) continue;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
};

const parseInvoiceNumber = (text) => {
  const m = text.match(/(?:invoice|bill|inv|voucher)\s*(?:no\.?|#|number)?\s*:?\s*([A-Za-z0-9/\-]{2,25})/i);
  return m ? m[1].trim() : '';
};

const parseSupplierName = (text) => {
  const gstinIdx = text.search(GSTIN_RE);
  const above = gstinIdx > 0 ? text.slice(0, gstinIdx) : text;
  const lines = above.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length < 4 || line.length > 80) continue;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) continue;
    const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (upper >= 0.5) return line;
  }
  return '';
};

const parseGrandTotal = (text) => {
  const patterns = [
    /grand\s*total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /(?:amount|amt)\s+payable[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /(?:invoice\s+)?total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /net\s+(?:amount|payable)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (isFinite(n) && n > 0) return n;
  }
  return 0;
};

const parseTaxBreakdown = (text) => {
  const out = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundOff: 0 };
  const num = (m) => {
    if (!m) return 0;
    const n = Number(m[m.length - 1].replace(/,/g, ''));
    return isFinite(n) && n >= 0 ? n : 0;
  };
  const patterns = {
    taxableValue: [
      /(?:taxable\s+(?:value|amount))[^0-9-]{0,15}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
      /(?:sub\s?total|subtotal)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    cgst: [
      /\bcgst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    sgst: [
      /\b(?:sgst|utgst)[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    igst: [
      /\bigst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    cess: [
      /\bcess[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    roundOff: [
      /(?:round\s*(?:off|ing))[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*(-?[\d,]+\.?\d*)/i,
    ],
  };
  for (const [key, list] of Object.entries(patterns)) {
    for (const re of list) {
      const m = text.match(re);
      if (m) { out[key] = num(m); break; }
    }
  }
  return out;
};

const LINE_ITEM_HSN_RE = /\b(\d{4,8})\b/;
const LINE_ITEM_NUM_RE = /\b(\d+(?:\.\d+)?)\b/g;
const LINE_ITEM_PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
const NON_ITEM_ANCHORS = /^(?:sub\s?total|subtotal|grand\s+total|total|net\s+(?:amount|payable)|amount\s+payable|cgst|sgst|utgst|igst|cess|round|balance|discount|freight|shipping|packing|handling|tds|tcs|advance|received|paid|dues?|hsn|desc|description|item\s*name|qty|rate|amount|s\.?\s*no|sno)\b/i;

const parseLineItems = (rawText) => {
  const lines = rawText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.length < 8 || line.length > 200) continue;
    if (NON_ITEM_ANCHORS.test(line)) continue;
    const nums = [...line.matchAll(LINE_ITEM_NUM_RE)].map(m => ({
      value: Number(m[1]),
      index: m.index,
    }));
    if (nums.length < 2) continue;
    const amount = nums[nums.length - 1].value;
    const rate = nums[nums.length - 2].value;
    if (!isFinite(amount) || amount <= 0) continue;
    if (!isFinite(rate) || rate <= 0) continue;
    const hsnMatch = line.match(LINE_ITEM_HSN_RE);
    let hsn = '';
    if (hsnMatch && Number(hsnMatch[1]) >= 1000) hsn = hsnMatch[1];
    const pctMatch = line.match(LINE_ITEM_PCT_RE);
    const taxPercent = pctMatch ? Number(pctMatch[1]) : 0;
    let quantity = 1;
    for (const n of nums) {
      if (n.value === rate || n.value === amount) continue;
      if (n.value > 0 && n.value < 10000 && Number.isInteger(n.value)) {
        quantity = n.value;
        break;
      }
    }
    const expectedAmount = quantity * rate;
    const ratio = expectedAmount > 0 ? Math.abs(expectedAmount - amount) / amount : 1;
    const firstNumIdx = nums[0].index;
    let name = line.slice(0, firstNumIdx).trim();
    name = name.replace(/^(?:item\s*)?\d+\s*[.)\-:]?\s*/i, '').trim();
    if (hsn) name = name.replace(new RegExp(`\\b${hsn}\\b`), '').trim();
    if (!name || !/[A-Za-z]{3,}/.test(name)) continue;
    if (name.length > 100) name = name.slice(0, 100);
    items.push({ name, hsn, quantity, rate, amount, taxPercent });
  }
  return items;
};

const tokenize = (s) => {
  if (!s) return new Set();
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3)
  );
};

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
};

const matchProduct = (extractedName, catalog) => {
  if (!catalog?.length) return null;
  const tokens = tokenize(extractedName);
  if (!tokens.size) return null;
  let best = null, bestScore = 0.5;
  for (const p of catalog) {
    const score = jaccard(tokens, tokenize(p.name));
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best ? { product: best, score: bestScore } : null;
};

const heuristicParseBill = (rawText, catalog = []) => {
  const text = rawText.replace(/[ \t]+/g, ' ');
  const gstinMatch = text.match(GSTIN_RE);
  const items = parseLineItems(rawText);
  const enrichedItems = items.map(it => {
    const match = matchProduct(it.name, catalog);
    if (match) {
      return {
        ...it,
        hsn: it.hsn || match.product.hsn || '',
        taxPercent: match.product.taxPercent ?? it.taxPercent,
        _matchedProductId: match.product.id,
        _matchScore: match.score,
        _matchedName: match.product.name,
      };
    }
    return it;
  });
  return {
    supplierGstin: gstinMatch ? gstinMatch[0] : '',
    supplierName: parseSupplierName(text),
    invoiceNumber: parseInvoiceNumber(text),
    date: parseDateFrom(text),
    grandTotal: parseGrandTotal(text),
    taxBreakdown: parseTaxBreakdown(text),
    items: enrichedItems,
    _rawText: rawText,
  };
};

export default function BillOCR({ onClose, onExtracted }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('idle'); 
  const [progress, setProgress] = useState(0);
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getAllProducts().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const pickFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast('Please upload an image (PNG, JPG, WebP).', 'warning');
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast('Image is over 8MB — please compress first (or take a smaller photo).', 'warning');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus('idle');
    setRawText('');
    setParsed(null);
    setProgress(0);
  };

  const runOCR = async () => {
    if (!file) return;
    setStatus('ocr');
    setProgress(0);
    let worker = null;
    try {
      const Tesseract = await import('tesseract.js');
      worker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/core',
        langPath: '/tesseract/lang',
        gzip: false,
        logger: (m) => {
          if (typeof m?.progress === 'number') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      worker = null;
      setRawText(data.text);
      const p = heuristicParseBill(data.text, catalog);
      setParsed(p);
      setStatus('done');
    } catch (err) {
      console.error('OCR failed:', err);
      let msg = '';
      if (typeof err === 'string') msg = err;
      else if (err && typeof err.message === 'string' && err.message) msg = err.message;
      else if (err && typeof err.data === 'string') msg = err.data;
      else if (err && err.data && typeof err.data.message === 'string') msg = err.data.message;
      else if (err) { try { msg = JSON.stringify(err); } catch { msg = 'Unknown error'; } }
      else msg = 'Unknown error';
      if (msg === 'undefined' || msg === '{}' || !msg.trim()) msg = 'Unknown error (see browser console — F12 — for details)';

      let hint = 'Try a sharper photo, or open the browser console (F12) for the full error.';
      if (/fetch|network|Failed to fetch|CDN|502|503|504/i.test(msg)) hint = 'Network fetch failed — OCR needs to download ~2MB of language data on first use. Check your connection and try again in a moment.';
      else if (/worker|SharedArrayBuffer|not defined/i.test(msg)) hint = 'Tesseract worker failed to load. Hard-refresh (Ctrl+F5) to fetch a clean bundle. If it keeps failing, the app may need HTTPS + COOP/COEP headers for tesseract v7.';
      else if (/blob|image|decode|corrupt|invalid/i.test(msg)) hint = 'Could not decode the image. Try a JPG or PNG under 8MB, taken with good lighting.';
      else if (/timeout|timed out/i.test(msg)) hint = 'OCR timed out. Image may be too large — try cropping to just the invoice header.';

      toast(`OCR failed: ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''} · ${hint}`, 'error', 12000);
      setStatus('error');
      if (worker) { try { await worker.terminate(); } catch { /* ignore */ } }
    }
  };

  const applyToForm = () => {
    if (!parsed) return;
    onExtracted({
      supplierName: parsed.supplierName,
      supplierGstin: parsed.supplierGstin,
      invoiceNumber: parsed.invoiceNumber,
      date: parsed.date,
      grandTotal: parsed.grandTotal,
      items: parsed.items || [],
      taxBreakdown: parsed.taxBreakdown || {},
    });
    onClose();
  };

  const updateItem = (idx, patch) => {
    setParsed(p => ({
      ...p,
      items: p.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }));
  };
  
  const removeItem = (idx) => {
    setParsed(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  };
  
  const addItem = () => {
    setParsed(p => ({
      ...p,
      items: [...(p.items || []), { name: '', hsn: '', quantity: 1, rate: 0, amount: 0, taxPercent: 18 }],
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 'min(1080px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wand2 size={18} /> Import from bill image (OCR)
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
          Upload a photo or scan of the supplier's invoice. We'll extract the
          <strong> GSTIN, invoice number, date, grand total, line items
          (name / HSN / quantity / rate / GST%), and the tax breakdown
          (CGST / SGST / IGST / cess)</strong>. Rows are cross-matched
          against your saved products — matched items get your stored
          HSN + tax rate auto-filled. Everything runs in your browser;
          nothing is uploaded to a server.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: previewUrl ? '1fr 1fr' : '1fr', gap: '1rem' }}>
          <div>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--border-color)', borderRadius: 8,
                padding: '1.25rem', textAlign: 'center', cursor: 'pointer',
                background: 'var(--bg-secondary)', minHeight: 120,
              }}>
              <Upload size={26} style={{ opacity: 0.6, marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                {file ? file.name : 'Click or drag a bill image here'}
              </p>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => pickFile(e.target.files?.[0])} />
            </div>
            {previewUrl && (
              <img src={previewUrl} alt="Bill preview"
                style={{ marginTop: 10, maxWidth: '100%', maxHeight: 300, border: '1px solid var(--border-color)', borderRadius: 4 }} />
            )}
            {file && status !== 'ocr' && (
              <button className="btn btn-primary" onClick={runOCR} style={{ marginTop: 10, width: '100%' }}>
                <Wand2 size={16} /> Extract fields
              </button>
            )}
            {status === 'ocr' && (
              <div style={{ marginTop: 10, textAlign: 'center', fontSize: '0.85rem' }}>
                <Loader size={16} className="spin" style={{ verticalAlign: '-3px', marginRight: 6 }} />
                Reading image… {progress}%
              </div>
            )}
          </div>

          {parsed && (
            <div style={{ background: 'var(--bg-secondary)', padding: '0.85rem', borderRadius: 6, maxHeight: 'calc(88vh - 100px)', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Extracted fields</h4>
              <FieldPreview label="Supplier" value={parsed.supplierName} onChange={v => setParsed(p => ({ ...p, supplierName: v }))} />
              <FieldPreview label="GSTIN" value={parsed.supplierGstin} onChange={v => setParsed(p => ({ ...p, supplierGstin: v }))} />
              <FieldPreview label="Invoice No." value={parsed.invoiceNumber} onChange={v => setParsed(p => ({ ...p, invoiceNumber: v }))} />
              <FieldPreview label="Date" value={parsed.date} onChange={v => setParsed(p => ({ ...p, date: v }))} type="date" />
              <FieldPreview label="Grand total" value={parsed.grandTotal || ''} onChange={v => setParsed(p => ({ ...p, grandTotal: Number(v) || 0 }))} type="number" />

              {parsed.taxBreakdown && (parsed.taxBreakdown.taxableValue || parsed.taxBreakdown.cgst || parsed.taxBreakdown.igst) > 0 && (
                <div style={{ marginTop: 10, padding: '0.55rem 0.7rem', background: 'var(--bg-primary)', borderRadius: 5, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Tax breakdown
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: '0.75rem' }}>
                    {parsed.taxBreakdown.taxableValue > 0 && <><span style={{ color: 'var(--text-muted)' }}>Taxable</span><span style={{ textAlign: 'right', fontWeight: 600 }}>₹{parsed.taxBreakdown.taxableValue.toFixed(2)}</span></>}
                    {parsed.taxBreakdown.cgst > 0 && <><span style={{ color: 'var(--text-muted)' }}>CGST</span><span style={{ textAlign: 'right' }}>₹{parsed.taxBreakdown.cgst.toFixed(2)}</span></>}
                    {parsed.taxBreakdown.sgst > 0 && <><span style={{ color: 'var(--text-muted)' }}>SGST / UTGST</span><span style={{ textAlign: 'right' }}>₹{parsed.taxBreakdown.sgst.toFixed(2)}</span></>}
                    {parsed.taxBreakdown.igst > 0 && <><span style={{ color: 'var(--text-muted)' }}>IGST</span><span style={{ textAlign: 'right' }}>₹{parsed.taxBreakdown.igst.toFixed(2)}</span></>}
                    {parsed.taxBreakdown.cess > 0 && <><span style={{ color: 'var(--text-muted)' }}>Cess</span><span style={{ textAlign: 'right' }}>₹{parsed.taxBreakdown.cess.toFixed(2)}</span></>}
                    {Math.abs(parsed.taxBreakdown.roundOff) > 0.005 && <><span style={{ color: 'var(--text-muted)' }}>Round-off</span><span style={{ textAlign: 'right' }}>{parsed.taxBreakdown.roundOff >= 0 ? '+' : ''}₹{parsed.taxBreakdown.roundOff.toFixed(2)}</span></>}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    <Package size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                    Line items ({parsed.items?.length || 0})
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={addItem}
                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>
                    <Plus size={11} /> Add row
                  </button>
                </div>
                {(!parsed.items || parsed.items.length === 0) ? (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: 4, textAlign: 'center' }}>
                    No line items detected. Add rows manually or use the OCR-total single-line fallback.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                    {parsed.items.map((it, idx) => (
                      <div key={idx} style={{ background: 'var(--bg-primary)', padding: '0.5rem 0.6rem', borderRadius: 4, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <input type="text" className="form-input" value={it.name || ''}
                            onChange={e => updateItem(idx, { name: e.target.value })}
                            placeholder="Product / description"
                            style={{ flex: 1, fontSize: '0.78rem', padding: '0.25rem 0.4rem' }} />
                          <button type="button" className="icon-btn icon-btn-red"
                            onClick={() => removeItem(idx)} title="Remove row" aria-label="Remove row"
                            style={{ width: 24, height: 24 }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {it._matchedProductId && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Sparkles size={10} /> Matched saved product: <em>{it._matchedName}</em> ({Math.round((it._matchScore || 0) * 100)}%)
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 1fr 0.8fr 1fr', gap: 5, fontSize: '0.72rem' }}>
                          <div>
                            <label style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' }}>HSN/SAC</label>
                            <input type="text" className="form-input" value={it.hsn || ''}
                              onChange={e => updateItem(idx, { hsn: e.target.value })}
                              placeholder="e.g. 4802"
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' }}>Qty</label>
                            <input type="number" step="any" className="form-input" value={it.quantity ?? ''}
                              onChange={e => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' }}>Rate ₹</label>
                            <input type="number" step="any" className="form-input" value={it.rate ?? ''}
                              onChange={e => updateItem(idx, { rate: Number(e.target.value) || 0 })}
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' }}>GST%</label>
                            <input type="number" step="any" className="form-input" value={it.taxPercent ?? ''}
                              onChange={e => updateItem(idx, { taxPercent: Number(e.target.value) || 0 })}
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' }}>Amount ₹</label>
                            <input type="number" step="any" className="form-input" value={it.amount ?? ''}
                              onChange={e => updateItem(idx, { amount: Number(e.target.value) || 0 })}
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <details style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <summary style={{ cursor: 'pointer' }}>Raw OCR text</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.7rem', maxHeight: 140, overflow: 'auto', marginTop: 4 }}>{rawText}</pre>
              </details>
              <button className="btn btn-primary" onClick={applyToForm} style={{ marginTop: 10, width: '100%' }}>
                Use these values ({parsed.items?.length || 0} line item{parsed.items?.length === 1 ? '' : 's'})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldPreview({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>{label}</label>
      <input type={type} className="form-input" value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} />
    </div>
  );
}