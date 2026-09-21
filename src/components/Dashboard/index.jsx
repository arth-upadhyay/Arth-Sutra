import React, { useState, useMemo } from 'react';
import { FileText, Trash2, Plus, IndianRupee, Receipt, Edit3, Search, Copy, X, CheckCircle, Clock, AlertTriangle, MessageCircle, Mail, Send, Package, Download, ChevronRight, Users } from 'lucide-react';

// Shared global components & utilities
import HelpButton from '../HelpButton';
import { formatCurrency, INVOICE_TYPES, getFYOptions } from '../../utils';
import { toast } from '../Toast';

// Local Dashboard components & constants
import ReceiptModal from './ReceiptModal';
import { STATUS_CONFIG, PaymentModeSelect } from './constants';

// Local Hooks
import { useDashboardMetrics } from './hooks/useDashboardMetrics';
import { useInvoiceFilters } from './hooks/useInvoiceFilters';
import { useInvoiceActions } from './hooks/useInvoiceActions';
import { useDashboardAlerts } from './hooks/useDashboardAlerts';
import { useReceiptModal } from './hooks/useReceiptModal';

// ---------------------------------------------------------------------------
// ERP-style UI stylesheet (Injected dynamically)
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined' && !document.getElementById('erp-dashboard-css')) {
  const s = document.createElement('style');
  s.id = 'erp-dashboard-css';
  s.textContent = `
    .erp-page { font-size: 0.875rem; background: transparent; color: var(--text-primary); --text-muted: var(--text-secondary); padding:0.25rem; border-radius:10px; }
    .erp-page h1, .erp-page h2, .erp-page h3, .erp-page h4 { color: var(--text-primary); }
    .erp-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1.1rem; flex-wrap:wrap; }
    .erp-crumb { font-size:0.72rem; color:var(--text-muted); margin-bottom:2px; display:flex; align-items:center; gap:4px; }
    .erp-title { font-size:1.3rem; font-weight:700; margin:0; letter-spacing:-0.01em; color: var(--text-primary); }
    .erp-title .hi, .erp-hi { font-weight:500; opacity:0.8; font-size:0.85em; }
    .erp-subtitle { color:var(--text-muted); font-size:0.8rem; margin-top:3px; }

    .erp-kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0.75rem; margin-bottom:1rem; }
    @media (max-width:1100px){ .erp-kpi-grid{ grid-template-columns:repeat(2,1fr); } }
    @media (max-width:560px){ .erp-kpi-grid{ grid-template-columns:1fr; } }
    .erp-kpi { background: var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:0.85rem 1rem; display:flex; gap:0.75rem; align-items:flex-start; backdrop-filter: blur(12px); }
    .erp-kpi-icon { width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: var(--bg-secondary); }
    .erp-kpi-label { font-size:0.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; }
    .erp-kpi-label .hi { text-transform:none; letter-spacing:0; font-weight:500; }
    .erp-kpi-value { font-size:1.22rem; font-weight:700; margin-top:2px; font-variant-numeric:tabular-nums; line-height:1.2; color: var(--text-primary); }
    .erp-kpi-value.sm { font-size:1rem; }
    .erp-kpi-sub { font-size:0.72rem; color:var(--text-muted); margin-top:3px; }

    .erp-alert { display:flex; align-items:center; gap:0.75rem; border-radius:8px; padding:0.7rem 1rem; margin-bottom:0.85rem; font-size:0.84rem; flex-wrap:wrap; }
    .erp-alert.danger { background: rgba(239, 68, 68, 0.18); border:1px solid rgba(239, 68, 68, 0.4); }
    .erp-alert.warn { background: rgba(245, 158, 11, 0.18); border:1px solid rgba(245, 158, 11, 0.4); }

    .erp-panel { background: var(--card-bg); border:1px solid var(--border); border-radius:12px; overflow:hidden; backdrop-filter: blur(12px); }
    .erp-panel-head { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.7rem 1rem; border-bottom:1px solid var(--border); flex-wrap:wrap; background: transparent; }
    .erp-panel-title { margin:0; font-size:0.95rem; font-weight:700; color: var(--text-primary); }
    .erp-filters { display:flex; flex-wrap:wrap; gap:0.5rem; padding:0.65rem 1rem; border-bottom:1px solid var(--border); align-items:center; background: var(--bg-tertiary); }

    .erp-input, select.erp-input { background: var(--bg-secondary); border:1px solid var(--border); color: var(--text-primary); border-radius:6px; padding:0.38rem 0.6rem; font-size:0.8rem; outline:none; }
    select.erp-input option { background: var(--card-bg); color: var(--text-primary); }
    .erp-input:focus { border-color: var(--primary); }

    .erp-search { display:flex; align-items:center; gap:0.4rem; background: var(--bg-secondary); border:1px solid var(--border); border-radius:6px; padding: 0 0.6rem; flex:1; min-width:180px; max-width:320px; }
    .erp-search input { border:none; background:transparent; color: var(--text-primary); padding:0.4rem 0; font-size:0.8rem; width:100%; outline:none; }
    .erp-search input::placeholder { color: var(--text-muted); }

    .erp-mini-btn { display:inline-flex; align-items:center; gap:0.3rem; border:1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary); border-radius:6px; padding:0.28rem 0.6rem; font-size:0.72rem; cursor:pointer; white-space:nowrap; }
    .erp-mini-btn:hover { background: var(--hover); }
    .erp-mini-btn:disabled { opacity:0.5; cursor:not-allowed; }
    .erp-mini-btn.danger { color: var(--danger); border-color: var(--danger); }

    .erp-table-scroll { overflow-x:auto; background: transparent; }
    .erp-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
    .erp-table thead th { position:sticky; top:0; background: var(--bg-tertiary); color: var(--text-primary); text-align:left; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:700; padding:0.55rem 0.6rem; border-bottom:1px solid var(--border); white-space:nowrap; z-index:1; }
    .erp-table thead th .hi { text-transform:none; letter-spacing:0; font-weight:500; opacity:0.8; }
    .erp-table tbody td { padding:0.5rem 0.6rem; border-bottom:1px solid var(--border); vertical-align:middle; color: var(--text-primary); }
    .erp-table tbody tr:hover { background: var(--hover); }
    .erp-table .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .erp-table .muted { color: var(--text-muted); }

    .erp-badge { display:inline-block; font-size:0.72rem; font-weight:600; color: var(--text-primary); background: var(--bg-secondary); border:1px solid var(--border); padding:0.12rem 0.5rem; border-radius:4px; white-space:nowrap; }
    .erp-type { display:inline-block; font-size:0.7rem; color: var(--text-muted); white-space:nowrap; }
    .erp-status-select { border-radius:999px; font-size:0.72rem; font-weight:600; padding:0.14rem 0.4rem; border:1px solid; cursor:pointer; background: var(--bg-secondary); color: var(--text-primary); }
    .erp-status-select option { background: var(--card-bg); color: var(--text-primary); }

    .erp-actions { display:flex; gap:0.15rem; justify-content:flex-end; flex-wrap:nowrap; }
    .erp-actions .icon-btn { width:26px; height:26px; color: var(--text-primary); }
    .erp-actions .icon-btn:hover { background: var(--hover); }

    .erp-foot { display:flex; justify-content:space-between; gap:0.75rem; padding:0.55rem 1rem; font-size:0.75rem; color: var(--text-muted); border-top:1px solid var(--border); flex-wrap:wrap; background: var(--bg-tertiary); }
    .erp-foot strong { color: var(--text-primary); font-variant-numeric:tabular-nums; }
    .erp-empty { padding:3rem 1rem; text-align:center; color: var(--text-muted); display:flex; flex-direction:column; align-items:center; gap:0.6rem; }
    .erp-stock-pill { padding:0.35rem 0.7rem; border-radius:6px; font-size:0.78rem; border:1px solid; }
    .erp-bulkbar { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; padding:0.6rem 1rem; margin:0.65rem 1rem; background: var(--primary-light); border:1px solid var(--border); border-radius:8px; }
  `;
  document.head.appendChild(s);
}

if (typeof document !== 'undefined' && !document.getElementById('erp-dash-v2-css')) {
  const s2 = document.createElement('style');
  s2.id = 'erp-dash-v2-css';
  s2.textContent = `
    .dash-top-grid { display:grid; grid-template-columns:1.6fr 1fr; gap:0.9rem; margin-bottom:0.9rem; }
    .dash-mid-grid { display:grid; grid-template-columns:1.5fr 1fr; gap:0.9rem; margin-bottom:0.9rem; }
    @media (max-width:1000px){ .dash-top-grid, .dash-mid-grid { grid-template-columns:1fr; } }

    .dash-card { background: var(--card-bg); border:1px solid var(--border); border-radius:14px; padding:1rem 1.15rem; box-shadow: 0 4px 12px rgba(0,0,0,0.10); backdrop-filter: blur(12px); color: var(--text-primary); }
    .dash-card-head { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.75rem; }
    .dash-card-title { margin:0; font-size:0.92rem; font-weight:600; color: var(--text-primary); }
    .dash-card-title .hi { font-weight:500; opacity:0.8; font-size:0.82em; }
    .dash-chip { font-size:0.7rem; padding:0.22rem 0.6rem; border-radius:999px; border:1px solid var(--border); color: var(--text-primary); background: var(--bg-secondary); white-space:nowrap; }

    .dash-chart-legend { display:flex; gap:1rem; margin-top:0.5rem; font-size:0.72rem; color: var(--text-muted); flex-wrap:wrap; }
    .dash-chart-legend span { display:inline-flex; align-items:center; gap:0.3rem; }
    .dash-chart-legend i { width:10px; height:3px; border-radius:2px; display:inline-block; }

    .dash-kpi-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.9rem; }
    @media (max-width:560px){ .dash-kpi-grid { grid-template-columns:1fr; } }
    .dash-kpi { display:flex; flex-direction:column; }
    .dash-kpi-value { font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; margin:2px 0 2px; font-variant-numeric:tabular-nums; line-height:1.25; color: var(--text-primary); }
    .dash-kpi-delta-up { color: var(--success); font-size:0.76rem; font-weight:600; }
    .dash-kpi-delta-down { color: var(--danger); font-size:0.76rem; font-weight:600; }
    .dash-kpi-sub { color: var(--text-muted); font-size:0.68rem; margin-top:2px; }
    .dash-kpi-spark { margin-top:auto; padding-top:0.5rem; align-self:flex-end; }

    .dash-progress { height:5px; border-radius:999px; background: var(--hover-strong); overflow:hidden; margin-bottom:0.6rem; }
    .dash-progress-fill { height:100%; border-radius:999px; background:linear-gradient(90deg, #34d399, #10b981); transition:width 0.4s ease; }

    .dash-check-item { display:flex; align-items:center; gap:0.65rem; width:100%; text-align:left; padding:0.5rem 0.6rem; border:none; background:transparent; border-radius:10px; cursor:pointer; color: var(--text-primary); font-size:0.83rem; }
    .dash-check-item:not(.dash-check-static):hover { background: var(--hover); }
    .dash-check-static { cursor:default; opacity:0.75; }
    .dash-check-dot { display:inline-flex; color: var(--text-muted); flex-shrink:0; }
    .dash-check-dot.done { color: #34d399; }
    .dash-check-label { flex:1; }
    .dash-check-arrow { color: var(--text-muted); }

    .dash-quick-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:0.55rem; }
    @media (max-width:560px){ .dash-quick-grid { grid-template-columns:repeat(2, 1fr); } }
    .dash-quick-btn { display:flex; flex-direction:column; align-items:center; gap:0.4rem; padding:0.85rem 0.4rem; border-radius:12px; border:1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary); font-size:0.72rem; cursor:pointer; transition:background 0.15s ease, transform 0.1s ease; }
    .dash-quick-btn:hover { background: var(--hover); }
    .dash-quick-btn:active { transform:scale(0.97); }

    .row-overdue { background: rgba(239, 68, 68, 0.08) !important; }
  `;
  document.head.appendChild(s2);
}

// ---------------------------------------------------------------------------
// Pure SVG Components — colors use CSS variables so they flip with the theme.
// ---------------------------------------------------------------------------
function Sparkline({ data, color = 'var(--text-primary)', width = 92, height = 28 }) {
  const clean = (data || []).map(v => Number(v) || 0);
  if (clean.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...clean), min = Math.min(...clean);
  const range = max - min || 1;
  const stepX = width / (clean.length - 1);
  const pts = clean.map((v, i) => [i * stepX, height - 3 - ((v - min) / range) * (height - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity="0.15" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}

function FinancialHealthChart({ months }) {
  const W = 560, H = 200, P = { t: 12, r: 10, b: 24, l: 48 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const keys = [
    { k: 'invoiced',    color: 'var(--text-primary)' },
    { k: 'received',    color: '#34d399' },
    { k: 'outstanding', color: '#f87171' },
  ];
  const all = (months || []).flatMap(m => keys.map(({ k }) => m[k]));
  const max = Math.max(...all, 1);
  const x = i => P.l + (months.length > 1 ? (i / (months.length - 1)) * iw : iw / 2);
  const y = v => P.t + ih - (v / max) * ih;
  const path = k => months.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m[k]).toFixed(1)}`).join(' ');
  const ticks = [0, 1, 2, 3].map(i => (max / 3) * i);
  const fmtTick = v => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${Math.round(v)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" strokeDasharray={i === 0 ? '' : '3 4'} opacity="0.7" />
          <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmtTick(t)}</text>
        </g>
      ))}
      {keys.map(({ k, color }) => (
        <path key={k} d={path(k)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {months.map((m, i) => (
        <text key={m.key} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{m.label}</text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------
export default function Dashboard({ onNew, onEdit, onDuplicate, onConvert }) {
  // --- 1. Hook Initializations ---
  const metrics = useDashboardMetrics() || {};
  const bills = metrics.bills || [];
  const stats = metrics.stats || { byCurrency: {}, count: 0 };
  const multiCurrency = metrics.multiCurrency || false;
  const monthlySeries = metrics.monthlySeries || [];
  const gstCompliance = metrics.gstCompliance || 0;
  const loadBills = metrics.loadBills || (() => {});

  const filters = useInvoiceFilters(bills) || {};
  const filtered = filters.filtered || bills;
  const visibleColumns = filters.visibleColumns || {};
  const fyOptions = useMemo(() => getFYOptions(), []);

  const alerts = useDashboardAlerts(bills) || {};
  const profile = alerts.profile || {};
  const clients = alerts.clients || [];
  const lowStockProducts = alerts.lowStockProducts || [];
  const overdueBills = alerts.overdueBills || [];

  const receipt = useReceiptModal() || {};

  const actions = useInvoiceActions({
    bills, filtered, profile, clients,
    loadBills,
    openReceipt: receipt.openReceipt,
    onEdit, onDuplicate, onConvert,
  }) || {};

  // --- 2. Local UI State ---
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showRemindAll, setShowRemindAll] = useState(false);

  // --- 3. Local Computations ---
  const overdueByCurrency = useMemo(() => {
    const acc = {};
    for (const b of overdueBills) {
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      acc[cur] = (acc[cur] || 0) + (b.totalAmount || 0) - (b.paidAmount || 0);
    }
    return acc;
  }, [overdueBills]);
  const overdueStr = Object.entries(overdueByCurrency).map(([cur, amt]) => formatCurrency(amt, cur)).join(' + ');

  const filteredTotals = useMemo(() => {
    const acc = {};
    for (const b of filtered) {
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      if (!acc[cur]) acc[cur] = { total: 0, out: 0 };
      acc[cur].total += Number(b.totalAmount) || 0;
      acc[cur].out += Math.max(0, (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0));
    }
    return acc;
  }, [filtered]);
  const filteredTotalStr = Object.entries(filteredTotals).map(([cur, v]) => formatCurrency(v.total, cur)).join(' + ') || '—';
  const filteredOutStr = Object.entries(filteredTotals).map(([cur, v]) => formatCurrency(v.out, cur)).join(' + ') || '—';

  const curMonth = monthlySeries[monthlySeries.length - 1] || { invoiced: 0, received: 0, outstanding: 0 };
  const prevMonth = monthlySeries[monthlySeries.length - 2] || { invoiced: 0, received: 0, outstanding: 0 };
  const pctChange = (a, b) => (b > 0 ? ((a - b) / b) * 100 : (a > 0 ? 100 : 0));
  const deltaSales = pctChange(curMonth.invoiced, prevMonth.invoiced);
  const deltaOutstanding = pctChange(curMonth.outstanding, prevMonth.outstanding);
  const deltaTax = pctChange(curMonth.received, prevMonth.received);

  const checklist = [
    { label: 'Create business profile / बिज़नेस प्रोफ़ाइल बनाएं', done: !!profile?.businessName },
    { label: 'Add your first client / पहला ग्राहक जोड़ें', done: clients.length > 0, action: () => toast('Add clients from the Clients page (ग्राहक पेज से जोड़ें)', 'info') },
    { label: 'Create your first invoice / पहला इनवॉइस बनाएं', done: bills.length > 0, action: onNew },
    { label: 'Record a payment / भुगतान दर्ज करें', done: bills.some(b => (b.paidAmount || 0) > 0), action: () => {
        const b = filtered.find(x => (Number(x.totalAmount) - (Number(x.paidAmount) || 0)) > 0.01);
        if (b) actions.openPaymentModal(b); else toast('No pending payments (कोई बाकी भुगतान नहीं)', 'info');
      } },
    { label: 'Clear overdue invoices / देरी से बकाया साफ़ करें', done: overdueBills.length === 0, action: () => filters.setStatusFilter('overdue') },
  ];
  const doneCount = checklist.filter(c => c.done).length;

  const hasFilters = Boolean(filters.search || filters.typeFilter !== 'all' || filters.statusFilter !== 'all' || filters.fyFilter !== 'all' || filters.dateFrom || filters.dateTo);

  // --- 4. Render ---
  return (
    <div className="erp-page">
      <div className="erp-header">
        <div>
          <h2 className="erp-title">Dashboard <span className="hi">(डैशबोर्ड)</span></h2>
          <div className="erp-subtitle">
            {bills.length} invoice{bills.length === 1 ? '' : 's'} ({bills.length} इनवॉइस)
            {profile?.businessName ? ` · ${profile.businessName}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="erp-input"
            value={filters.dateFrom ? 'month' : 'all'}
            onChange={e => {
              if (e.target.value === 'all') { filters.setDateFrom(''); filters.setDateTo(''); }
              else {
                const d = new Date();
                filters.setDateFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]);
                filters.setDateTo(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]);
              }
            }}
            title="Filter the invoice list by period (अवधि के अनुसार फ़िल्टर करें)">
            <option value="all">All Month (सभी महीने)</option>
            <option value="month">This Month (इस महीने)</option>
          </select>
          <HelpButton title="Dashboard (डैशबोर्ड) — how to use (कैसे इस्तेमाल करें)">
            <ul style={{ paddingLeft: '1.1rem', margin: 0, color: 'var(--text-primary)' }}>
              <li><strong>Financial Health (वित्तीय स्थिति)</strong> — last 6 months: invoiced vs received vs outstanding.</li>
              <li><strong>KPI cards (कार्ड)</strong> — sales, outstanding, tax collected and GST compliance.</li>
              <li><strong>Checklist (चेकलिस्ट)</strong> — ticks itself off as you set up profile, clients, invoices and payments.</li>
            </ul>
          </HelpButton>
          <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> New Invoice (नया इनवॉइस)</button>
        </div>
      </div>

      {overdueBills.length > 0 && (
        <div className="erp-alert danger" onClick={() => { filters.setStatusFilter('overdue'); }}
          style={{ cursor: 'pointer' }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <span style={{ fontWeight: 700, color: 'var(--danger)' }}>
              {overdueBills.length} overdue invoice{overdueBills.length > 1 ? 's' : ''} ({overdueBills.length} देरी से बकाया इनवॉइस)
            </span>
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: '0.8rem' }}>
              — {overdueStr} outstanding (बाकी राशि)
            </span>
          </div>
          <button className="erp-mini-btn danger"
            onClick={(e) => { e.stopPropagation(); setShowRemindAll(true); }}>
            <Send size={12} /> Remind All (सबको याद दिलाएं)
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600, whiteSpace: 'nowrap' }}>View all (सभी देखें) <ChevronRight size={12} style={{ verticalAlign: '-2px' }} /></span>
        </div>
      )}

      {showRemindAll && (
        <div className="modal-overlay" onClick={() => setShowRemindAll(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <h3 className="section-title">Send Payment Reminders (भुगतान अनुस्मारक भेजें)</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              Click on a client below to send a WhatsApp payment reminder.
            </p>
            {overdueBills.length === 0 ? (
              <p className="text-muted">No overdue invoices.</p>
            ) : (
              <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                {overdueBills.map(bill => {
                  const phone = actions.getClientPhone ? actions.getClientPhone(bill) : '';
                  return (
                    <div key={bill.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--border)', gap: '0.5rem' }}>
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{bill.clientName}</span>
                        <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>{bill.invoiceNumber}</span>
                        {(() => {
                          const outCur = bill.currency || bill.data?.invoiceOptions?.currency;
                          const out = bill.totalAmount - (bill.paidAmount || 0);
                          if (out < -0.005) {
                            return <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              Overpaid (अधिक भुगतान) {formatCurrency(Math.abs(out), outCur)}
                            </span>;
                          }
                          return <span style={{ marginLeft: 8, fontWeight: 600, color: 'var(--danger)', fontSize: '0.85rem' }}>
                            {formatCurrency(Math.max(0, out), outCur)} (बाकी)
                          </span>;
                        })()}
                        {phone && <span className="text-muted" style={{ marginLeft: 8, fontSize: '0.75rem' }}>{phone}</span>}
                      </div>
                      <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => actions.sendReminder({ ...bill, clientPhone: phone })}>
                        <MessageCircle size={13} /> Remind (याद दिलाएं)
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setShowRemindAll(false)}>Close (बंद करें)</button>
            </div>
          </div>
        </div>
      )}

      <div className="dash-top-grid">
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Financial Health <span className="hi">(वित्तीय स्थिति)</span></h3>
            <span className="dash-chip">Last 6 months (पिछले 6 महीने)</span>
          </div>
          <FinancialHealthChart months={monthlySeries} />
          <div className="dash-chart-legend">
            <span><i style={{ background: 'var(--text-primary)' }} />Invoiced (बिल किया गया)</span>
            <span><i style={{ background: '#34d399' }} />Received (प्राप्त)</span>
            <span><i style={{ background: '#f87171' }} />Outstanding (बाकी)</span>
          </div>
        </div>

        <div className="dash-kpi-grid">
          <div className="dash-card dash-kpi">
            <h3 className="dash-card-title">Sales Overview <span className="hi">(कुल बिक्री)</span></h3>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="dash-kpi-value" style={multiCurrency ? { fontSize: '1rem' } : undefined}>
                {formatCurrency(v.total, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <div className="dash-kpi-value">—</div>}
            <div className={deltaSales >= 0 ? 'dash-kpi-delta-up' : 'dash-kpi-delta-down'}>
              {deltaSales >= 0 ? '▲' : '▼'} {Math.abs(deltaSales).toFixed(2)}%
            </div>
            <div className="dash-kpi-sub">vs last month (पिछले महीने से)</div>
            <div className="dash-kpi-spark"><Sparkline data={monthlySeries.map(m => m.invoiced)} color="var(--text-primary)" /></div>
          </div>

          <div className="dash-card dash-kpi">
            <h3 className="dash-card-title">Outstanding Receivables <span className="hi">(बाकी राशि)</span></h3>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="dash-kpi-value" style={{ color: 'var(--danger)', ...(multiCurrency ? { fontSize: '1rem' } : undefined) }}>
                {formatCurrency(v.unpaid, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <div className="dash-kpi-value" style={{ color: 'var(--danger)' }}>—</div>}
            <div className={deltaOutstanding <= 0 ? 'dash-kpi-delta-up' : 'dash-kpi-delta-down'}>
              {deltaOutstanding <= 0 ? '▼' : '▲'} {Math.abs(deltaOutstanding).toFixed(2)}%
            </div>
            <div className="dash-kpi-sub">{overdueBills.length} overdue (देरी से बकाया)</div>
            <div className="dash-kpi-spark"><Sparkline data={monthlySeries.map(m => m.outstanding)} color="#f87171" /></div>
          </div>

          <div className="dash-card dash-kpi">
            <h3 className="dash-card-title">Tax Collected <span className="hi">(जमा किया गया कर)</span></h3>
            {Object.entries(stats.byCurrency).map(([cur, v]) => (
              <div key={cur} className="dash-kpi-value" style={{ color: 'var(--success)', ...(multiCurrency ? { fontSize: '1rem' } : undefined) }}>
                {formatCurrency(v.tax, cur)}
              </div>
            ))}
            {Object.keys(stats.byCurrency).length === 0 && <div className="dash-kpi-value" style={{ color: 'var(--success)' }}>—</div>}
            <div className={deltaTax >= 0 ? 'dash-kpi-delta-up' : 'dash-kpi-delta-down'}>
              {deltaTax >= 0 ? '▲' : '▼'} {Math.abs(deltaTax).toFixed(2)}%
            </div>
            <div className="dash-kpi-sub">receipts vs last month (पिछले महीने की तुलना में)</div>
            <div className="dash-kpi-spark"><Sparkline data={monthlySeries.map(m => m.received)} color="#34d399" /></div>
          </div>

          <div className="dash-card dash-kpi">
            <h3 className="dash-card-title">GST Compliance Score <span className="hi">(GST अनुपालन स्कोर)</span></h3>
            <div className="dash-kpi-value" style={{ color: 'var(--success)' }}>{gstCompliance}%</div>
            <div className="dash-kpi-sub">invoices with GSTIN on file (GSTIN वाले इनवॉइस)</div>
            <div className="dash-kpi-spark"><Sparkline data={monthlySeries.map(m => m.received)} color="#34d399" /></div>
          </div>
        </div>
      </div>

      <div className="dash-mid-grid">
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Getting Started Checklist <span className="hi">(शुरुआती चेकलिस्ट)</span></h3>
            <span className="dash-kpi-sub">{doneCount}/{checklist.length} done (पूर्ण)</span>
          </div>
          <div className="dash-progress">
            <div className="dash-progress-fill" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
          </div>
          <div>
            {checklist.map(item => (
              <button key={item.label} type="button"
                className={`dash-check-item${item.action ? '' : ' dash-check-static'}`}
                onClick={item.action}
                title={item.action ? item.label : (item.done ? 'Done (पूर्ण)' : 'Not yet (अभी नहीं)')}>
                <span className={`dash-check-dot${item.done ? ' done' : ''}`}>
                  {item.done ? <CheckCircle size={16} /> : <Clock size={16} />}
                </span>
                <span className="dash-check-label">{item.label}</span>
                {item.action && <span className="dash-check-arrow">›</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Quick Actions <span className="hi">(त्वरित कार्रवाई)</span></h3>
          </div>
          <div className="dash-quick-grid">
            <button type="button" className="dash-quick-btn" onClick={onNew}>
              <FileText size={18} /><span>New Invoice (नया इनवॉइस)</span>
            </button>
            <button type="button" className="dash-quick-btn" onClick={() => toast('Add clients from the Clients page (ग्राहक पेज से जोड़ें)', 'info')}>
              <Users size={18} /><span>Add Client (ग्राहक जोड़ें)</span>
            </button>
            <button type="button" className="dash-quick-btn" onClick={() => checklist[3].action()}>
              <IndianRupee size={18} /><span>Record Payment (भुगतान दर्ज करें)</span>
            </button>
            <button type="button" className="dash-quick-btn" onClick={() => filters.setStatusFilter('overdue')}>
              <AlertTriangle size={18} /><span>Overdue (देरी से बकाया)</span>
            </button>
            <button type="button" className="dash-quick-btn" onClick={() => filters.setStatusFilter('unpaid')}>
              <Clock size={18} /><span>Outstanding (बाकी)</span>
            </button>
            <button type="button" className="dash-quick-btn" onClick={filters.clearFilters}>
              <Receipt size={18} /><span>All Invoices (सभी इनवॉइस)</span>
            </button>
          </div>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <div className="erp-alert warn">
          <Package size={18} style={{ color: 'var(--warn-text)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--warn-text)', marginBottom: 6 }}>
              Low Stock Alert ({lowStockProducts.length} item{lowStockProducts.length > 1 ? 's' : ''}) (कम स्टॉक चेतावनी)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {lowStockProducts.map(p => (
                <div key={p.id} className="erp-stock-pill"
                  style={{
                    background: (p.stock ?? 0) <= 0 ? 'var(--danger-light)' : 'var(--warn-bg)',
                    borderColor: (p.stock ?? 0) <= 0 ? 'var(--danger)' : 'var(--warn-border)',
                    color: (p.stock ?? 0) <= 0 ? 'var(--danger)' : 'var(--warn-text)',
                  }}>
                  <strong>{p.name}</strong>
                  {p.hsn ? <span className="text-muted" style={{ marginLeft: 4, fontSize: '0.72rem' }}>({p.hsn})</span> : null}
                  <span style={{ marginLeft: 6, fontWeight: 700 }}>
                    {(p.stock ?? 0) <= 0 ? 'Out of Stock (स्टॉक खत्म)' : `Stock: ${p.stock} (स्टॉक: ${p.stock})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="erp-panel">
        <div className="erp-panel-head">
          <h3 className="erp-panel-title">Invoices (इनवॉइस)</h3>
          <button type="button" className="erp-mini-btn" onClick={() => setShowColumnPicker(v => !v)}
            title="Choose which columns to show (कॉलम चुनें)">
            <FileText size={13} /> Columns (कॉलम)
          </button>
        </div>

        <div className="erp-filters">
          <div className="erp-search">
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input type="text" placeholder="Search client or invoice…" value={filters.search || ''}
              onChange={e => filters.setSearch(e.target.value)} />
          </div>
          <select className="erp-input" value={filters.fyFilter || 'all'} onChange={e => filters.setFyFilter(e.target.value)} title="Financial year (वित्तीय वर्ष)">
            <option value="all">All Years (सभी वर्ष)</option>
            {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
          </select>
          <select className="erp-input" value={filters.typeFilter || 'all'} onChange={e => filters.setTypeFilter(e.target.value)} title="Invoice type (इनवॉइस प्रकार)">
            <option value="all">All Types (सभी प्रकार)</option>
            {Object.entries(INVOICE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
          </select>
          <select className="erp-input" value={filters.statusFilter || 'all'} onChange={e => filters.setStatusFilter(e.target.value)} title="Status (स्थिति)">
            <option value="all">All Status (सभी स्थिति)</option>
            <option value="unpaid">Unpaid (बाकी)</option>
            <option value="partial">Partial (आंशिक)</option>
            <option value="paid">Paid (पूरा भुगतान)</option>
            <option value="overdue">Overdue (देरी से बकाया)</option>
          </select>
          <input type="date" className="erp-input" value={filters.dateFrom || ''} onChange={e => filters.setDateFrom(e.target.value)} title="From date (तारीख से)" />
          <input type="date" className="erp-input" value={filters.dateTo || ''} onChange={e => filters.setDateTo(e.target.value)} title="To date (तारीख तक)" />
          {hasFilters && (
            <button className="icon-btn icon-btn-red" onClick={filters.clearFilters} title="Clear filters (फ़िल्टर हटाएं)"><X size={15} /></button>
          )}
        </div>

        {showColumnPicker && (
          <div style={{
            padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-tertiary)',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              Pick columns to show (दिखाने के लिए कॉलम चुनें)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {[
                ['date', 'Date (तारीख)'], ['invoice', 'Invoice # (इनवॉइस नं.)'], ['type', 'Type (प्रकार)'],
                ['client', 'Client (ग्राहक)'], ['amount', 'Amount (राशि)'], ['currency', 'Currency (मुद्रा)'],
                ['status', 'Status (स्थिति)'], ['dueDate', 'Due date (देय तारीख)'],
                ['printed', 'Print count (प्रिंट)'], ['actions', 'Actions (कार्रवाई)'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={!!visibleColumns[key]}
                    onChange={e => filters.setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                    style={{ width: 14, height: 14, accentColor: 'var(--primary)' }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{
          padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
          alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)'
        }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick print (त्वरित प्रिंट):
          </span>
          <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy}
            onClick={() => actions.bulkPrintByFilter('all')}>
            <Download size={12} /> All shown (सभी) ({filtered.length})
          </button>
          <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy}
            onClick={() => actions.bulkPrintByFilter('unpaid')}>
            <Clock size={12} /> Unpaid (बाकी) ({filtered.filter(b => (b.status || 'unpaid') === 'unpaid').length})
          </button>
          <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy}
            onClick={() => actions.bulkPrintByFilter('overdue')}>
            <AlertTriangle size={12} /> Overdue (देरी) ({filtered.filter(b => b.status === 'overdue').length})
          </button>
          <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy}
            onClick={() => actions.bulkPrintByFilter('paid')}>
            <CheckCircle size={12} /> Paid (पूरा) ({filtered.filter(b => b.status === 'paid').length})
          </button>
        </div>

        {actions.selectedIds?.size > 0 && (
          <div className="erp-bulkbar">
            <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{actions.selectedIds.size} selected (चुने गए)</strong>
            <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy} onClick={() => actions.bulkMarkStatus('paid')}>
              <CheckCircle size={12} /> Mark paid (पूरा)</button>
            <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy} onClick={() => actions.bulkMarkStatus('unpaid')}>
              <Clock size={12} /> Mark unpaid (बाकी)</button>
            <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy} onClick={() => actions.bulkMarkStatus('overdue')}>
              <AlertTriangle size={12} /> Mark overdue (देरी)</button>
            <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy} onClick={actions.bulkExportJSON}>
              <FileText size={12} /> Export JSON (निर्यात)</button>
            <button type="button" className="erp-mini-btn" disabled={actions.bulkBusy} onClick={() => actions.bulkExportPDF()}><Download size={12} /> Bulk PDF (थोक PDF)</button>
            <button type="button" className="erp-mini-btn danger" disabled={actions.bulkBusy} onClick={actions.bulkDelete}>
              <Trash2 size={12} /> Delete (हटाएं)</button>
            <button type="button" className="icon-btn" onClick={actions.clearSelection} style={{ marginLeft: 'auto' }}>
              <X size={14} />
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="erp-empty">
            <FileText size={44} />
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              {bills.length === 0 ? 'No invoices yet. (अभी कोई इनवॉइस नहीं है।)' : 'No invoices match your filters. (आपके फ़िल्टर से कोई इनवॉइस नहीं मिली।)'}
            </p>
            {bills.length === 0 && <button className="btn btn-primary" onClick={onNew}><Plus size={18} /> Create Invoice (इनवॉइस बनाएं)</button>}
          </div>
        ) : (
          <div className="erp-table-scroll">
            <table className="erp-table">
              <thead>
                <tr>
                  <th style={{ width: '32px', padding: '0.5rem 0.25rem 0.5rem 0.75rem' }}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(b => actions.selectedIds?.has(b.id))}
                      onChange={actions.toggleSelectAllVisible}
                      style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  </th>
                  {visibleColumns.date && <th>Date <span className="hi">(तारीख)</span></th>}
                  {visibleColumns.invoice && <th>Invoice No. <span className="hi">(इनवॉइस नं.)</span></th>}
                  {visibleColumns.type && <th>Type <span className="hi">(प्रकार)</span></th>}
                  {visibleColumns.client && <th>Client <span className="hi">(ग्राहक)</span></th>}
                  {visibleColumns.amount && <th className="num">Amount <span className="hi">(राशि)</span></th>}
                  {visibleColumns.currency && <th>Currency <span className="hi">(मुद्रा)</span></th>}
                  {visibleColumns.dueDate && <th>Due Date <span className="hi">(देय तारीख)</span></th>}
                  {visibleColumns.printed && <th style={{ textAlign: 'center' }}>Printed <span className="hi">(प्रिंट)</span></th>}
                  <th className="num">Paid <span className="hi">(भुगतान)</span></th>
                  {visibleColumns.status && <th>Status <span className="hi">(स्थिति)</span></th>}
                  {visibleColumns.actions && <th style={{ textAlign: 'right' }}>Actions <span className="hi">(कार्रवाई)</span></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(bill => {
                  const status = bill.status || 'unpaid';
                  const sc = STATUS_CONFIG[status] || STATUS_CONFIG.unpaid;
                  const isOverdue = status !== 'paid' && bill.data?.details?.dueDate && new Date(bill.data.details.dueDate) < new Date();
                  const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(bill.data.details.dueDate)) / 86400000) : 0;
                  const billCurrency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
                  return (
                    <tr key={bill.id} className={isOverdue || status === 'overdue' ? 'row-overdue' : ''}
                      style={actions.selectedIds?.has(bill.id) ? { background: 'var(--primary-light)' } : undefined}>
                      <td style={{ padding: '0.5rem 0.25rem 0.5rem 0.75rem' }}>
                        <input type="checkbox" checked={actions.selectedIds?.has(bill.id)} onChange={() => actions.toggleSelect(bill.id)}
                          style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                      </td>
                      {visibleColumns.date && <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(bill.invoiceDate).toLocaleDateString('en-IN')}</td>}
                      {visibleColumns.invoice && <td><span className="erp-badge">{bill.invoiceNumber}</span></td>}
                      {visibleColumns.type && <td><span className="erp-type">{(INVOICE_TYPES[bill.invoiceType || 'tax-invoice'])?.label}</span></td>}
                      {visibleColumns.client && <td className="font-medium" title={bill.clientName} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bill.clientName}
                      </td>}
                      {visibleColumns.amount && <td className="num" style={{ fontWeight: 700 }}>
                        {formatCurrency(bill.totalAmount, billCurrency)}
                        {billCurrency !== 'INR' && !visibleColumns.currency && <span className="erp-badge" style={{ marginLeft: 6, fontSize: '0.65rem' }}>{billCurrency}</span>}
                      </td>}
                      {visibleColumns.currency && <td className="muted">{billCurrency}</td>}
                      {visibleColumns.dueDate && <td className="muted" style={{ whiteSpace: 'nowrap' }}>{bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN') : <span>—</span>}</td>}
                      {visibleColumns.printed && <td className="muted" style={{ textAlign: 'center' }}>{Number(bill.printedCount) || 0}×</td>}
                      <td className="num muted">{(bill.paidAmount || 0) > 0 ? formatCurrency(bill.paidAmount, billCurrency) : <span>—</span>}</td>
                      {visibleColumns.status && <td>
                        <select className="erp-status-select" value={isOverdue && status !== 'overdue' ? 'overdue' : status}
                          style={{ background: sc.bg, color: sc.color, borderColor: sc.color + '44' }}
                          onChange={e => actions.changeStatus(bill, e.target.value)}>
                          {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                            <option key={key} value={key}>{val.label}</option>
                          ))}
                        </select>
                        {daysOverdue > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--danger)', display: 'block', marginTop: 2 }}>{daysOverdue}d overdue</span>}
                      </td>}
                      {visibleColumns.actions && <td>
                        <div className="erp-actions">
                          <button className="icon-btn icon-btn-blue" onClick={() => actions.handleView(bill)} title="Edit"><Edit3 size={14} /></button>
                          <button className="icon-btn icon-btn-blue" onClick={() => onDuplicate(bill)} title="Duplicate"><Copy size={14} /></button>
                          {(bill.invoiceType === 'proforma' || bill.invoiceType === 'delivery-challan') && (
                            <button className="icon-btn icon-btn-green" onClick={() => onConvert(bill)} title="Convert to Tax Invoice"><FileText size={14} /></button>
                          )}
                          <button className="icon-btn icon-btn-green" onClick={() => actions.openPaymentModal(bill)} title="Record Payment"><IndianRupee size={14} /></button>
                          <button className="icon-btn icon-btn-green" onClick={() => actions.shareWhatsApp(bill)} title="Share via WhatsApp">
                            <MessageCircle size={14} />
                          </button>
                          {(isOverdue || status === 'overdue' || status === 'unpaid' || status === 'partial') && (bill.totalAmount || 0) - (bill.paidAmount || 0) > 0.01 && (
                            <button className="icon-btn icon-btn-green"
                              onClick={() => actions.sendReminder({ ...bill, clientPhone: actions.getClientPhone ? actions.getClientPhone(bill) : '' })}
                              style={{ color: status === 'partial' ? 'var(--text-muted)' : 'var(--danger)' }}>
                              <Send size={14} />
                            </button>
                          )}
                          <button className="icon-btn icon-btn-blue" onClick={() => actions.shareEmail(bill)} title="Email"><Mail size={14} /></button>
                          <button className="icon-btn icon-btn-red" onClick={() => actions.handleDelete(bill)} title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="erp-foot">
            <span>Showing {filtered.length} of {bills.length} invoices ({bills.length} में से {filtered.length} इनवॉइस)</span>
            <span>
              Total (कुल): <strong>{filteredTotalStr}</strong>
              <span style={{ margin: '0 8px' }}>·</span>
              Outstanding (बाकी): <strong style={{ color: 'var(--danger)' }}>{filteredOutStr}</strong>
            </span>
          </div>
        )}
      </div>

      {/* ===== Modals (Record Payment & Edit Payment) ===== */}
      {actions.paymentModal && (
        <div className="modal-overlay" onClick={() => actions.closePaymentModal()}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="section-title">Record Payment (भुगतान दर्ज करें)</h3>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              Invoice (इनवॉइस): <strong style={{ color: 'var(--text-primary)' }}>{actions.paymentModal.invoiceNumber}</strong> | Total: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(actions.paymentModal.totalAmount, actions.paymentModal.currency)}</strong>
              {(actions.paymentModal.paidAmount || 0) > 0 && <> | Paid: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(actions.paymentModal.paidAmount, actions.paymentModal.currency)}</strong></>}
              {' '}| {(() => {
                const rem = actions.paymentModal.totalAmount - (actions.paymentModal.paidAmount || 0);
                if (rem < -0.005) return <>Overpaid: <strong style={{ color: 'var(--success)' }}>{formatCurrency(Math.abs(rem), actions.paymentModal.currency)}</strong></>;
                return <>Balance: <strong style={{ color: rem > 0.005 ? 'var(--danger)' : 'var(--success)' }}>{formatCurrency(Math.max(0, rem), actions.paymentModal.currency)}</strong></>;
              })()}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Amount Received</label>
                <input type="number" className="form-input" value={actions.paymentInput?.amount || ''} onChange={e => actions.setPaymentInput(prev => ({ ...prev, amount: e.target.value }))} placeholder={String(actions.paymentModal.totalAmount - (actions.paymentModal.paidAmount || 0))} min="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Date</label>
                <input type="date" className="form-input" value={actions.paymentInput?.date || ''} onChange={e => actions.setPaymentInput(prev => ({ ...prev, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Mode</label>
                <PaymentModeSelect value={actions.paymentInput?.mode || 'bank-transfer'} onChange={e => actions.setPaymentInput(prev => ({ ...prev, mode: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Note</label>
                <input type="text" className="form-input" value={actions.paymentInput?.note || ''} onChange={e => actions.setPaymentInput(prev => ({ ...prev, note: e.target.value }))} placeholder="Transaction ID, ref…" />
              </div>
            </div>
            {actions.paymentModal.payments?.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <label className="form-label">Payment History</label>
                <div className="payment-history">
                  {actions.paymentModal.payments.map((p, i) => (
                    <div key={p.id || i} className="payment-row" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 90, color: 'var(--text-muted)' }}>{p.date ? new Date(p.date).toLocaleDateString('en-IN') : '—'}</span>
                      <span className="font-bold" style={{ minWidth: 100 }}>{formatCurrency(p.amount, actions.paymentModal.currency)}</span>
                      <span className="text-muted" style={{ minWidth: 110 }}>{p.mode}</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => receipt.openReceipt && receipt.openReceipt(actions.paymentModal, p)}><Receipt size={12} /> Receipt</button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => actions.editPaymentAt(actions.paymentModal, i)}><Edit3 size={12} /></button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => actions.deletePaymentAt(actions.paymentModal, i)}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => actions.closePaymentModal()}>Cancel</button>
              <button className="btn btn-primary" onClick={actions.recordPayment}>Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {actions.editPaymentModal && (
        <div className="modal-overlay" onClick={() => actions.setEditPaymentModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Edit Payment</h3>
              <button className="icon-btn" onClick={() => actions.setEditPaymentModal(null)}><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group"><label className="form-label">Amount</label><input type="number" className="form-input" value={actions.editPaymentModal.form?.amount || ''} onChange={e => actions.setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, amount: e.target.value } }))} min="0" step="0.01" /></div>
              <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={actions.editPaymentModal.form?.date || ''} onChange={e => actions.setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, date: e.target.value } }))} /></div>
              <div className="form-group"><label className="form-label">Mode</label><PaymentModeSelect value={actions.editPaymentModal.form?.mode || 'bank-transfer'} onChange={e => actions.setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, mode: e.target.value } }))} /></div>
              <div className="form-group"><label className="form-label">Note</label><input type="text" className="form-input" value={actions.editPaymentModal.form?.note || ''} onChange={e => actions.setEditPaymentModal(prev => ({ ...prev, form: { ...prev.form, note: e.target.value } }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => actions.setEditPaymentModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={actions.saveEditedPayment}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {receipt.isOpen && receipt.receiptData && (
        <ReceiptModal target={receipt.receiptData} onClose={() => receipt.close()} />
      )}
    </div>
  );
}