import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import DOMPurify from 'dompurify';
import { numberToWords, formatCurrency, INVOICE_TYPES, getCountryConfig, CURRENCY_NAMES, formatExchangeRateLine, getAccountById, getPaperSize, resolveLineDiscount } from '../utils';
import { getPrintSettings, getLabel } from '../utils/printSettings';

const InvoicePreview = React.forwardRef(({ profile, client, details, items, totals, invoiceType = 'tax-invoice', customTerms, customNotes, extraSections = [], options = {}, previewOnly = false }, ref) => {
  
  // --- THE DYNAMIC TITLE LOGIC ---
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
  const typeConfig = INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'];
  
  const sellerCC = getCountryConfig(profile?.country);
  const isIndia = (profile?.country || 'India') === 'India';
  const taxLabel = sellerCC.taxLabel || 'GST';

  const account = options.paymentAccountSnapshot || getAccountById(profile, options.selectedAccountId);
  
  const opt = (key, fallback = true) => options[key] !== undefined ? options[key] : fallback;
  const showGST = opt('showGST', typeConfig.showGST);
  const showHSN = opt('showHSN');
  
  const currencySymbol = options.currency || 'INR';

  const _ps = getPrintSettings();

  const amountInWords = (num) => {
    if (currencySymbol === 'INR') return numberToWords(num);
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convert = (n) => {
      if (n === 0) return 'Zero';
      let result = '';
      if (n >= 1000000) { result += convert(Math.floor(n / 1000000)) + ' Million '; n %= 1000000; }
      if (n >= 1000) { result += convert(Math.floor(n / 1000)) + ' Thousand '; n %= 1000; }
      if (n >= 100) { result += a[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
      if (n >= 20) { result += b[Math.floor(n / 10)] + ' '; if (n % 10) result += a[n % 10] + ' '; }
      else if (n > 0) { result += a[n] + ' '; }
      return result.trim();
    };
    const names = CURRENCY_NAMES[currencySymbol] || { major: currencySymbol, minor: 'Cents' };
    const rounded = Math.round(num * 100) / 100;
    const whole = Math.floor(rounded);
    const cents = Math.round((rounded - whole) * 100);
    let result = convert(whole) + ' ' + names.major;
    if (cents > 0) result += ' and ' + convert(cents) + ' ' + names.minor;
    return result + ' Only';
  };

  const [qrDataUrl, setQrDataUrl] = useState('');
  const upiId = account?.upiId || profile?.upiId || '';
  useEffect(() => {
    if (!opt('showUPI') || !upiId || !totals.total || currencySymbol !== 'INR') {
      setQrDataUrl('');
      return;
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(profile?.businessName || '')}&am=${totals.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${details?.invoiceNumber || 'Invoice'}`)}`;
    QRCode.toDataURL(upiUrl, { width: 120, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [opt('showUPI'), upiId, profile?.businessName, totals.total, details?.invoiceNumber, currencySymbol]);

  const paperCfg = getPaperSize(options.paperSize, options);
  const isThermal = paperCfg.kind === 'thermal';
  const containerStyle = {
    width: `${paperCfg.widthMm}mm`,
    minHeight: paperCfg.kind === 'sheet' ? `${paperCfg.heightMm}mm` : undefined,
    ...(isThermal ? { fontFamily: '"Courier New", monospace', fontSize: paperCfg.widthMm >= 80 ? '10.5px' : '9px' } : {}),
  };

  if (isThermal) {
    // Thermal rendering handled cleanly
  }

  // --- STRICT MATH SYNCHRONIZATION ---
  // Generate standard slabs + any custom rates from items
  const standardSlabs = [5, 12, 18, 28];
  const customSlabs = items.map(i => Number(i.taxPercent) || 0).filter(s => s > 0 && !standardSlabs.includes(s));
  const gstSlabs = [...new Set([...standardSlabs, ...customSlabs])].sort((a, b) => a - b);

  // Map each item strictly to its exact tax slab to populate the left table
  const slabData = gstSlabs.map(slab => {
    let total = 0, disc = 0, sgst = 0, cgst = 0;
    items.forEach(item => {
      if ((Number(item.taxPercent) || 0) === slab) {
        const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
        
        let actualDiscount = 0;
        if (item.discount) {
            actualDiscount = item.discountType === 'percent' 
                ? lineAmount * (Number(item.discount) / 100)
                : Number(item.discount);
        }
        
        const gross = Math.max(0, lineAmount - actualDiscount);
        const isTaxInclusive = totals?.taxInclusive || false;
        
        const taxable = isTaxInclusive ? gross / (1 + slab / 100) : gross;
        const taxAmt = isTaxInclusive ? gross - taxable : taxable * (slab / 100);
        
        total += taxable;
        disc += actualDiscount;
        sgst += taxAmt / 2;
        cgst += taxAmt / 2;
      }
    });
    return { slab: slab.toFixed(2), total, disc, sgst, cgst, totalGst: sgst + cgst };
  });

  // Items with 0% tax (or no tax assigned) must still be added to the grand subtotal
  let zeroTaxTotal = 0;
  items.forEach(item => {
    if ((Number(item.taxPercent) || 0) === 0) {
      const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      let actualDiscount = 0;
      if (item.discount) {
          actualDiscount = item.discountType === 'percent' 
              ? lineAmount * (Number(item.discount) / 100)
              : Number(item.discount);
      }
      zeroTaxTotal += Math.max(0, lineAmount - actualDiscount);
    }
  });

  // Calculate strict vertical sums of the exact numbers displayed in the left-hand table
  const sumTotal = slabData.reduce((acc, d) => acc + d.total, 0) + zeroTaxTotal;
  const sumDisc = slabData.reduce((acc, d) => acc + d.disc, 0);
  const sumSgst = slabData.reduce((acc, d) => acc + d.sgst, 0);
  const sumCgst = slabData.reduce((acc, d) => acc + d.cgst, 0);
  const sumTotalGst = slabData.reduce((acc, d) => acc + d.totalGst, 0);

  // We force the right-hand summary to sum exactly what is rendered to guarantee 100% mathematical accuracy.
  const displaySubtotal = sumTotal;
  const displaySgst = sumSgst;
  const displayCgst = sumCgst;
  const displayTaxTotal = sumTotalGst;
  const displayRoundOff = Number(totals?.roundOff || 0);
  
  // Strict formula: Subtotal + SGST + CGST + RoundOff = Grand Total
  const displayGrandTotal = displaySubtotal + displayTaxTotal + displayRoundOff;

  return (
    <div
      className="invoice-preview-container sheet marg-layout"
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
        margin: '0 auto' 
      }}
    >
      <style>{`
        .marg-wrapper { border: 1.5px solid #000; padding: 0px; box-sizing: border-box; }
        .marg-table { width: 100%; border-collapse: collapse; margin-bottom: -1px; }
        .marg-table th, .marg-table td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }
        .marg-table th { font-weight: bold; text-align: center; }
        .text-center { text-align: center !important; }
        .text-right { text-align: right !important; }
        .font-bold { font-weight: bold !important; }
        .no-border { border: none !important; }
        .no-border-top { border-top: none !important; }
        .no-border-bottom { border-bottom: none !important; }
        .marg-table tr td:first-child, .marg-table tr th:first-child { border-left: 1px solid #000 !important; }
        .marg-table tr td:last-child, .marg-table tr th:last-child { border-right: 1px solid #000 !important; }
      `}</style>

      <div className="marg-wrapper">
        
        {/* TOP TITLE: DYNAMIC */}
        <div className="text-center font-bold" style={{ fontSize: '16px', padding: '5px 0', borderBottom: '1px solid #000', letterSpacing: '0.05em' }}>
          {docTitle}
        </div>
        
        {/* HEADER: SELLER & BUYER INFO */}
        <table className="marg-table">
          <tbody>
            <tr>
              <td style={{ width: '50%' }}>
                <div className="font-bold" style={{ fontSize: '13px', color: '#000080' }}>
                  {profile?.businessName || 'Business Name'}
                </div>
                <div>Pharmaceutical Distributors</div>
                <div>{profile?.address}</div>
                <div>{[profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', ')}</div>
                <div>Phone : {profile?.phone}</div>
                <div>Licence No. : {details?.sellerLicence || '20B/1234/27/2026'}</div>
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
                      {options.showPoNumber !== false && (
                        <tr>
                          <td style={{ border: 'none', padding: 0 }}>PO NO</td>
                          <td style={{ border: 'none', padding: 0 }} colSpan="3">: {details?.poNumber}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="font-bold">M/s {client?.name || 'Sample Client Name'}</div>
                <div>{client?.address}</div>
                <div>{[client?.city, client?.state, client?.pin].filter(Boolean).join(', ')}</div>
                <div>Ph.No.: {client?.phone}</div>
                <div>GST : {client?.gstin} &nbsp;&nbsp;&nbsp; Licence No. : {client?.licence || '20B/12/34/2015'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ITEMS TABLE */}
        <table className="marg-table">
          <thead>
            <tr>
              <th style={{ width: '3%' }}>Sn.</th>
              <th style={{ width: '5%' }}>Qty.</th>
              <th style={{ width: '6%' }}>OMRP</th>
              <th style={{ width: '25%' }}>Product</th>
              <th style={{ width: '10%' }}>Batch</th>
              <th style={{ width: '5%' }}>Exp.</th>
              <th style={{ width: '8%' }}>HSN</th>
              <th style={{ width: '7%' }}>MRP</th>
              <th style={{ width: '7%' }}>Rate</th>
              <th style={{ width: '4%' }}>Dis</th>
              <th style={{ width: '5%' }}>SGST%</th>
              <th style={{ width: '5%' }}>CGST%</th>
              <th style={{ width: '10%' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const lineAmount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
              
              let discount = 0;
              if (item.discount) {
                  discount = item.discountType === 'percent' 
                      ? lineAmount * (Number(item.discount) / 100)
                      : Number(item.discount);
              }
              
              const grossAfterDiscount = Math.max(0, lineAmount - discount);
              const taxRate = Number(item.taxPercent) || 0;
              const isTaxInclusive = totals?.taxInclusive || false;
              
              const taxableValue = isTaxInclusive ? grossAfterDiscount / (1 + taxRate / 100) : grossAfterDiscount;
              const halfRate = taxRate / 2;
              
              return (
                <tr key={item.id || index}>
                  <td className="text-center">{index + 1}.</td>
                  <td className="text-center">{item.quantity}</td>
                  <td className="text-right">{item.omrp || '0.00'}</td>
                  <td>{item.name}</td>
                  <td>{item.batch || 'N/A'}</td>
                  <td className="text-center">{item.expiry || ''}</td>
                  <td>{item.hsn}</td>
                  <td className="text-right">{Number(item.mrp || 0).toFixed(2)}</td>
                  <td className="text-right">{Number(item.rate || 0).toFixed(2)}</td>
                  <td className="text-right">{discount > 0 ? discount.toFixed(2) : '0.00'}</td>
                  <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>
                  <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>
                  <td className="text-right">{taxableValue.toFixed(2)}</td>
                </tr>
              );
            })}
            
            {/* Blank row to push totals to the bottom and ensure grid styling */}
            <tr style={{ height: '180px' }}>
              <td colSpan="13"></td>
            </tr>
          </tbody>
        </table>

        {/* BOTTOM TOTALS AND TAX SUMMARY */}
        <table className="marg-table no-border-top">
          <tbody>
            <tr>
              <td style={{ width: '65%', padding: 0, border: 'none' }}>
                <table className="marg-table" style={{ height: '100%', border: 'none', marginBottom: 0 }}>
                  <thead>
                    <tr className="font-bold">
                      <td className="no-border-top no-border-left">CLASS(gst%)</td>
                      <td className="no-border-top text-right">TOTAL</td>
                      <td className="no-border-top text-right">SCH</td>
                      <td className="no-border-top text-right">DISC</td>
                      <td className="no-border-top text-right">SGST</td>
                      <td className="no-border-top text-right">CGST</td>
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
                        <td className="text-right">{data.sgst.toFixed(2)}</td>
                        <td className="text-right">{data.cgst.toFixed(2)}</td>
                        <td className="text-right">{data.totalGst.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="no-border-bottom no-border-left">TOTAL</td>
                      <td className="no-border-bottom text-right">{sumTotal.toFixed(2)}</td>
                      <td className="no-border-bottom text-right">0.00</td>
                      <td className="no-border-bottom text-right">{sumDisc.toFixed(2)}</td>
                      <td className="no-border-bottom text-right">{sumSgst.toFixed(2)}</td>
                      <td className="no-border-bottom text-right">{sumCgst.toFixed(2)}</td>
                      <td className="no-border-bottom text-right">{sumTotalGst.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ width: '35%', padding: 0, border: 'none' }}>
                <table className="marg-table" style={{ height: '100%', border: 'none', marginBottom: 0 }}>
                  <tbody>
                    <tr>
                      <td className="no-border-top">SUB TOTAL</td>
                      <td className="no-border-top no-border-right text-right">{displaySubtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>SGST PAYBLE</td>
                      <td className="no-border-right text-right">{displaySgst.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>CGST PAYBLE</td>
                      <td className="no-border-right text-right">{displayCgst.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>ADD/LESS</td>
                      <td className="no-border-right text-right">{displayRoundOff.toFixed(2)}</td>
                    </tr>
                    <tr className="font-bold" style={{ fontSize: '13px' }}>
                      <td className="no-border-bottom">GRAND TOTAL</td>
                      <td className="no-border-bottom no-border-right text-right">{displayGrandTotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* FOOTER: TERMS, BANK, SIGNATURE */}
        <table className="marg-table" style={{ borderTop: '2px solid #000' }}>
          <tbody>
            <tr>
              <td colSpan="3" className="font-bold" style={{ padding: '4px', borderBottom: '1px solid #000' }}>
                Rs. {amountInWords(displayGrandTotal)}
              </td>
            </tr>
            <tr>
              <td style={{ width: '40%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none', borderLeft: 'none' }}>
                <div className="font-bold" style={{ textDecoration: 'underline', marginBottom: '2px' }}>Terms & Conditions</div>
                <div style={{ fontSize: '10px', lineHeight: '1.4' }} dangerouslySetInnerHTML={{ __html: customTerms || '1. Goods once sold will not be taken back & exchanged.<br/>2. Payment should be done within 15 days of bill date.<br/>3. @24% P.A. Interest will be charged if payment not done on time.' }} />
              </td>
              <td style={{ width: '30%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none' }}>
                <div className="font-bold text-center" style={{ textDecoration: 'underline', marginBottom: '4px' }}>BANK DETAIL</div>
                <div className="font-bold">{profile?.businessName || 'Business Name'}</div>
                <div className="font-bold">Bank Name</div>
                <div className="font-bold">A/C NO. {account?.accountNumber || profile?.accountNumber || '1234567890'}</div>
                <div className="font-bold">IFSC CODE {account?.ifsc || profile?.ifsc || 'ABCD0001234'}</div>
              </td>
              <td style={{ width: '30%', padding: '4px', textAlign: 'center', verticalAlign: 'top', borderRight: 'none', borderBottom: 'none' }}>
                <div className="font-bold" style={{ textAlign: 'right', fontSize: '10px' }}>
                  For {profile?.businessName || 'Business Name'}
                </div>
                <br /><br /><br />
                <div className="font-bold" style={{ textAlign: 'right', fontSize: '10px' }}>Authorized Signatory</div>
              </td>
            </tr>
          </tbody>
        </table>

      </div>
      
      {/* BRANDING FOOTER */}
      <div style={{ textAlign: 'center', fontSize: '10px', fontStyle: 'italic', marginTop: '4px', color: '#333' }}>
        created by Arth Upadhyay || ph:9425877961
      </div>
      
    </div>
  );
});

export default InvoicePreview;
