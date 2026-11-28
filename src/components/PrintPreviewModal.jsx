import { useEffect, useRef, useState } from 'react';
import { X, Printer, Download, Loader } from 'lucide-react';
import InvoicePreview from './InvoicePreview';
import TwoUpSheetPreview from './TwoUpSheetPreview';
import { getPaperSize } from '../utils';
import { getPrintSettings } from '../utils/printSettings';

/**
 * Print preview modal.
 *
 * Renders <InvoicePreview> with the same props the parent passes to the
 * on-screen preview — same component, same output. When the user clicks
 * Print, the modal closes and calls the parent's `onPrint` callback,
 * which runs the existing print pipeline against the on-screen preview
 * via `printRef`.
 */
export default function PrintPreviewModal({
  isOpen, onClose, onPrint, onDownloadPdf,
  profile, client, details, items, totals, invoiceType,
  customTerms, customNotes, extraSections, invoiceOptions,
  twoPerPage, onToggleTwoPerPage,
}) {
  const [printing, setPrinting] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !printing) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, printing, onClose]);

  if (!isOpen) return null;

  const printSettings = getPrintSettings();
  const isTwoUp = typeof twoPerPage === 'boolean' ? twoPerPage : Boolean(printSettings.twoPerPageEnabled);
  const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
  const paperLabel = isTwoUp && paperCfg.kind !== 'thermal'
    ? 'A4 Portrait · 2 Bills on 1 Page (Client Copy + Office Copy)'
    : (paperCfg.label || `${paperCfg.widthMm}mm`);

  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      onClose?.();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
      await onPrint?.();
    } finally {
      setPrinting(false);
    }
  };

  const handleDownload = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      onClose?.();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
      await onDownloadPdf?.();
    } finally {
      setPrinting(false);
    }
  };

  const previewScale = isTwoUp && paperCfg.kind !== 'thermal' ? 0.68 : 0.72;

  const renderInvoice = () => (
    <InvoicePreview
      previewOnly
      profile={profile} client={client} details={details}
      items={items} totals={totals} invoiceType={invoiceType}
      customTerms={customTerms} customNotes={customNotes}
      extraSections={extraSections} options={invoiceOptions}
    />
  );

  return (
    <div className="modal-overlay print-preview-overlay"
      role="dialog" aria-modal="true" aria-labelledby="print-preview-title"
      onClick={(e) => { if (e.target === e.currentTarget && !printing) onClose(); }}
      style={{ zIndex: 10001 }}>
      <div ref={modalRef} className="modal-content print-preview-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 'min(960px, 96vw)',
          maxHeight: '92vh',
          padding: 0,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.9rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card-bg)',
        }}>
          <div>
            <h3 id="print-preview-title"
              style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Printer size={18} style={{ color: 'var(--primary)' }} />
              Print preview
            </h3>
            <p style={{ margin: '0.2rem 0 0 1.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {paperLabel} — click Print to send to your printer
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {onToggleTwoPerPage && paperCfg.kind !== 'thermal' && (
              <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => !isTwoUp && onToggleTwoPerPage(true)}
                  style={{
                    border: 0, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600, padding: '0.32rem 0.6rem',
                    background: isTwoUp ? 'var(--primary)' : 'var(--bg-secondary)',
                    color: isTwoUp ? '#fff' : 'var(--text)',
                  }}
                >
                  2 Bills / Page
                </button>
                <button
                  type="button"
                  onClick={() => isTwoUp && onToggleTwoPerPage(false)}
                  style={{
                    border: 0, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600, padding: '0.32rem 0.6rem',
                    background: !isTwoUp ? 'var(--primary)' : 'var(--bg-secondary)',
                    color: !isTwoUp ? '#fff' : 'var(--text)',
                  }}
                >
                  1 Bill / Page
                </button>
              </div>
            )}
            <button type="button" className="icon-btn" onClick={onClose} disabled={printing}
              title="Close (Esc)" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0,
          overflow: 'auto',
          padding: '1.25rem 0.75rem',
          background: 'var(--bg-secondary)',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        }}>
          <div style={{
            background: '#fff',
            padding: '0.35rem',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.18)',
            borderRadius: 4,
            transform: `scale(${previewScale})`,
            transformOrigin: 'top center',
            marginBottom: `${Math.round((1 - previewScale) * -400)}px`,
          }}>
            <TwoUpSheetPreview
              enabled={isTwoUp && paperCfg.kind !== 'thermal'}
              showLabels={printSettings.twoPerPageShowLabels !== false}
              showCutLine={printSettings.twoPerPageShowCutLine !== false}
              leftLabel={printSettings.twoPerPageLeftLabel || 'CLIENT COPY'}
              rightLabel={printSettings.twoPerPageRightLabel || 'OFFICE / SELF COPY'}
              renderPrimary={renderInvoice}
              renderSecondary={renderInvoice}
            />
          </div>
        </div>

        <div style={{
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid var(--border)',
          background: 'var(--card-bg)',
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
          justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 'auto' }}>
            {isTwoUp && paperCfg.kind !== 'thermal'
              ? 'Two shrunk bills stacked top & bottom on A4 Portrait — tear across the middle'
              : 'Preview is scaled — actual print will be full-size on A4'}
          </span>
          {onDownloadPdf && (
            <button type="button" className="btn btn-secondary"
              onClick={handleDownload} disabled={printing}
              style={{ fontSize: '0.85rem', padding: '0.5rem 0.9rem' }}
              title="Save as PDF instead">
              <Download size={15} /> Download PDF
            </button>
          )}
          <button type="button" className="btn btn-secondary"
            onClick={onClose} disabled={printing}
            style={{ fontSize: '0.85rem', padding: '0.5rem 0.9rem' }}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary"
            onClick={handlePrint} disabled={printing}
            style={{ fontSize: '0.85rem', padding: '0.5rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {printing
              ? <><Loader size={15} className="spin" /> Sending…</>
              : <><Printer size={15} /> Print</>}
          </button>
        </div>
      </div>
    </div>
  );
}