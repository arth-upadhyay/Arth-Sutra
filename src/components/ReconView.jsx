import { useState, useRef, useMemo } from 'react';
import {
  Upload,
  FileCheck,
  AlertTriangle,
  FileX,
  Clock,
  Download,
  Search,
  CheckCircle2,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatCurrency } from '../utils';
import { toast } from './Toast';

export default function ReconView() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reconResult, setReconResult] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'perfectMatch', 'mismatch', 'missingInOurBooks', 'missingInGstr2b'
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Drag and Drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (!droppedFile.name.endsWith('.json')) {
        toast('Please upload a valid JSON file exported from the GST portal', 'error');
        return;
      }
      setFile(droppedFile);
      processFile(droppedFile);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith('.json')) {
        toast('Please upload a valid JSON file exported from the GST portal', 'error');
        return;
      }
      setFile(selected);
      processFile(selected);
    }
  };

  const processFile = async (jsonFile) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', jsonFile);

      const res = await fetch('/api/recon/gstr2b', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to reconcile GSTR-2B');
      }

      setReconResult(data);
      toast(`Reconciled ${data.summary.totalPortalInvoices} portal invoices against ${data.summary.totalBookInvoices} purchases!`, 'success');
    } catch (err) {
      console.error('Reconciliation error:', err);
      toast(err.message || 'Reconciliation failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadSampleData = async () => {
    setLoading(true);
    try {
      const sampleGstr2b = {
        gstin: '27AABCT3518Q1ZV',
        fp: '102026',
        data: {
          docdata: {
            b2b: [
              {
                ctin: '27AABCU9603R1ZM',
                trdnm: 'Tata Electronics Private Limited',
                inv: [
                  {
                    inum: 'INV/2026/001',
                    dt: '12-10-2026',
                    val: 47200,
                    itcavl: 'Y',
                    items: [{ txval: 40000, igst: 7200, cgst: 0, sgst: 0, cess: 0 }],
                  },
                  {
                    inum: 'INV-2026-042',
                    dt: '15-10-2026',
                    val: 11800,
                    itcavl: 'Y',
                    items: [{ txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 }],
                  },
                ],
              },
              {
                ctin: '29AAACH7409R1ZX',
                trdnm: 'Infosys BPM Solutions',
                inv: [
                  {
                    inum: 'INF/9941',
                    dt: '18-10-2026',
                    val: 29500,
                    itcavl: 'Y',
                    items: [{ txval: 25000, igst: 4500, cgst: 0, sgst: 0, cess: 0 }],
                  },
                ],
              },
            ],
          },
        },
      };

      const res = await fetch('/api/recon/gstr2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleGstr2b),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to process sample');
      }

      setReconResult(data);
      setFile({ name: 'Demo_GSTR2B_102026.json', size: 1024 });
      toast('Demo GSTR-2B data loaded and reconciled!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const allItems = useMemo(() => {
    if (!reconResult) return [];
    const b = reconResult.buckets;
    return [
      ...(b.perfectMatch || []),
      ...(b.mismatch || []),
      ...(b.missingInOurBooks || []),
      ...(b.missingInGstr2b || []),
    ];
  }, [reconResult]);

  const filteredItems = useMemo(() => {
    if (!reconResult) return [];
    let list = [];
    if (activeTab === 'all') {
      list = allItems;
    } else {
      list = reconResult.buckets[activeTab] || [];
    }

    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase().trim();
    return list.filter((item) =>
      (item.supplierName && item.supplierName.toLowerCase().includes(q)) ||
      (item.supplierGstin && item.supplierGstin.toLowerCase().includes(q)) ||
      (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(q)) ||
      (item.bookInvoiceNumber && item.bookInvoiceNumber.toLowerCase().includes(q))
    );
  }, [reconResult, activeTab, searchQuery, allItems]);

  const exportCSV = () => {
    if (!reconResult || allItems.length === 0) return;

    const headers = [
      'Status',
      'Supplier Name',
      'Supplier GSTIN',
      'GSTR-2B Invoice #',
      'Books Invoice #',
      'Invoice Date',
      'Portal Taxable (₹)',
      'Books Taxable (₹)',
      'Portal Tax (₹)',
      'Books Tax (₹)',
      'Tax Difference (₹)',
      'Value Difference (₹)',
      'ITC Claimable',
    ];

    const escapeCsv = (val) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = allItems.map((item) => [
      escapeCsv(
        item.status === 'perfectMatch'
          ? 'Matched (ITC Safe)'
          : item.status === 'mismatch'
          ? 'Tax Mismatch'
          : item.status === 'missingInOurBooks'
          ? 'Missing in Books'
          : 'Missing in GSTR-2B'
      ),
      escapeCsv(item.supplierName),
      escapeCsv(item.supplierGstin),
      escapeCsv(item.invoiceNumber || ''),
      escapeCsv(item.bookInvoiceNumber || ''),
      escapeCsv(item.invoiceDate || ''),
      item.portalTaxable || 0,
      item.bookTaxable || 0,
      item.portalTax || 0,
      item.bookTax || 0,
      item.taxDifference || 0,
      item.valueDifference || 0,
      item.itcAvailable ? 'Yes' : 'No / Blocked',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `GSTR-2B_Reconciliation_${reconResult.summary?.period || 'Export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast('Reconciliation report exported as CSV', 'success');
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast(`Copied ${text}`, 'info', 1500);
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}>
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text, #111827)' }}>
                AI-Powered GST Reconciliation
              </h1>
              <p style={{ margin: '0.2rem 0 0', color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem' }}>
                Upload your GSTR-2B JSON to fuzzy-match against local purchases, audit ITC claims, and flag missing taxes.
              </p>
            </div>
          </div>
        </div>

        {reconResult && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={exportCSV}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid #10b981',
                background: '#ecfdf5',
                color: '#065f46',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <Download size={16} /> Export CSV
            </button>
            <button
              onClick={() => {
                setReconResult(null);
                setFile(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid var(--border, #e5e7eb)',
                background: 'var(--card-bg, #fff)',
                color: 'var(--text, #374151)',
                fontWeight: 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} /> Upload Another
            </button>
          </div>
        )}
      </div>

      {/* Upload Zone (Visible when no result loaded) */}
      {!reconResult && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, border: '1px solid var(--border, #e5e7eb)', padding: '2rem', marginBottom: '2rem' }}>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: isDragging ? '2px dashed #2563eb' : '2px dashed var(--border, #d1d5db)',
              background: isDragging ? '#eff6ff' : 'var(--bg-muted, #f9fafb)',
              borderRadius: 12,
              padding: '3rem 2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".json"
              style={{ display: 'none' }}
            />
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#e0e7ff',
              color: '#3b82f6',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}>
              <Upload size={28} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--text, #111827)' }}>
              {file ? file.name : 'Drag & drop GSTR-2B JSON file here'}
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', margin: '0 0 1.25rem' }}>
              Download monthly GSTR-2B JSON from the GST Portal and drop it here. Levenshtein fuzzy matching handles invoice typos automatically.
            </p>
            <div style={{ display: 'inline-flex', gap: '0.75rem', alignItems: 'center' }}>
              <span
                style={{
                  background: 'var(--primary, #1e40af)',
                  color: '#fff',
                  padding: '0.5rem 1.2rem',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: '0.875rem',
                }}
              >
                {loading ? 'Reconciling...' : 'Browse JSON File'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <HelpCircle size={16} />
              <span>Supports official GSTN portal GSTR-2B schema (B2B, CDNR, reverse charge).</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                loadSampleData();
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary, #2563eb)',
                textDecoration: 'underline',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Or load sample GSTR-2B data to try it out
            </button>
          </div>
        </div>
      )}

      {/* Reconciliation Results */}
      {reconResult && (
        <div>
          {/* Metadata banner */}
          <div style={{
            background: 'var(--bg-muted, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}>
            <div>
              <strong>Filing Period:</strong>{' '}
              <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                {reconResult.summary?.period}
              </span>
              {' '} | <strong>Filing GSTIN:</strong>{' '}
              <code>{reconResult.summary?.filingGstin}</code>
            </div>
            <div style={{ color: 'var(--text-muted, #64748b)' }}>
              Portal Invoices: <strong>{reconResult.summary?.totalPortalInvoices}</strong> | Local Purchase Records: <strong>{reconResult.summary?.totalBookInvoices}</strong>
            </div>
          </div>

          {/* 4 Summary Metric Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}>
            {/* Card 1: Eligible Claimable ITC */}
            <div style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: 10,
              padding: '1.2rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#065f46', letterSpacing: '0.5px' }}>
                  Eligible Claimable ITC
                </span>
                <FileCheck size={20} color="#059669" />
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#064e3b' }}>
                {formatCurrency(reconResult.summary?.totalEligibleClaimableITC || 0)}
              </div>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#047857' }}>
                Rule 36(4) compliant. Matches verified portal records.
              </p>
            </div>

            {/* Card 2: Mismatched Tax Difference */}
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 10,
              padding: '1.2rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#92400e', letterSpacing: '0.5px' }}>
                  Mismatched Tax
                </span>
                <AlertTriangle size={20} color="#d97706" />
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#78350f' }}>
                {formatCurrency(reconResult.summary?.totalMismatchedTaxDiff || 0)}
              </div>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#b45309' }}>
                {reconResult.summary?.mismatchCount || 0} invoice(s) with rate / calculation discrepancy &gt; ₹1.
              </p>
            </div>

            {/* Card 3: Unclaimed in Books ITC */}
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 10,
              padding: '1.2rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#991b1b', letterSpacing: '0.5px' }}>
                  Unclaimed in Books
                </span>
                <FileX size={20} color="#dc2626" />
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#7f1d1d' }}>
                {formatCurrency(reconResult.summary?.unclaimedInBooksITC || 0)}
              </div>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#b91c1c' }}>
                Filed on portal by vendor, but missing from your accounting records.
              </p>
            </div>

            {/* Card 4: Pending Supplier Filing */}
            <div style={{
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
              borderRadius: 10,
              padding: '1.2rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#5b21b6', letterSpacing: '0.5px' }}>
                  Pending Supplier Filing
                </span>
                <Clock size={20} color="#7c3aed" />
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4c1d95' }}>
                {formatCurrency(reconResult.summary?.pendingSupplierFilingTax || 0)}
              </div>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#6d28d9' }}>
                Recorded in your books, but vendor hasn't filed GSTR-1 yet.
              </p>
            </div>
          </div>

          {/* Filter Tabs & Search Bar */}
          <div style={{
            background: 'var(--card-bg, #fff)',
            borderRadius: 10,
            border: '1px solid var(--border, #e5e7eb)',
            padding: '1rem',
            marginBottom: '1rem',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setActiveTab('all')}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: activeTab === 'all' ? 'var(--primary, #1e40af)' : '#f1f5f9',
                    color: activeTab === 'all' ? '#fff' : '#475569',
                  }}
                >
                  All ({allItems.length})
                </button>

                <button
                  onClick={() => setActiveTab('perfectMatch')}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: activeTab === 'perfectMatch' ? '#059669' : '#ecfdf5',
                    color: activeTab === 'perfectMatch' ? '#fff' : '#065f46',
                  }}
                >
                  Matched ({reconResult.buckets.perfectMatch?.length || 0})
                </button>

                <button
                  onClick={() => setActiveTab('mismatch')}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: activeTab === 'mismatch' ? '#d97706' : '#fffbeb',
                    color: activeTab === 'mismatch' ? '#fff' : '#92400e',
                  }}
                >
                  Mismatches ({reconResult.buckets.mismatch?.length || 0})
                </button>

                <button
                  onClick={() => setActiveTab('missingInOurBooks')}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: activeTab === 'missingInOurBooks' ? '#dc2626' : '#fef2f2',
                    color: activeTab === 'missingInOurBooks' ? '#fff' : '#991b1b',
                  }}
                >
                  Missing in Books ({reconResult.buckets.missingInOurBooks?.length || 0})
                </button>

                <button
                  onClick={() => setActiveTab('missingInGstr2b')}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: activeTab === 'missingInGstr2b' ? '#7c3aed' : '#f5f3ff',
                    color: activeTab === 'missingInGstr2b' ? '#fff' : '#5b21b6',
                  }}
                >
                  Missing in 2B ({reconResult.buckets.missingInGstr2b?.length || 0})
                </button>
              </div>

              {/* Search */}
              <div style={{ position: 'relative', width: 280 }}>
                <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Filter supplier, invoice, GSTIN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.75rem 0.45rem 2.2rem',
                    borderRadius: 6,
                    border: '1px solid var(--border, #cbd5e1)',
                    fontSize: '0.85rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Reconciled Items Table */}
          <div style={{
            background: 'var(--card-bg, #fff)',
            borderRadius: 10,
            border: '1px solid var(--border, #e5e7eb)',
            overflowX: 'auto',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border, #e2e8f0)', color: '#475569', fontWeight: 600 }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Supplier / GSTIN</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Invoice Details</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Portal Taxable / Tax</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Books Taxable / Tax</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Tax Variance</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>ITC Claim</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted, #94a3b8)' }}>
                      No invoices found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => {
                    const isMatched = item.status === 'perfectMatch';
                    const isMismatch = item.status === 'mismatch';
                    const isMissingBooks = item.status === 'missingInOurBooks';
                    const isMissing2b = item.status === 'missingInGstr2b';

                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid var(--border, #f1f5f9)',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        {/* Status Badge */}
                        <td style={{ padding: '0.75rem 1rem', verticalAlign: 'top' }}>
                          {isMatched && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: '#ecfdf5',
                              color: '#065f46',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}>
                              <CheckCircle2 size={13} color="#10b981" /> Matched
                            </span>
                          )}
                          {isMismatch && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: '#fffbeb',
                              color: '#92400e',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}>
                              <AlertTriangle size={13} color="#f59e0b" /> Mismatch
                            </span>
                          )}
                          {isMissingBooks && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: '#fef2f2',
                              color: '#991b1b',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}>
                              <FileX size={13} color="#ef4444" /> In 2B Only
                            </span>
                          )}
                          {isMissing2b && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: '#f5f3ff',
                              color: '#5b21b6',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}>
                              <Clock size={13} color="#8b5cf6" /> In Books Only
                            </span>
                          )}
                        </td>

                        {/* Supplier Name & GSTIN */}
                        <td style={{ padding: '0.75rem 1rem', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                            {item.supplierName || 'Unknown Vendor'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <code style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>
                              {item.supplierGstin || '—'}
                            </code>
                            {item.supplierGstin && (
                              <button
                                onClick={() => copyToClipboard(item.supplierGstin)}
                                title="Copy GSTIN"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#94a3b8' }}
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Invoice Details */}
                        <td style={{ padding: '0.75rem 1rem', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {item.invoiceNumber && (
                              <div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>2B: </span>
                                <strong style={{ color: '#1e293b' }}>{item.invoiceNumber}</strong>
                              </div>
                            )}
                            {item.bookInvoiceNumber && item.bookInvoiceNumber !== item.invoiceNumber && (
                              <div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Books: </span>
                                <strong style={{ color: '#2563eb' }}>{item.bookInvoiceNumber}</strong>
                              </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {item.invoiceDate || '—'}
                            </div>
                          </div>
                        </td>

                        {/* Portal Values */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', verticalAlign: 'top' }}>
                          {item.portalTaxable ? (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{formatCurrency(item.portalTaxable)}</div>
                              <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 500 }}>
                                Tax: {formatCurrency(item.portalTax)}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* Books Values */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', verticalAlign: 'top' }}>
                          {item.bookTaxable ? (
                            <div>
                              <div style={{ fontWeight: 600, color: '#1e293b' }}>{formatCurrency(item.bookTaxable)}</div>
                              <div style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 500 }}>
                                Tax: {formatCurrency(item.bookTax)}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* Variance */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', verticalAlign: 'top' }}>
                          {isMatched ? (
                            <span style={{ color: '#059669', fontWeight: 600 }}>₹0.00</span>
                          ) : item.taxDifference > 0 ? (
                            <span style={{
                              color: isMismatch ? '#d97706' : '#dc2626',
                              fontWeight: 700,
                              background: isMismatch ? '#fffbeb' : '#fef2f2',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}>
                              {formatCurrency(item.taxDifference)}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* ITC Status */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center', verticalAlign: 'top' }}>
                          {item.itcAvailable ? (
                            <span style={{
                              background: '#ecfdf5',
                              color: '#065f46',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}>
                              Claimable
                            </span>
                          ) : (
                            <span style={{
                              background: '#f1f5f9',
                              color: '#64748b',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}>
                              Blocked / Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
