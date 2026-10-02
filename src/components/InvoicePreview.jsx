import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import DOMPurify from 'dompurify';
import { numberToWords, INVOICE_TYPES, getCountryConfig, getAccountById, getPaperSize, resolveLineDiscount } from '../utils';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p','br','b','strong','i','em','u','ul','ol','li','a','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','span','div','blockquote','code','pre','hr'],
  ALLOWED_ATTR: ['href','title','colspan','rowspan','target','rel'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
};

const safeHtml = (html) => {
  if (!html) return '';
  try { return DOMPurify.sanitize(String(html), SANITIZE_CONFIG); }
  catch { return ''; }
};

const InvoicePreview = React.forwardRef(({ profile, client, details = {}, items = [], totals = {}, invoiceType = 'tax-invoice', customTerms, customNotes, extraSections = [], options = {}, previewOnly = false }, ref) => {

  const docTitle = options?.customTitle || (
    invoiceType === 'proforma' ? 'PROFORMA INVOICE / ESTIMATE' :
    invoiceType === 'bill-of-supply' ? 'BILL OF SUPPLY' :
    invoiceType === 'composition' ? 'BILL OF SUPPLY (COMPOSITION)' :
    invoiceType === 'credit-note' ? 'CREDIT NOTE' :
    invoiceType === 'delivery-challan' ? 'DELIVERY CHALLAN' :
    'GST INVOICE'
  );

  const businessState = profile?.state?.trim().toLowerCase();
  const clientState = client?.state?.trim().toLowerCase();
  const isInterstate = (typeof totals?.igst === 'number' && totals.igst > 0)
    || !!client?.isSEZ
    || (details?.placeOfSupply && businessState && details.placeOfSupply.toLowerCase() !== businessState)
    || (businessState && clientState && businessState !== clientState);
  const isIntraUT = !!totals?.isUtgst || !!totals?.isIntraUT;

  const typeConfig = INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'];
  const sellerCC = getCountryConfig(profile?.country);

  const account = options.paymentAccountSnapshot || getAccountById(profile, options.selectedAccountId);

  const opt = (key, fallback = true) => options[key] !== undefined ? options[key] : fallback;
  const showGST          = opt('showGST', typeConfig.showGST);
  const showHSN          = opt('showHSN', true);
  const showUPI          = opt('showUPI', true);
  const showLogo         = opt('showLogo', true);
  const showBankDetails  = opt('showBankDetails', true);
  const showAmountWords  = opt('showAmountWords', true);
  const showSignature    = opt('showSignature', true);
  const showRoundOff     = opt('showRoundOff', true);
  const showNotes        = opt('showNotes', true);
  const showExtraSec     = opt('showExtraSections', true);
  const showPoNumber     = opt('showPoNumber', true);
  const showPharmaFields = opt('showPharmaFields', true);

  const amountInWords = (num) => numberToWords(num);

  const [qrDataUrl, setQrDataUrl] = useState('');
  const upiId = account?.upiId || profile?.upiId || '';
  useEffect(() => {
    if (!showUPI || !upiId || !totals?.total) {
      setQrDataUrl('');
      return;
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(profile?.businessName || '')}&am=${Number(totals.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${details?.invoiceNumber || 'Invoice'}`)}`;
    QRCode.toDataURL(upiUrl, { width: 120, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [showUPI, upiId, profile?.businessName, totals?.total, details?.invoiceNumber]);

  const paperCfg = getPaperSize(options.paperSize, options);
  const isThermal = paperCfg.kind === 'thermal';
  const containerStyle = {
    width: `${paperCfg.widthMm}mm`,
    minHeight: paperCfg.kind === 'sheet' ? `${paperCfg.heightMm}mm` : undefined,
    ...(isThermal ? { fontFamily: '"Courier New", monospace', fontSize: paperCfg.widthMm >= 80 ? '10.5px' : '9px' } : {}),
  };

  const standardSlabs = [0, 0.1, 0.25, 3, 5, 12, 18, 28];
  const customSlabs = items.map(i => Number(i.taxPercent) || 0).filter(s => s > 0 && !standardSlabs.includes(s));
  const gstSlabs = [...new Set([...standardSlabs, ...customSlabs])].sort((a, b) => a - b);
  const taxInclusive = !!totals?.taxInclusive;

  const slabData = gstSlabs.map(slab => {
    let total = 0, disc = 0, sgst = 0, cgst = 0, utgst = 0, igst = 0, cess = 0;
    items.forEach(item => {
      if ((Number(item.taxPercent) || 0) !== slab) return;
      const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      const actualDiscount = resolveLineDiscount(item);
      const gross = Math.max(0, lineAmount - actualDiscount);
      const taxable = taxInclusive && slab > 0 ? gross / (1 + slab / 100) : gross;
      const taxAmt = taxInclusive && slab > 0 ? gross - taxable : taxable * (slab / 100);
      const cessPct = Number(item.cessPercent) || 0;

      total += taxable;
      disc += actualDiscount;
      cess += taxable * cessPct / 100;

      if (!showGST) return;
      if (isInterstate) igst += taxAmt;
      else if (isIntraUT) { cgst += taxAmt / 2; utgst += taxAmt / 2; }
      else { sgst += taxAmt / 2; cgst += taxAmt / 2; }
    });
    return { slab: slab.toFixed(2), total, disc, sgst, cgst, utgst, igst, cess, totalGst: sgst + cgst + utgst + igst + cess };
  });

  let zeroTaxTotal = 0;
  items.forEach(item => {
    if ((Number(item.taxPercent) || 0) === 0) {
      const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      const actualDiscount = resolveLineDiscount(item);
      zeroTaxTotal += Math.max(0, lineAmount - actualDiscount);
    }
  });

  const sumTotal = slabData.reduce((acc, d) => acc + d.total, 0) + zeroTaxTotal;
  const sumDisc = slabData.reduce((acc, d) => acc + d.disc, 0);
  const sumSgst = slabData.reduce((acc, d) => acc + d.sgst, 0);
  const sumCgst = slabData.reduce((acc, d) => acc + d.cgst, 0);
  const sumUtgst = slabData.reduce((acc, d) => acc + d.utgst, 0);
  const sumIgst = slabData.reduce((acc, d) => acc + d.igst, 0);
  const sumCess = slabData.reduce((acc, d) => acc + d.cess, 0);
  const sumTotalGst = slabData.reduce((acc, d) => acc + d.totalGst, 0);

  const displaySubtotal = Number(totals?.taxableAmount ?? sumTotal);
  const displaySgst = Number(totals?.sgst ?? sumSgst);
  const displayCgst = Number(totals?.cgst ?? sumCgst);
  const displayUtgst = Number(totals?.utgst ?? sumUtgst);
  const displayIgst = Number(totals?.igst ?? sumIgst);
  const displayCess = Number(totals?.cess ?? sumCess);
  const displayTaxTotal = Number(totals?.totalTaxAmount ?? sumTotalGst);
  const displayRoundOff = showRoundOff ? Number(totals?.roundOff || 0) : 0;
  const displayTcs = Number(totals?.tcsAmount || 0);
  const displayTds = Number(totals?.tdsAmount || 0);
  const displayInvDisc = Number(totals?.invoiceDiscountAmount || 0);
  const displayGrandTotal = Number(
    totals?.total
    ?? (displaySubtotal + displayTaxTotal + displayTcs + displayRoundOff - displayInvDisc)
  );
  const displayNetReceivable = displayTds > 0
    ? Number(totals?.netReceivable ?? (displayGrandTotal - displayTds))
    : displayGrandTotal;

  const safeTermsHtml = safeHtml(
    customTerms || '1. Goods once sold will not be taken back & exchanged.<br/>2. Payment should be done within 15 days of bill date.<br/>3. @24% P.A. Interest will be charged if payment not done on time.'
  );
  const safeNotesHtml = customNotes ? safeHtml(customNotes) : '';

  const itemColCount = showPharmaFields ? 13 : 8;

  return (
    <div
      className="invoice-preview-container sheet arthsutra-layout"
      ref={ref}
      {...(previewOnly ? {} : { id: 'invoice-preview' })}
      style={{
        ...containerStyle,
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: '#000',
        fontSize: '11px',
        padding: '25px',
        backgroundColor: '#fff',
        boxSizing: 'border-box',
        margin: '0 auto',
      }}
    >
      <style>{`
        .arthsutra-wrapper { border: 1.5px solid #000; padding: 0px; box-sizing: border-box; }
        .arthsutra-table { width: 100%; border-collapse: collapse; margin-bottom: -1px; }
        .arthsutra-table th, .arthsutra-table td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }
        .arthsutra-table th { font-weight: bold; text-align: center; }
        .text-center { text-align: center !important; }
        .text-right { text-align: right !important; }
        .font-bold { font-weight: bold !important; }
        .no-border { border: none !important; }
        .no-border-top { border-top: none !important; }
        .no-border-bottom { border-bottom: none !important; }
        .arthsutra-table tr td:first-child, .arthsutra-table tr th:first-child { border-left: 1px solid #000 !important; }
        .arthsutra-table tr td:last-child, .arthsutra-table tr th:last-child { border-right: 1px solid #000 !important; }
        .ipx-rich p { margin: 0 0 0.35rem; }
        .ipx-rich p:last-child { margin-bottom: 0; }
        .ipx-rich ul, .ipx-rich ol { margin: 0.25rem 0 0.35rem 1.25rem; padding: 0; }
      `}</style>

      <div className="arthsutra-wrapper">

        <div className="text-center font-bold" style={{ fontSize: '16px', padding: '5px 0', borderBottom: '1px solid #000', letterSpacing: '0.05em' }}>
          {docTitle}
        </div>

        <table className="arthsutra-table">
          <tbody>
            <tr>
              <td style={{ width: '50%' }}>
                {showLogo && profile?.logo && (
                  <img
                    src={profile.logo}
                    alt=""
                    style={{ height: `${profile.logoHeight || 40}px`, maxWidth: '100px', objectFit: 'contain', marginBottom: '3px', display: 'block' }}
                  />
                )}
                <div className="font-bold" style={{ fontSize: '13px', color: '#000080' }}>
                  {profile?.businessName || 'Business Name'}
                </div>
                <div>{profile?.tagline || 'Pharmaceutical Distributors'}</div>
                <div>{profile?.address}</div>
                <div>{[profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', ')}</div>
                <div>Phone : {profile?.phone}</div>
                <div>Licence No. : {details?.sellerLicence || profile?.licenceNo || '20B/1234/27/2026'}</div>
                <div>GSTIN : {profile?.gstin}</div>
                <div>E-Mail : {profile?.email}</div>
              </td>
              <td style={{ width: '50%' }}>
                <div style={{ borderBottom: '1px solid #000', paddingBottom: '4px', marginBottom: '4px' }}>
                  <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', border: 'none' }}>
                    <tbody>
                      <tr>
                        <td style={{ border: 'none', padding: '0 0 2px 0', width: '20%' }}>Invoice No.</td>
                        <td style={{ border: 'none', padding: '0 0 2px 0', width: '35%' }}>: {details?.invoiceNumber}</td>
                        <td style={{ border: 'none', padding: '0 0 2px 0', width: '15%' }}>Date</td>
                        <td style={{ border: 'none', padding: '0 0 2px 0', width: '30%' }}>
                          : {details?.invoiceDate ? new Date(details.invoiceDate).toLocaleDateString('en-GB') : ''}
                        </td>
                      </tr>
                      {details?.dueDate && (
                        <tr>
                          <td style={{ border: 'none', padding: 0 }}>Due Date</td>
                          <td style={{ border: 'none', padding: 0 }} colSpan="3">: {new Date(details.dueDate).toLocaleDateString('en-GB')}</td>
                        </tr>
                      )}
                      {showPoNumber && details?.poNumber && (
                        <tr>
                          <td style={{ border: 'none', padding: 0 }}>PO NO</td>
                          <td style={{ border: 'none', padding: 0 }} colSpan="3">: {details.poNumber}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="font-bold">M/s {client?.name || 'Sample Client Name'}</div>
                <div>{client?.address}</div>
                <div>{[client?.city, client?.state, client?.pin].filter(Boolean).join(', ')}</div>
                <div>Ph.No.: {client?.phone}</div>
                <div>GST : {client?.gstin} {client?.licence ? <>&nbsp;&nbsp;&nbsp; Licence No. : {client.licence}</> : null}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="arthsutra-table">
          <thead>
            <tr>
              <th style={{ width: '3%' }}>Sn.</th>
              <th style={{ width: '5%' }}>Qty.</th>
              {showPharmaFields && <th style={{ width: '6%' }}>OMRP</th>}
              <th style={{ width: showPharmaFields ? '25%' : 'auto' }}>Product</th>
              {showPharmaFields && <th style={{ width: '10%' }}>Batch</th>}
              {showPharmaFields && <th style={{ width: '5%' }}>Exp.</th>}
              {showHSN && <th style={{ width: '8%' }}>HSN</th>}
              {showPharmaFields && <th style={{ width: '7%' }}>MRP</th>}
              <th style={{ width: '7%' }}>Rate</th>
              <th style={{ width: '4%' }}>Dis</th>
              {showGST && !isInterstate && <th style={{ width: '5%' }}>SGST%</th>}
              {showGST && !isInterstate && <th style={{ width: '5%' }}>CGST%</th>}
              {showGST && isInterstate && <th style={{ width: '5%' }}>IGST%</th>}
              <th style={{ width: '10%' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={itemColCount} className="text-center" style={{ padding: '10px', color: '#666' }}>No items</td>
              </tr>
            )}
            {items.map((item, index) => {
              const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
              const discount = resolveLineDiscount(item);
              const grossAfterDiscount = Math.max(0, lineAmount - discount);
              const taxRate = Number(item.taxPercent) || 0;
              const taxableValue = taxInclusive && taxRate > 0 ? grossAfterDiscount / (1 + taxRate / 100) : grossAfterDiscount;
              const halfRate = taxRate / 2;

              return (
                <tr key={item.id || index}>
                  <td className="text-center">{index + 1}.</td>
                  <td className="text-center">{item.quantity}</td>
                  {showPharmaFields && <td className="text-right">{item.omrp ? Number(item.omrp).toFixed(2) : '0.00'}</td>}
                  <td>
                    {item.name}
                    {item.description && <div style={{ fontSize: '9px', color: '#555' }}>{item.description}</div>}
                  </td>
                  {showPharmaFields && <td>{item.batch || 'N/A'}</td>}
                  {showPharmaFields && <td className="text-center">{item.expiry || ''}</td>}
                  {showHSN && <td>{item.hsn}</td>}
                  {showPharmaFields && <td className="text-right">{Number(item.mrp || 0).toFixed(2)}</td>}
                  <td className="text-right">{Number(item.rate || 0).toFixed(2)}</td>
                  <td className="text-right">{discount > 0 ? discount.toFixed(2) : '0.00'}</td>
                  {showGST && !isInterstate && <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>}
                  {showGST && !isInterstate && <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>}
                  {showGST && isInterstate && <td className="text-right">{taxRate > 0 ? taxRate.toFixed(2) : '0.00'}</td>}
                  <td className="text-right">{taxableValue.toFixed(2)}</td>
                </tr>
              );
            })}

            <tr style={{ height: '180px' }}>
              <td colSpan={itemColCount}></td>
            </tr>
          </tbody>
        </table>

        <table className="arthsutra-table no-border-top">
          <tbody>
            <tr>
              <td style={{ width: '65%', padding: 0, border: 'none' }}>
                <table className="arthsutra-table" style={{ height: '100%', border: 'none', marginBottom: 0 }}>
                  <thead>
                    <tr className="font-bold">
                      <td className="no-border-top no-border-left">CLASS(gst%)</td>
                      <td className="no-border-top text-right">TOTAL</td>
                      <td className="no-border-top text-right">SCH</td>
                      <td className="no-border-top text-right">DISC</td>
                      {!isInterstate && <td className="no-border-top text-right">SGST</td>}
                      {!isInterstate && !isIntraUT && <td className="no-border-top text-right">CGST</td>}
                      {isIntraUT && <td className="no-border-top text-right">UTGST</td>}
                      {isInterstate && <td className="no-border-top text-right">IGST</td>}
                      {sumCess > 0 && <td className="no-border-top text-right">CESS</td>}
                      <td className="no-border-top text-right">TOTAL GST</td>
                    </tr>
                  </thead>
                  <tbody>
                    {slabData.map(data => (
                      <tr key={data.slab}>
                        <td className="no-border-left">GST {data.slab}</td>
                        <td className="text-right">{data.total.toFixed(2)}</td>
                        <td className="text-right">0.00</td>
                        <td className="text-right">{data.disc.toFixed(2)}</td>
                        {!isInterstate && <td className="text-right">{data.sgst.toFixed(2)}</td>}
                        {!isInterstate && !isIntraUT && <td className="text-right">{data.cgst.toFixed(2)}</td>}
                        {isIntraUT && <td className="text-right">{data.utgst.toFixed(2)}</td>}
                        {isInterstate && <td className="text-right">{data.igst.toFixed(2)}</td>}
                        {sumCess > 0 && <td className="text-right">{data.cess.toFixed(2)}</td>}
                        <td className="text-right">{data.totalGst.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="no-border-bottom no-border-left">TOTAL</td>
                      <td className="no-border-bottom text-right">{sumTotal.toFixed(2)}</td>
                      <td className="no-border-bottom text-right">0.00</td>
                      <td className="no-border-bottom text-right">{sumDisc.toFixed(2)}</td>
                      {!isInterstate && <td className="no-border-bottom text-right">{sumSgst.toFixed(2)}</td>}
                      {!isInterstate && !isIntraUT && <td className="no-border-bottom text-right">{sumCgst.toFixed(2)}</td>}
                      {isIntraUT && <td className="no-border-bottom text-right">{sumUtgst.toFixed(2)}</td>}
                      {isInterstate && <td className="no-border-bottom text-right">{sumIgst.toFixed(2)}</td>}
                      {sumCess > 0 && <td className="no-border-bottom text-right">{sumCess.toFixed(2)}</td>}
                      <td className="no-border-bottom text-right">{sumTotalGst.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ width: '35%', padding: 0, border: 'none' }}>
                <table className="arthsutra-table" style={{ height: '100%', border: 'none', marginBottom: 0 }}>
                  <tbody>
                    <tr>
                      <td className="no-border-top">SUB TOTAL</td>
                      <td className="no-border-top no-border-right text-right">{displaySubtotal.toFixed(2)}</td>
                    </tr>
                    {displayInvDisc > 0 && (
                      <tr>
                        <td>INVOICE DISC</td>
                        <td className="no-border-right text-right">-{displayInvDisc.toFixed(2)}</td>
                      </tr>
                    )}
                    {!isInterstate && (
                      <tr>
                        <td>SGST PAYBLE</td>
                        <td className="no-border-right text-right">{displaySgst.toFixed(2)}</td>
                      </tr>
                    )}
                    {!isInterstate && !isIntraUT && (
                      <tr>
                        <td>CGST PAYBLE</td>
                        <td className="no-border-right text-right">{displayCgst.toFixed(2)}</td>
                      </tr>
                    )}
                    {isIntraUT && (
                      <tr>
                        <td>UTGST PAYBLE</td>
                        <td className="no-border-right text-right">{displayUtgst.toFixed(2)}</td>
                      </tr>
                    )}
                    {isInterstate && (
                      <tr>
                        <td>IGST PAYBLE</td>
                        <td className="no-border-right text-right">{displayIgst.toFixed(2)}</td>
                      </tr>
                    )}
                    {displayCess > 0 && (
                      <tr>
                        <td>CESS</td>
                        <td className="no-border-right text-right">{displayCess.toFixed(2)}</td>
                      </tr>
                    )}
                    {displayTcs > 0 && (
                      <tr>
                        <td>TCS</td>
                        <td className="no-border-right text-right">{displayTcs.toFixed(2)}</td>
                      </tr>
                    )}
                    <tr>
                      <td>ADD/LESS</td>
                      <td className="no-border-right text-right">{displayRoundOff.toFixed(2)}</td>
                    </tr>
                    <tr className="font-bold" style={{ fontSize: '13px' }}>
                      <td>GRAND TOTAL</td>
                      <td className="no-border-right text-right">{displayGrandTotal.toFixed(2)}</td>
                    </tr>
                    {displayTds > 0 && (
                      <>
                        <tr>
                          <td>LESS: TDS</td>
                          <td className="no-border-right text-right">-{displayTds.toFixed(2)}</td>
                        </tr>
                        <tr className="font-bold">
                          <td className="no-border-bottom">NET RECEIVABLE</td>
                          <td className="no-border-bottom no-border-right text-right">{displayNetReceivable.toFixed(2)}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {showAmountWords && (
          <table className="arthsutra-table" style={{ borderTop: '1px solid #000' }}>
            <tbody>
              <tr>
                <td colSpan={3} className="font-bold" style={{ padding: '4px', borderBottom: '1px solid #000' }}>
                  Rs. {amountInWords(displayGrandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <table className="arthsutra-table" style={{ borderTop: '2px solid #000' }}>
          <tbody>
            <tr>
              <td style={{ width: '40%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none', borderLeft: 'none' }}>
                <div className="font-bold" style={{ textDecoration: 'underline', marginBottom: '2px' }}>Terms &amp; Conditions</div>
                <div className="ipx-rich" style={{ fontSize: '10px', lineHeight: '1.4' }} dangerouslySetInnerHTML={{ __html: safeTermsHtml }} />
              </td>
              {showBankDetails && (
                <td style={{ width: '30%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none' }}>
                  <div className="font-bold text-center" style={{ textDecoration: 'underline', marginBottom: '4px' }}>BANK DETAIL</div>
                  <div className="font-bold">{profile?.businessName || 'Business Name'}</div>
                  <div className="font-bold">{account?.bankName || profile?.bankName || 'Bank Name'}</div>
                  <div className="font-bold">A/C NO. {account?.accountNumber || profile?.accountNumber || ''}</div>
                  <div className="font-bold">IFSC CODE {(account?.ifsc || profile?.ifsc || '')}</div>
                  {showUPI && qrDataUrl && (
                    <div style={{ textAlign: 'center', marginTop: '6px' }}>
                      <img src={qrDataUrl} alt="UPI QR" style={{ width: '70px', height: '70px', display: 'inline-block' }} />
                      <div style={{ fontSize: '8.5px', color: '#555', marginTop: '1px' }}>Scan to pay via UPI</div>
                    </div>
                  )}
                </td>
              )}
              {showSignature && (
                <td style={{ width: showBankDetails ? '30%' : '60%', padding: '4px', textAlign: 'center', verticalAlign: 'top', borderRight: 'none', borderBottom: 'none' }}>
                  <div className="font-bold" style={{ textAlign: 'right', fontSize: '10px' }}>
                    For {profile?.businessName || 'Shree enterprises'}
                  </div>
                  {profile?.signature ? (
                    <img src={profile.signature} alt="Signature" style={{ maxHeight: '45px', maxWidth: '100%', display: 'inline-block', margin: '6px 0' }} />
                  ) : (
                    <div style={{ height: '45px' }} />
                  )}
                  <div className="font-bold" style={{ textAlign: 'right', fontSize: '10px' }}>Authorized Signatory</div>
                </td>
              )}
            </tr>
          </tbody>
        </table>

        {showNotes && safeNotesHtml && (
          <table className="arthsutra-table" style={{ borderTop: '1px solid #000' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px' }}>
                  <div className="font-bold" style={{ marginBottom: '2px' }}>Notes</div>
                  <div className="ipx-rich" style={{ fontSize: '10px', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: safeNotesHtml }} />
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {showExtraSec && Array.isArray(extraSections) && extraSections.length > 0 && (
          <table className="arthsutra-table" style={{ borderTop: '1px solid #000' }}>
            <tbody>
              {extraSections.map((sec, i) => {
                const content = typeof sec === 'string' ? sec : (sec?.content || '');
                const title = typeof sec === 'object' ? sec?.title : null;
                const clean = safeHtml(content);
                if (!clean && !title) return null;
                return (
                  <tr key={i}>
                    <td style={{ padding: '4px', borderTop: i > 0 ? '1px dashed #999' : 'none' }}>
                      {title && <div className="font-bold" style={{ marginBottom: '2px' }}>{title}</div>}
                      {clean && <div className="ipx-rich" style={{ fontSize: '10px', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: clean }} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

      </div>

      <div style={{ textAlign: 'center', fontSize: '10px', fontStyle: 'italic', marginTop: '4px', color: '#333' }}>
        created by Arth Upadhyay || ph:9425877961
      </div>

    </div>
  );
});

export default InvoicePreview;