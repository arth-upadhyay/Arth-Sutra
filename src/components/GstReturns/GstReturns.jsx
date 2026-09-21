import React from 'react';
import {
  FileText, Download, Upload, ExternalLink, CheckCircle,
  AlertTriangle, BookOpen, BarChart3,
} from 'lucide-react';
import { formatCurrency } from '../../utils';
import HelpButton from '../HelpButton';
import { toast } from '../Toast';
import {
  MONTHS, QUARTERS,
  GSTR1_STEPS, GSTR3B_STEPS, NIL_GSTR1_STEPS, NIL_GSTR3B_STEPS,
} from './constants';
import StepList from './components/StepList';
import { buildReconciliation, downloadCSV, getTaxableAmount } from './utils/gstHelpers';
import { useGstReturns } from './hooks/useGstReturns';

// ========== Main Component ==========
export default function GstReturns() {
  const {
    // State
    filterMode, setFilterMode,
    fyFilter, setFyFilter,
    monthFilter, setMonthFilter,
    yearFilter, setYearFilter,
    quarterFilter, setQuarterFilter,
    activeTab, setActiveTab,
    guideTab, setGuideTab,
    gstr2bData, setGstr2bData,
    gstr2bFilter, setGstr2bFilter,
    gstr2bInputRef,
    // Options
    fyOptions, yearOptions,
    // Data
    purchases,
    // Filtered
    filteredBills, filteredExpenses,
    // Classification
    creditNotes, b2bRegular, b2cLarge, b2cBills, b2cSmall,
    // Computed
    b2bRows, b2bTotals,
    b2cByRate, b2cRates, b2cTotals,
    hsnRows,
    grandTotals,
    outputTax, itcFromExpenses, netTax,
    docSummary,
    warnings,
    interStateB2CRows,
    // Scalars
    totalTax, netPayable,
    // Filing
    periodFiling, toggleFiled, markFiled,
    isNilReturn,
    // Actions
    handleImport2B,
    exportB2B, exportB2C, exportHSN, exportCDNR, exportDocSummary,
    exportGSTR3B, exportGSTR3BJSON, exportGSTR1JSON,
  } = useGstReturns();

  return (
    <div className="dashboard-container">
      {/* Header row: title + period selector + portal link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>GST Returns</h1>
        <HelpButton title="GST Returns — how to use">
          <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li><strong>Pick a period</strong> — Monthly / Quarterly (QRMP) / Full Year, then the specific month + year.</li>
            <li><strong>R1 Filed / 3B Pending pills</strong> — click to toggle Filed ↔ Pending in case of misclick. Colour changes reflect the current state.</li>
            <li><strong>GSTR-1</strong> tab shows B2B / B2C / HSN Summary / Docs Issued as the portal expects. "Download JSON" gives you the file to upload at gst.gov.in.</li>
            <li><strong>GSTR-3B</strong> auto-populates from your GSTR-1 (from July 2025). Cross-check with the Notes column before filing.</li>
            <li><strong>GSTR-2B</strong> — upload the JSON you download from the portal; app matches ITC against your Purchase Bills to flag mismatches.</li>
            <li><strong>Mark Filed</strong> — after filing on the portal, click Mark Filed to keep the app's status in sync.</li>
          </ul>
        </HelpButton>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <select className="form-input" value={filterMode} onChange={e => setFilterMode(e.target.value)} style={{ width: 'auto', minWidth: '120px' }}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly (QRMP)</option>
            <option value="fy">Full Year</option>
          </select>
          {filterMode === 'fy' ? (
            <select className="form-input" value={fyFilter} onChange={e => setFyFilter(e.target.value)} style={{ width: 'auto' }}>
              {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
            </select>
          ) : filterMode === 'quarter' ? (
            <>
              <select className="form-input" value={quarterFilter} onChange={e => setQuarterFilter(e.target.value)} style={{ width: 'auto' }}>
                {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ width: 'auto', minWidth: '80px' }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          ) : (
            <>
              <select className="form-input" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ width: 'auto' }}>
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ width: 'auto', minWidth: '80px' }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          {/* Filing status — v1.10.18: clickable to toggle. Reported: "in
              every option give option to change or edit because by mistake
              if click happens user can change that". */}
          <button type="button" onClick={() => toggleFiled('gstr1')}
            title={periodFiling.gstr1 ? 'Click to mark as pending' : 'Click to mark as filed'}
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer', background: periodFiling.gstr1 ? '#ecfdf5' : '#fef2f2', color: periodFiling.gstr1 ? '#059669' : '#dc2626', fontWeight: 600 }}>
            R1 {periodFiling.gstr1 ? 'Filed' : 'Pending'}
          </button>
          <button type="button" onClick={() => toggleFiled('gstr3b')}
            title={periodFiling.gstr3b ? 'Click to mark as pending' : 'Click to mark as filed'}
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '10px', border: 'none', cursor: 'pointer', background: periodFiling.gstr3b ? '#ecfdf5' : '#fef2f2', color: periodFiling.gstr3b ? '#059669' : '#dc2626', fontWeight: 600 }}>
            3B {periodFiling.gstr3b ? 'Filed' : 'Pending'}
          </button>
        </div>
        <a href="https://gst.gov.in" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
          <ExternalLink size={14} /> GST Portal
        </a>
      </div>

      {/* Warnings — collapsed by default, only errors show */}
      {warnings.filter(w => w.type === 'error').length > 0 && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--danger-light, #fef2f2)', fontSize: '0.8rem', color: '#dc2626' }}>
          <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: '0.35rem' }} />
          {warnings.filter(w => w.type === 'error').slice(0, 3).map(w => w.msg).join(' | ')}
        </div>
      )}

      {/* NIL Return notice */}
      {isNilReturn && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem', borderRadius: '8px', background: 'var(--warn-bg)', color: 'var(--warn-text)', fontSize: '0.8rem' }}>
          No invoices or expenses found — file a NIL return on the GST portal. NIL returns are mandatory.
        </div>
      )}

      {/* Compact summary + tabs in one row */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ padding: '0.75rem 1rem', flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices</p><strong style={{ fontSize: '1.25rem' }}>{filteredBills.length}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable</p><strong style={{ fontSize: '1rem' }}>{formatCurrency(grandTotals.taxable)}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Tax</p><strong style={{ fontSize: '1rem' }}>{formatCurrency(totalTax)}</strong></div>
          <div style={{ width: '1px', height: '2rem', background: 'var(--border)' }} />
          <div><p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Net Payable</p><strong style={{ fontSize: '1rem', color: 'var(--primary)' }}>{formatCurrency(netPayable)}</strong></div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { id: 'gstr1', label: 'GSTR-1', icon: BarChart3 },
          { id: 'gstr3b', label: 'GSTR-3B', icon: FileText },
          { id: 'gstr2b', label: 'GSTR-2B Reconciliation', icon: CheckCircle },
          { id: 'tds', label: 'TDS / TCS Report', icon: FileText },
          { id: 'guide', label: 'Filing Guide', icon: BookOpen },
        ].map(tab => (
          <button key={tab.id} className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.id)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ===================== GSTR-1 TAB ===================== */}
      {activeTab === 'gstr1' && (
        <>
          {/* Actions bar */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={exportGSTR1JSON} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Upload size={13} /> JSON Export</button>
            <button className="btn btn-secondary" onClick={exportB2B} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> B2B</button>
            <button className="btn btn-secondary" onClick={exportB2C} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> B2C</button>
            <button className="btn btn-secondary" onClick={exportHSN} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> HSN</button>
            <button className="btn btn-secondary" onClick={exportCDNR} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> CDNR</button>
            <button className="btn btn-secondary" onClick={exportDocSummary} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> Docs</button>
            {!periodFiling.gstr1 && (
              <button className="btn btn-secondary" onClick={() => markFiled('gstr1')} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', marginLeft: 'auto', color: '#059669', borderColor: '#bbf7d0' }}>
                <CheckCircle size={13} /> Mark Filed
              </button>
            )}
          </div>

          {/* B2B — Table 4A */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>B2B Sales — Table 4A</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>{b2bRows.length} invoice{b2bRows.length !== 1 ? 's' : ''}</span>
            </div>
            {b2bRows.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No B2B invoices for this period.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr>
                    <th>GSTIN</th><th>Client</th><th>Invoice No</th><th>Date</th><th>POS</th><th>Type</th>
                    <th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th>
                    <th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: was key={i}; use invoiceNo which is stable across sorts. */}
                    {b2bRows.map((r, i) => (
                      <tr key={r.invoiceNo || `b2b-${i}`}>
                        <td><span className="invoice-badge">{r.gstin}</span></td>
                        <td className="font-medium">{r.clientName}</td>
                        <td>{r.invoiceNo}</td>
                        <td className="text-muted">{r.date ? new Date(r.date).toLocaleDateString('en-IN') : ''}</td>
                        <td className="text-muted">{r.pos}</td>
                        <td><span className="type-badge">{r.supplyType}</span></td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.cgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.sgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td colSpan={6}>B2B Total</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.cgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.sgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.igst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.total)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Credit/Debit Notes — Table 9B */}
          {creditNotes.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header">
                <h3>Credit/Debit Notes — Table 9B</h3>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>{creditNotes.length} note{creditNotes.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>GSTIN</th><th>Client</th><th>Note No</th><th>Date</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: was key={i}; use bill.id which is stable. */}
                    {creditNotes.map((bill, i) => {
                      const { client, totals } = bill.data;
                      return (
                        <tr key={bill.id || `cn-${i}`}>
                          <td><span className="invoice-badge">{client?.gstin || 'Unregistered'}</span></td>
                          <td className="font-medium">{client?.name || bill.clientName}</td>
                          <td>{bill.invoiceNumber}</td>
                          <td className="text-muted">{bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN') : ''}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(getTaxableAmount(totals))}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency((totals?.cgst || 0) + (totals?.sgst || 0) + (totals?.igst || 0))}</td>
                          <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(totals?.total || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* B2C — Table 7 */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>B2C Sales — Table 7</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                {b2cBills.length} invoice{b2cBills.length !== 1 ? 's' : ''}
                {b2cLarge.length > 0 && <> ({b2cLarge.length} B2C Large)</>}
              </span>
            </div>
            {b2cRates.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No B2C invoices for this period.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Rate %</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {b2cRates.map(rate => {
                      const d = b2cByRate[rate];
                      return (
                        <tr key={rate}>
                          <td><span className="type-badge">{rate}%</span></td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(d.taxable)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(d.cgst)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(d.sgst)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(d.igst)}</td>
                          <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(d.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td>B2C Total</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.cgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.sgst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.igst)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.total)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* HSN Summary — Table 12 */}
          <div className="glass-panel mb-4">
            <div className="table-header">
              <h3>HSN Summary — Table 12</h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>{hsnRows.length} code{hsnRows.length !== 1 ? 's' : ''}</span>
            </div>
            {hsnRows.length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No items found.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>HSN</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total Tax</th></tr></thead>
                  <tbody>
                    {/* v1.10.6 — audit L13: HSN code is unique per row. */}
                    {hsnRows.map((r, i) => (
                      <tr key={r.hsn || `hsn-${i}`}>
                        <td><span className="invoice-badge">{r.hsn}</span></td>
                        <td className="font-medium">{r.description}</td>
                        <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.cgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.sgst)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(r.totalTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td colSpan={2}>Total</td>
                    <td style={{ textAlign: 'right' }}>{hsnRows.reduce((s, r) => s + r.quantity, 0)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.taxable, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.cgst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.sgst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.igst, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(hsnRows.reduce((s, r) => s + r.totalTax, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Document Summary — Table 13 */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Document Summary — Table 13</h3></div>
            {Object.keys(docSummary).length === 0 ? (
              <p style={{ padding: '1rem 1.25rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No documents issued.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: '400px' }}>
                  <thead><tr><th>Document Type</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Total Issued</th></tr></thead>
                  <tbody>
                    {Object.entries(docSummary).map(([prefix, d]) => (
                      <tr key={prefix}>
                        <td className="font-medium">{d.type}</td>
                        <td className="text-muted">{d.from}</td>
                        <td className="text-muted">{d.to}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold">{d.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grand Summary */}
          <div className="glass-panel">
            <div className="table-header"><h3>GSTR-1 Summary Totals</h3></div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">B2B Sales</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2bTotals.total)}</td></tr>
                  <tr><td className="font-medium">B2C Sales</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(b2cTotals.total)}</td></tr>
                </tbody>
                <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                  <td>Grand Total</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.cgst)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.sgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.igst)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.total)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===================== GSTR-3B TAB ===================== */}
      {activeTab === 'gstr3b' && (
        <>
          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={exportGSTR3B} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Download size={13} /> 3B CSV</button>
            <button className="btn btn-primary" onClick={exportGSTR3BJSON} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}><Upload size={13} /> 3B JSON</button>
            {!periodFiling.gstr3b && (
              <button className="btn btn-secondary" onClick={() => markFiled('gstr3b')} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', marginLeft: 'auto', color: '#059669', borderColor: '#bbf7d0' }}>
                <CheckCircle size={13} /> Mark Filed
              </button>
            )}
          </div>

          {/* Table 3.1 — Output Tax */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 3.1 — Outward Supplies & Tax</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '600px' }}>
                <thead><tr><th>Nature of Supplies</th><th style={{ textAlign: 'right' }}>Taxable Value</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">(a) Outward taxable supplies (other than zero-rated, nil-rated and exempted)</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(grandTotals.sgst)}</td></tr>
                  <tr><td className="font-medium">(b) Zero-rated supplies</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td></tr>
                  <tr><td className="font-medium">(c) Non-GST supplies</td><td style={{ textAlign: 'right' }}>{formatCurrency(0)}</td><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>N/A</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 3.2 — Inter-state Supplies */}
          {interStateB2CRows.length > 0 && (
            <div className="glass-panel mb-4">
              <div className="table-header"><h3>Table 3.2 — Inter-state Supplies to Unregistered Persons</h3></div>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: '400px' }}>
                  <thead><tr><th>Place of Supply</th><th style={{ textAlign: 'right' }}>Taxable Value</th><th style={{ textAlign: 'right' }}>IGST</th></tr></thead>
                  <tbody>
                    {interStateB2CRows.map((r, i) => (
                      <tr key={i}><td className="font-medium">{r.pos}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.igst)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(interStateB2CRows.reduce((s, r) => s + r.taxable, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(interStateB2CRows.reduce((s, r) => s + r.igst, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Table 4 — ITC */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 4 — Eligible ITC (from Expenses & Purchases)</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '500px' }}>
                <thead><tr><th>Details</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">(A) ITC Available — All other ITC</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.sgst)}</td></tr>
                  <tr className="font-bold"><td>Net ITC Available</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(itcFromExpenses.sgst)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="field-hint" style={{ padding: '0.75rem 1.25rem' }}>
              ITC calculated from Expense Tracker and Purchase Bills entries with GST. Verify against GSTR-2B on the GST portal for actual eligible ITC.
            </p>
          </div>

          {/* Table 6 — Tax Payment */}
          <div className="glass-panel mb-4">
            <div className="table-header"><h3>Table 6 — Tax Payment Summary</h3></div>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: '600px' }}>
                <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>IGST</th><th style={{ textAlign: 'right' }}>CGST</th><th style={{ textAlign: 'right' }}>SGST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  <tr><td className="font-medium">Output Tax Liability</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(outputTax.sgst)}</td><td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(outputTax.igst + outputTax.cgst + outputTax.sgst)}</td></tr>
                  <tr><td className="font-medium" style={{ color: '#059669' }}>Less: ITC Claimed</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(itcFromExpenses.igst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(itcFromExpenses.cgst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(itcFromExpenses.sgst)}</td><td style={{ textAlign: 'right', color: '#059669' }}>-{formatCurrency(itcFromExpenses.igst + itcFromExpenses.cgst + itcFromExpenses.sgst)}</td></tr>
                </tbody>
                <tfoot><tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                  <td>Net Tax Payable</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(netTax.igst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(netTax.cgst)}</td><td style={{ textAlign: 'right' }}>{formatCurrency(netTax.sgst)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--primary)', fontSize: '1.1rem' }}>{formatCurrency(netTax.igst + netTax.cgst + netTax.sgst)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          {/* Net Payable */}
          <div className="glass-panel" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.25rem' }}>Net GST Payable</p>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
              {formatCurrency(netPayable)}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              {netPayable === 0 ? 'ITC covers your liability' : 'Pay via Electronic Cash Ledger'}
            </p>
          </div>
        </>
      )}

      {/* ===================== GSTR-2B RECONCILIATION TAB ===================== */}
      {activeTab === 'gstr2b' && (() => {
        const reconRows = buildReconciliation(gstr2bData, purchases);
        const stats = reconRows.reduce((acc, r) => {
          acc.total += 1;
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, { total: 0, matched: 0, amount_mismatch: 0, book_only: 0, twob_only: 0 });
        const visibleRows = gstr2bFilter === 'all' ? reconRows : reconRows.filter(r => r.status === gstr2bFilter);

        const exportReconCSV = () => {
          if (reconRows.length === 0) { toast('Nothing to export', 'warning'); return; }
          downloadCSV('GSTR2B_Reconciliation.csv',
            ['Status', 'Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Invoice Date', '2B Value', 'Books Value', 'Diff', '2B Taxable', 'Books Taxable', '2B IGST', '2B CGST', '2B SGST', 'ITC Available'],
            reconRows.map(r => [
              r.status, r.ctin, r.supplier, r.invoiceNumber, r.date,
              r.twoBVal.toFixed(2), r.bookVal.toFixed(2), (r.twoBVal - r.bookVal).toFixed(2),
              r.twoBTaxable.toFixed(2), r.bookTaxable.toFixed(2),
              r.twoBIgst.toFixed(2), r.twoBCgst.toFixed(2), r.twoBSgst.toFixed(2),
              r.itcAvailable ? 'Y' : 'N',
            ])
          );
          toast('Reconciliation CSV downloaded', 'success');
        };

        // Use the global .status-pill utility — color flows via the --pill-color CSS var,
        // background is auto-derived with a 14% mix so dark/light look identical.
        const STATUS_BADGES = {
          matched:         { label: '✓ Matched',         color: 'var(--success)' },
          amount_mismatch: { label: '⚠ Amount mismatch', color: '#d97706' },
          book_only:       { label: '⚠ Books only',      color: 'var(--danger)' },
          twob_only:       { label: '⚠ 2B only',         color: 'var(--purple)' },
        };

        return (
          <>
            {/* Help banner */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong>How to use:</strong> Download your GSTR-2B JSON from the GST portal
                (<a href="https://services.gst.gov.in/services/auth/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>services.gst.gov.in</a>
                {' '}→ Returns → GSTR-2B → Download JSON), then click <strong>Import 2B JSON</strong> below.
                We match each 2B entry against your <em>Purchase Bills</em> by supplier GSTIN + invoice number, and flag mismatches so you can claim ITC accurately.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={gstr2bInputRef} type="file" accept=".json,application/json" onChange={handleImport2B} style={{ display: 'none' }} />
              <button className="btn btn-primary" onClick={() => gstr2bInputRef.current?.click()} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                <Upload size={13} /> Import 2B JSON
              </button>
              {gstr2bData && (
                <>
                  <button className="btn btn-secondary" onClick={exportReconCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                    <Download size={13} /> Export reconciliation CSV
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setGstr2bData(null); setGstr2bFilter('all'); }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                    Clear
                  </button>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Imported for {gstr2bData.gstin || '?'} · period {gstr2bData.rtnprd || gstr2bData.fp || '?'}
                  </span>
                </>
              )}
            </div>

            {!gstr2bData && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <CheckCircle size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Import your GSTR-2B JSON to reconcile against your purchase records.</p>
                {purchases.length === 0 && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#d97706' }}>
                    ⚠ You have no purchase bills recorded yet. Add some in the Purchases view first, otherwise everything will show as "2B only".
                  </p>
                )}
              </div>
            )}

            {gstr2bData && (
              <>
                {/* Summary stats */}
                <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    {[
                      { k: 'all', label: 'Total entries', count: stats.total, color: 'var(--text-primary)' },
                      { k: 'matched', label: '✓ Matched', count: stats.matched, color: '#059669' },
                      { k: 'amount_mismatch', label: '⚠ Mismatched', count: stats.amount_mismatch, color: '#d97706' },
                      { k: 'book_only', label: '⚠ Books only', count: stats.book_only, color: '#dc2626' },
                      { k: 'twob_only', label: '⚠ 2B only', count: stats.twob_only, color: '#7c3aed' },
                    ].map(s => (
                      <button key={s.k}
                        onClick={() => setGstr2bFilter(s.k)}
                        className={gstr2bFilter === s.k ? 'type-chip type-chip-active' : 'type-chip'}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem', padding: '0.5rem 0.7rem', textAlign: 'left' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.label}</span>
                        <strong style={{ fontSize: '1.05rem', color: s.color }}>{s.count}</strong>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <div className="glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Supplier</th>
                        <th>Invoice No.</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>2B Value</th>
                        <th style={{ textAlign: 'right' }}>Books Value</th>
                        <th style={{ textAlign: 'right' }}>Diff</th>
                        <th>ITC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.length === 0 ? (
                        <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No entries match this filter.</td></tr>
                      ) : visibleRows.map((r, i) => {
                        const badge = STATUS_BADGES[r.status];
                        const diff = r.twoBVal - r.bookVal;
                        return (
                          // v1.10.6 — audit L13: use invoice + GSTIN combo (stable across filters).
                          <tr key={`${r.gstin || 'x'}-${r.invoice || i}`}>
                            <td><span className="status-pill" style={{ '--pill-color': badge.color }}>{badge.label}</span></td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{r.supplier || '—'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.ctin}</div>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.invoiceNumber}</td>
                            <td style={{ fontSize: '0.78rem' }}>{r.date || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{r.twoBVal > 0 ? formatCurrency(r.twoBVal) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{r.bookVal > 0 ? formatCurrency(r.bookVal) : '—'}</td>
                            <td style={{ textAlign: 'right', color: Math.abs(diff) > 1 ? '#dc2626' : 'var(--text-muted)', fontWeight: Math.abs(diff) > 1 ? 600 : 400 }}>
                              {diff !== 0 ? (diff > 0 ? '+' : '') + formatCurrency(diff) : '—'}
                            </td>
                            <td style={{ fontSize: '0.78rem', color: r.itcAvailable ? '#059669' : '#94a3b8' }}>{r.itcAvailable ? '✓' : '✗'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ===================== TDS / TCS REPORT TAB ===================== */}
      {activeTab === 'tds' && (() => {
        // Aggregate TDS (deducted by buyers) and TCS (collected by us) across all bills
        // in the filtered period, grouped by client + section + quarter. The data feeds
        // Form 26Q (TDS quarterly return) and Form 27EQ (TCS quarterly return) inputs.
        const tdsRows = [];
        const tcsRows = [];
        filteredBills.forEach(bill => {
          const t = bill.data?.totals || {};
          const opt = bill.data?.invoiceOptions || {};
          const client = bill.data?.client || {};
          const date = new Date(bill.invoiceDate);
          if (isNaN(date.getTime())) return;
          const m = date.getMonth();
          const fyQuarter = m >= 3 && m <= 5 ? 'Q1' : m >= 6 && m <= 8 ? 'Q2' : m >= 9 && m <= 11 ? 'Q3' : 'Q4';
          const taxable = t.taxableAmount ?? ((t.subtotal || 0) - (t.totalDiscount || 0));
          if (t.tdsAmount > 0) {
            tdsRows.push({
              clientName: client.name || bill.clientName || '—',
              clientGstin: client.gstin || '',
              clientPan: client.pan || '',
              section: opt.tdsSection || '194Q',
              rate: opt.tdsRate || 0,
              quarter: fyQuarter,
              invoiceNumber: bill.invoiceNumber,
              date: bill.invoiceDate,
              taxable,
              tds: t.tdsAmount,
            });
          }
          if (t.tcsAmount > 0) {
            tcsRows.push({
              clientName: client.name || bill.clientName || '—',
              clientGstin: client.gstin || '',
              clientPan: client.pan || '',
              section: opt.tcsSection || '206C(1H)',
              rate: opt.tcsRate || 0,
              quarter: fyQuarter,
              invoiceNumber: bill.invoiceNumber,
              date: bill.invoiceDate,
              taxable,
              tcs: t.tcsAmount,
            });
          }
        });

        const tdsTotal = tdsRows.reduce((acc, r) => ({ taxable: acc.taxable + r.taxable, tds: acc.tds + r.tds }), { taxable: 0, tds: 0 });
        const tcsTotal = tcsRows.reduce((acc, r) => ({ taxable: acc.taxable + r.taxable, tcs: acc.tcs + r.tcs }), { taxable: 0, tcs: 0 });

        const tdsBySection = {};
        tdsRows.forEach(r => {
          const k = `${r.section}_${r.quarter}`;
          if (!tdsBySection[k]) tdsBySection[k] = { section: r.section, quarter: r.quarter, count: 0, taxable: 0, tds: 0 };
          tdsBySection[k].count += 1; tdsBySection[k].taxable += r.taxable; tdsBySection[k].tds += r.tds;
        });
        const tcsBySection = {};
        tcsRows.forEach(r => {
          const k = `${r.section}_${r.quarter}`;
          if (!tcsBySection[k]) tcsBySection[k] = { section: r.section, quarter: r.quarter, count: 0, taxable: 0, tcs: 0 };
          tcsBySection[k].count += 1; tcsBySection[k].taxable += r.taxable; tcsBySection[k].tcs += r.tcs;
        });

        const exportTDSCSV = () => {
          if (tdsRows.length === 0) { toast('No TDS entries in this period', 'warning'); return; }
          downloadCSV('TDS_Receivable_Report.csv',
            ['Quarter', 'Section', 'Rate %', 'Invoice No.', 'Date', 'Client', 'Client GSTIN', 'Client PAN', 'Taxable Value', 'TDS Amount'],
            tdsRows.map(r => [r.quarter, r.section, r.rate, r.invoiceNumber, r.date, r.clientName, r.clientGstin, r.clientPan, r.taxable.toFixed(2), r.tds.toFixed(2)])
          );
          toast('TDS report exported', 'success');
        };
        const exportTCSCSV = () => {
          if (tcsRows.length === 0) { toast('No TCS entries in this period', 'warning'); return; }
          downloadCSV('TCS_Collected_Report.csv',
            ['Quarter', 'Section', 'Rate %', 'Invoice No.', 'Date', 'Client', 'Client GSTIN', 'Client PAN', 'Taxable Value', 'TCS Amount'],
            tcsRows.map(r => [r.quarter, r.section, r.rate, r.invoiceNumber, r.date, r.clientName, r.clientGstin, r.clientPan, r.taxable.toFixed(2), r.tcs.toFixed(2)])
          );
          toast('TCS report exported', 'success');
        };

        return (
          <>
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong>What this is:</strong> Aggregates TDS (tax deducted by your clients on payments to you — Section 194C/194J/194Q etc.)
                and TCS (tax collected by you from clients — Section 206C(1H)/52 etc.) across the selected period.
                Use the CSV exports as input for <strong>Form 26Q</strong> (TDS) and <strong>Form 27EQ</strong> (TCS) quarterly returns,
                or hand the file to your CA. Filed at <a href="https://www.tin-nsdl.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>tin-nsdl.com</a>.
              </p>
            </div>

            {/* TDS section */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>TDS Receivable (deducted by clients)</h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Total TDS your clients should have deducted. You can claim this as credit against your own income tax.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={exportTDSCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} disabled={tdsRows.length === 0}>
                  <Download size={13} /> Export TDS CSV
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices with TDS</p>
                  <strong style={{ fontSize: '1rem' }}>{tdsRows.length}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable value</p>
                  <strong style={{ fontSize: '1rem' }}>{formatCurrency(tdsTotal.taxable)}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Total TDS receivable</p>
                  <strong style={{ fontSize: '1rem', color: '#0f766e' }}>{formatCurrency(tdsTotal.tds)}</strong>
                </div>
              </div>
              {Object.values(tdsBySection).length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                    <thead>
                      <tr><th>Quarter</th><th>Section</th><th>Invoices</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>TDS</th></tr>
                    </thead>
                    <tbody>
                      {Object.values(tdsBySection).sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section)).map((r, i) => (
                        <tr key={`tds-${i}`}>
                          <td>{r.quarter}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.section}</td>
                          <td>{r.count}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                          <td style={{ textAlign: 'right', color: '#0f766e', fontWeight: 600 }}>{formatCurrency(r.tds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '0.75rem' }}>
                  No invoices with TDS in this period. Enable TDS on an invoice via <em>Customize → TDS</em>.
                </p>
              )}
            </div>

            {/* TCS section */}
            <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>TCS Collected (from clients)</h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    TCS you collected from buyers. Must be deposited to the Income Tax Department and reported in Form 27EQ quarterly.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={exportTCSCSV} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} disabled={tcsRows.length === 0}>
                  <Download size={13} /> Export TCS CSV
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Invoices with TCS</p>
                  <strong style={{ fontSize: '1rem' }}>{tcsRows.length}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Taxable value</p>
                  <strong style={{ fontSize: '1rem' }}>{formatCurrency(tcsTotal.taxable)}</strong>
                </div>
                <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)' }}>
                  <p className="stat-label" style={{ margin: 0, fontSize: '0.7rem' }}>Total TCS collected</p>
                  <strong style={{ fontSize: '1rem', color: '#d97706' }}>{formatCurrency(tcsTotal.tcs)}</strong>
                </div>
              </div>
              {Object.values(tcsBySection).length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                    <thead>
                      <tr><th>Quarter</th><th>Section</th><th>Invoices</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>TCS</th></tr>
                    </thead>
                    <tbody>
                      {Object.values(tcsBySection).sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section)).map((r, i) => (
                        <tr key={`tcs-${i}`}>
                          <td>{r.quarter}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.section}</td>
                          <td>{r.count}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(r.taxable)}</td>
                          <td style={{ textAlign: 'right', color: '#d97706', fontWeight: 600 }}>{formatCurrency(r.tcs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', padding: '0.75rem' }}>
                  No invoices with TCS in this period. Enable TCS on an invoice via <em>Customize → TCS</em>.
                </p>
              )}
            </div>
          </>
        );
      })()}

      {/* ===================== FILING GUIDE TAB ===================== */}
      {activeTab === 'guide' && (
        <>
          {/* Quick Start */}
          <div className="glass-panel" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              <strong>Steps:</strong> Review GSTR-1 & 3B tabs → Export JSON → Upload to gst.gov.in → File GSTR-1 first, then GSTR-3B.
              <span style={{ color: 'var(--text-muted)' }}> | Due: R1 by 11th, 3B by 20th of next month | Late fee: ₹50/day</span>
            </p>
          </div>

          {/* Tab selector within guide */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[
              { id: 'regular', label: 'Regular Filing (With Sales)' },
              { id: 'nil', label: 'NIL Return (No Sales)' },
              { id: 'errors', label: 'Common Errors & Fixes' },
            ].map(tab => (
              <button key={tab.id} className={`btn ${guideTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGuideTab(tab.id)} style={{ fontSize: '0.82rem' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {guideTab === 'regular' && (
            <>
              <StepList steps={GSTR1_STEPS} title="GSTR-1 — Sales Return (File This First)" />

              <div className="glass-panel p-4 mb-4" style={{ background: '#f0fdf4' }}>
                <h4 style={{ color: '#059669', marginBottom: '0.5rem', fontSize: '0.9rem' }}>GSTR-1 Pro Tips</h4>
                <ul style={{ fontSize: '0.82rem', color: '#047857', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                  <li><strong>Fastest method:</strong> Export GSTR-1 JSON from the GSTR-1 tab above → Go to GST portal → GSTR-1 → Prepare Offline → Download Offline Tool → Import JSON → Upload. Saves 90% of time.</li>
                  <li>If turnover {'<'} ₹5 Cr, opt for QRMP scheme — file quarterly instead of monthly. Apply via Services → User Services → Opt-in for QRMP.</li>
                  <li>Amendments to previous period invoices: Use Table 9A (not 4A). You can amend within the September return of the following FY.</li>
                  <li>Export invoices (zero-rated): Report in Table 6A with shipping bill details.</li>
                  <li>Advances received: Report in Table 11A (tax on advance received) — adjust when invoice is issued (Table 11B).</li>
                </ul>
              </div>

              <StepList steps={GSTR3B_STEPS} title="GSTR-3B — Summary Return + Tax Payment (File After GSTR-1)" />

              <div className="glass-panel p-4 mb-4" style={{ background: '#eff6ff' }}>
                <h4 style={{ color: 'var(--primary)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>GSTR-3B Pro Tips</h4>
                <ul style={{ fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                  <li><strong>From July 2025:</strong> Table 3 auto-populates from GSTR-1 — just VERIFY, don't re-enter values.</li>
                  <li><strong>ITC matching:</strong> Always check GSTR-2B statement BEFORE claiming ITC. Go to Returns → GSTR-2B → Download. Only claim ITC that appears in GSTR-2B.</li>
                  <li><strong>ITC utilization order (Section 49):</strong> IGST credit first (against IGST → CGST → SGST), then CGST (against CGST → IGST), then SGST (against SGST → IGST).</li>
                  <li><strong>Payment:</strong> Use Electronic Credit Ledger (ITC) first. Pay remaining via Electronic Cash Ledger. Create challan via Services → Payments → Create Challan.</li>
                  <li><strong>Interest calculation:</strong> If you file late, interest is 18% p.a. calculated on tax payable (not total liability). Interest starts from day after due date.</li>
                  <li><strong>Reverse charge:</strong> If you paid RCM (restaurant/legal/GTA services), report in 3.1(d) AND claim ITC in Table 4(A)(3).</li>
                </ul>
              </div>
            </>
          )}

          {guideTab === 'nil' && (
            <>
              <div className="glass-panel p-4 mb-4" style={{ borderLeft: '4px solid #f59e0b', background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
                <h4 style={{ color: '#92400e', marginBottom: '0.5rem', fontSize: '0.9rem' }}>When to File NIL Return</h4>
                <ul style={{ fontSize: '0.85rem', color: '#a16207', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                  <li>You had <strong>ZERO outward supplies</strong> (no sales/services) during the period</li>
                  <li>You have <strong>NO input tax credit</strong> to claim</li>
                  <li>You have <strong>NO tax liability</strong> (including reverse charge)</li>
                  <li>You have <strong>NO inward supplies</strong> liable to reverse charge</li>
                  <li>If ANY of the above has a value, you MUST file a regular return — not NIL</li>
                </ul>
                <p style={{ fontSize: '0.85rem', color: '#92400e', marginTop: '0.5rem', fontWeight: 600 }}>
                  MANDATORY: You must file NIL returns every month/quarter even with zero activity. Non-filing for 6 continuous months can result in suo-motu GSTIN cancellation under Section 29(2)(c).
                </p>
              </div>

              <StepList steps={NIL_GSTR1_STEPS} title="NIL GSTR-1 — File First (Even with Zero Sales)" />
              <StepList steps={NIL_GSTR3B_STEPS} title="NIL GSTR-3B — File After NIL GSTR-1" />

              <div className="glass-panel p-4" style={{ background: '#f0fdf4' }}>
                <h4 style={{ color: '#059669', marginBottom: '0.5rem', fontSize: '0.9rem' }}>NIL Return Quick Summary</h4>
                <ul style={{ fontSize: '0.82rem', color: '#047857', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                  <li>NIL GSTR-1 and NIL GSTR-3B are <strong>separate returns</strong> — file both</li>
                  <li>NIL filing takes 2-3 minutes per return — just login, verify zeros, submit, file</li>
                  <li>Late fee for NIL: ₹20/day (₹10 CGST + ₹10 SGST), capped at ₹500 per return</li>
                  <li>You can file NIL returns via SMS: Send <code>NIL space GSTIN space Return Period</code> to 14409. Verify with OTP.</li>
                  <li>QRMP users filing quarterly: NIL return covers the entire quarter</li>
                  <li>Even if you had no sales but had purchases with GST → file REGULAR return (not NIL) to claim ITC</li>
                </ul>
              </div>
            </>
          )}

          {guideTab === 'errors' && (
            <>
              <div className="glass-panel mb-4">
                <div className="table-header"><h3>Common GST Portal Errors & How to Fix Them</h3></div>
                <div style={{ padding: '1rem 1.25rem' }}>
                  {[
                    { error: '"Invalid GSTIN" when adding B2B invoice', fix: 'Verify the client GSTIN on the portal: Services → User Services → Search Taxpayer. The GSTIN must be active. Cancelled/surrendered GSTINs are rejected. Also check for typos — GSTIN is 15 characters: 2 digits (state) + 10 chars (PAN) + 1 entity code + 1 check digit.' },
                    { error: '"Invoice number already exists for this recipient"', fix: 'Each invoice number must be unique per GSTIN per period. If you\'re re-filing after amendment, use Table 9A for amendments, not Table 4A. If duplicate, check if invoice was already reported in a previous period.' },
                    { error: '"Place of Supply mismatch" or wrong tax type', fix: 'If supply is INTER-STATE (different states), only IGST applies. If INTRA-STATE (same state), only CGST+SGST. POS must match the buyer\'s state for inter-state. Common mistake: Delhi business billing Delhi client but selecting different POS.' },
                    { error: '"Invoice date is not within the return period"', fix: 'Invoice date must fall within the filing period. E.g., for March 2026 return, dates must be 01/03/2026 to 31/03/2026. If you missed an invoice, report in the current period — it\'s allowed but must be before September of next FY.' },
                    { error: '"HSN code is invalid" in Table 12', fix: 'Use valid HSN codes from the official HSN Master (downloadable from cbic.gov.in). Services use SAC codes starting with 99. Common: 998314 (IT services), 9954 (construction), 9983 (professional services). The portal validates against the master list.' },
                    { error: '"GSTR-3B cannot be filed — GSTR-1 not filed"', fix: 'You MUST file GSTR-1 before GSTR-3B for the same period. Go back and file GSTR-1 first. This is a hard block — no workaround.' },
                    { error: '"ITC claimed exceeds GSTR-2B available ITC"', fix: 'You cannot claim more ITC than what\'s in your auto-populated GSTR-2B statement. Check Returns → GSTR-2B to see eligible ITC. If a supplier hasn\'t filed their GSTR-1, their invoice won\'t appear in your GSTR-2B and you can\'t claim that ITC yet.' },
                    { error: '"Previous period return not filed"', fix: 'GST returns must be filed sequentially. You cannot file March return if February is pending. File all pending returns in order starting from the earliest unfiled period.' },
                    { error: '"Taxable value and tax amount mismatch"', fix: 'The portal validates that tax = taxable value × rate. E.g., if taxable value is ₹10,000 at 18%, IGST must be ₹1,800 (or CGST ₹900 + SGST ₹900). Rounding differences up to ₹1 are allowed.' },
                    { error: '"EVC generation failed" or "OTP not received"', fix: 'Try after 5 minutes. Check registered mobile number is correct (Profile → Update). For companies, EVC is not available — use DSC only. If DSC fails, check USB token is inserted and emsigner utility is running.' },
                    { error: '"Challan amount does not match liability"', fix: 'Create challan AFTER submitting GSTR-3B, not before. The challan amount must match the "Tax payable in cash" column. If you overpaid, excess stays in Electronic Cash Ledger for future use or refund.' },
                  ].map((item, i) => (
                    <div key={i} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: i < 10 ? '1px solid var(--border)' : 'none' }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dc2626', marginBottom: '0.25rem' }}>Error: {item.error}</p>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>Fix: {item.fix}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel p-4" style={{ background: '#f8fafc' }}>
                <h4 style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>Key GST Rules to Remember</h4>
                <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                  <li><strong>Section 16(4):</strong> ITC for any invoice must be claimed by the due date of September return of the following FY, or the date of filing annual return — whichever is earlier.</li>
                  <li><strong>Section 34:</strong> Credit notes must be issued before September 30 following the end of FY of the original invoice or annual return filing — whichever is earlier.</li>
                  <li><strong>Section 31:</strong> Tax invoice must be issued at or before the time of supply. For services, within 30 days of supply.</li>
                  <li><strong>Section 49:</strong> ITC utilization order is mandatory: IGST first (against IGST→CGST→SGST), then CGST (→CGST→IGST), then SGST (→SGST→IGST). Cross-utilization of CGST↔SGST is NOT allowed.</li>
                  <li><strong>Rule 36(4):</strong> ITC can only be claimed for invoices that appear in GSTR-2B. No provisional ITC beyond GSTR-2B.</li>
                  <li><strong>Section 50:</strong> Interest on late payment is 18% p.a. on NET tax payable (after ITC). Calculated from the day after due date to date of payment.</li>
                  <li><strong>Section 73/74:</strong> Tax department can issue notice for short payment within 3 years (73) or 5 years for fraud (74). Maintain all records for at least 6 years.</li>
                  <li><strong>Section 29(2)(c):</strong> GSTIN cancellation if returns not filed for 6+ continuous months (quarterly filers: 2 consecutive quarters).</li>
                  <li><strong>E-way Bill:</strong> Cannot generate e-way bills if GSTR-3B not filed for 2+ consecutive months.</li>
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}