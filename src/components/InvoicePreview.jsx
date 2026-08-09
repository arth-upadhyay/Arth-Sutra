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

  // Keep existing thermal renderer logic intact so POS printers don't break
  if (isThermal) {
    const eff = {
      thermalFontSize:    options.thermalFontSize    ?? _ps.fontSize,
      thermalFontFamily:  options.thermalFontFamily  ?? _ps.fontFamily,
      thermalFontWeight:  options.thermalFontWeight  ?? _ps.fontWeight,
      thermalAllCaps:     options.thermalAllCaps     ?? _ps.allCaps,
      thermalLineSpacing: options.thermalLineSpacing ?? _ps.lineSpacing,
      thermalContrast:    options.thermalContrast    ?? _ps.contrast,
      thermalHeaderAlign: options.thermalHeaderAlign ?? _ps.headerAlign,
      thermalHeaderCaps:  options.thermalHeaderCaps  ?? _ps.headerCaps,
      thermalShowLogo:    options.thermalShowLogo    ?? _ps.showLogo,
      thermalShowHSN:     options.thermalShowHSN     ?? _ps.showHSN,
      thermalShowRate:    options.thermalShowRate    ?? _ps.showRateLine,
      thermalQrSize:      options.thermalQrSize      ?? _ps.qrSize,
      thermalCutMark:     options.thermalCutMark     ?? _ps.cutMark,
      thermalFeedLines:   options.thermalFeedLines   ?? _ps.feedLines,
      thermalFooterMessage: options.thermalFooterMessage ?? _ps.footerMessage,
      thermalTagline:     options.thermalTagline     ?? (_ps.showTagline ? _ps.tagline : ''),
      thermalCompact:     options.thermalCompact     ?? false,
    };

    const invoiceNum = details?.invoiceNumber || '';
    const invoiceDate = details?.invoiceDate ? new Date(details.invoiceDate).toLocaleDateString('en-IN') : '';
    const sellerCurrency = getCountryConfig(profile?.country).currency;
    const currencySymbolThermal = sellerCurrency === 'INR' ? 'Rs.' : sellerCurrency;
    const showRoundOff = opt('showRoundOff', false);
    const isVeryNarrow = paperCfg.widthMm < 60;
    const isNarrow = paperCfg.widthMm < 80;

    const fontSize = eff.thermalFontSize || 'medium';
    const fontFamily = eff.thermalFontFamily || 'mono';
    const fontWeight = eff.thermalFontWeight || 'bold';
    const allCaps = eff.thermalAllCaps === true;
    const lineSpacing = eff.thermalLineSpacing || 'normal';
    const contrast = eff.thermalContrast || 'normal';
    const headerAlign = eff.thermalHeaderAlign || 'center';
    const headerCaps = eff.thermalHeaderCaps !== false;
    const showLogo = eff.thermalShowLogo !== false;
    const showHSNThermal = eff.thermalShowHSN !== false;
    const showRate = eff.thermalShowRate !== false;
    const qrSizePx = eff.thermalQrSize === 'small' ? 60 : eff.thermalQrSize === 'large' ? 120 : 90;
    const cutMark = eff.thermalCutMark !== false;
    const feedLines = Number(eff.thermalFeedLines ?? 2);
    const footerMessage = eff.thermalFooterMessage || 'Thank you for your business!';
    const tagline = eff.thermalTagline || '';
    const thermalCompact = !!eff.thermalCompact;

    const fontSizeMap = { small: isVeryNarrow ? 9.5 : 11, medium: isVeryNarrow ? 11 : 12.5, large: isVeryNarrow ? 12.5 : 14.5, xlarge: isVeryNarrow ? 14 : 16.5 };
    const fontSizeBase = (fontSizeMap[fontSize] || fontSizeMap.medium) + 'px';
    const fontFamilyCss = fontFamily === 'sans' ? '"Arial", "Helvetica", sans-serif' : '"Courier New", "Consolas", monospace';
    const baseWeight = fontWeight === 'ultra' ? 800 : fontWeight === 'normal' ? 500 : 700;
    const strongWeight = Math.min(900, baseWeight + 200);
    const contrastFilter = contrast === 'ultra' ? 'grayscale(1) contrast(3) brightness(0.85)' : contrast === 'high' ? 'grayscale(1) contrast(2) brightness(0.95)' : 'grayscale(1) contrast(1.4)';
    const lineHeight = lineSpacing === 'compact' ? 1.2 : lineSpacing === 'comfortable' ? 1.6 : 1.4;
    const secPad = lineSpacing === 'compact' ? '3px 4px' : lineSpacing === 'comfortable' ? '8px 4px' : '5px 4px';
    const cap = (s) => allCaps ? String(s || '').toUpperCase() : String(s || '');
    const dashLine = { borderBottom: '1px solid #000', borderTop: 'none' };
    const textDarkenShadow = fontWeight === 'normal' ? 'none' : '0.6px 0 0 currentColor, 0 0.6px 0 currentColor, 0.4px 0.4px 0 currentColor';
    
    const rootStyle = {
      ...containerStyle, color: '#000', background: '#fff', fontFamily: fontFamilyCss, fontSize: fontSizeBase,
      fontWeight: baseWeight, lineHeight, letterSpacing: allCaps ? '0.02em' : 0, textShadow: textDarkenShadow,
      WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
    };

    return (
      <div className={`invoice-preview-container ${paperCfg.cssClass} paper-thermal`} ref={ref} {...(previewOnly ? {} : { id: 'invoice-preview' })} style={rootStyle}>
        <div style={{ padding: '8px 4px 6px', textAlign: headerAlign, ...dashLine, color: '#000' }}>
          {showLogo && profile?.logo && <img src={profile.logo} alt="" className="thermal-logo" style={{ maxHeight: 45, marginBottom: 4, filter: contrastFilter }} />}
          <div style={{ fontWeight: strongWeight, fontSize: '1.15em', letterSpacing: '0.02em' }}>{(headerCaps || allCaps) ? (profile?.businessName || '').toUpperCase() : (profile?.businessName || '')}</div>
          {tagline && <div style={{ fontSize: '0.85em', fontWeight: baseWeight, fontStyle: 'italic' }}>{cap(tagline)}</div>}
          {profile?.address && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap(profile.address)}</div>}
          {(profile?.city || profile?.state || profile?.pin) && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap([profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', '))}</div>}
          {profile?.gstin && <div style={{ fontSize: '0.9em', fontWeight: strongWeight, marginTop: 2 }}>{cap('GSTIN: ' + profile.gstin)}</div>}
          {profile?.phone && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap('Ph: ' + profile.phone)}</div>}
        </div>
        <div style={{ padding: secPad, textAlign: 'center', fontWeight: strongWeight, textTransform: 'uppercase', fontSize: '1.05em', letterSpacing: '0.08em', ...dashLine }}>
          {docTitle}
        </div>
        <div style={{ padding: secPad, fontSize: '0.95em', fontWeight: baseWeight, ...dashLine }}>
          <div><strong style={{ fontWeight: strongWeight }}>{cap('Invoice #')}: </strong>{cap(invoiceNum)}</div>
          <div><strong style={{ fontWeight: strongWeight }}>{cap('Date')}: </strong>{cap(invoiceDate)}</div>
          {client?.name && <div style={{ marginTop: 3 }}><strong style={{ fontWeight: strongWeight }}>{cap('Bill to')}: </strong>{cap(client.name)}</div>}
          {client?.gstin && <div>{cap('GSTIN: ' + client.gstin)}</div>}
          {client?.phone && <div>{cap('Ph: ' + client.phone)}</div>}
        </div>
        {(() => {
          const amountColMm = isNarrow ? 16 : paperCfg.widthMm < 100 ? 22 : 26;
          const gridCols = `1fr ${amountColMm}mm`;
          return (
            <div style={{ padding: secPad, ...dashLine }}>
              <div style={{ display: 'grid', gridTemplateColumns: gridCols, fontWeight: strongWeight, paddingBottom: 3, marginBottom: 3, borderBottom: '1px solid #000', fontSize: '0.95em', textTransform: 'uppercase', gap: '4px' }}>
                <span>Item</span>
                <span style={{ textAlign: 'right' }}>{isVeryNarrow ? 'Amt' : 'Amount'}</span>
              </div>
              {(items || []).map((item, idx) => {
                const amount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                const qty = Number(item.quantity) || 0;
                const rate = Number(item.rate) || 0;
                const tax = showGST && item.taxPercent > 0 ? ` +${item.taxPercent}%` : '';
                const hsnBit = showHSNThermal && item.hsn && !isVeryNarrow ? '  |  HSN ' + item.hsn : '';
                return (
                  <div key={idx} style={{ marginBottom: 5, fontSize: '0.95em' }}>
                    <div style={{ fontWeight: strongWeight, wordBreak: 'break-word' }}>{(idx + 1) + '. ' + cap(item.name || item.description || 'Item')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px', fontSize: '0.92em', paddingLeft: thermalCompact ? 0 : 8, fontWeight: baseWeight }}>
                      <span style={{ wordBreak: 'break-word' }}>{cap(showRate ? `${qty}${item.unit ? ' ' + item.unit : ''} × ${currencySymbolThermal}${rate.toFixed(2)}${tax}${hsnBit}` : `${qty}${item.unit ? ' ' + item.unit : ''}${hsnBit}`)}</span>
                      <span style={{ textAlign: 'right', fontWeight: strongWeight }}>{currencySymbolThermal}{amount.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {(() => {
          const totalsColMm = isNarrow ? 18 : paperCfg.widthMm < 100 ? 24 : 30;
          const gridCols = `1fr ${totalsColMm}mm`;
          const rowStyle = { display: 'grid', gridTemplateColumns: gridCols, gap: '4px' };
          const amt = (n) => currencySymbolThermal + (Number(n) || 0).toFixed(2);
          return (
            <div style={{ padding: secPad, fontSize: '1em', fontWeight: baseWeight, ...dashLine }}>
              <div style={rowStyle}><span>{cap('Subtotal')}</span><span style={{ textAlign: 'right' }}>{amt(totals?.subtotal)}</span></div>
              {Number(totals?.totalDiscount) > 0 && <div style={rowStyle}><span>{cap('Discount')}</span><span style={{ textAlign: 'right' }}>-{amt(totals.totalDiscount)}</span></div>}
              {showGST && Number(totals?.cgst) > 0 && <div style={rowStyle}><span>{cap('CGST')}</span><span style={{ textAlign: 'right' }}>{amt(totals.cgst)}</span></div>}
              {showGST && Number(totals?.sgst) > 0 && <div style={rowStyle}><span>{cap('SGST')}</span><span style={{ textAlign: 'right' }}>{amt(totals.sgst)}</span></div>}
              {showGST && Number(totals?.igst) > 0 && <div style={rowStyle}><span>{cap('IGST')}</span><span style={{ textAlign: 'right' }}>{amt(totals.igst)}</span></div>}
              {Number(totals?.cess) > 0 && <div style={rowStyle}><span>{cap('Cess')}</span><span style={{ textAlign: 'right' }}>{amt(totals.cess)}</span></div>}
              {showRoundOff && Number(totals?.roundOff) !== 0 && <div style={rowStyle}><span>{cap('Round-off')}</span><span style={{ textAlign: 'right' }}>{Number(totals.roundOff) > 0 ? '+' : ''}{amt(totals.roundOff)}</span></div>}
              <div style={{ ...rowStyle, fontWeight: strongWeight, fontSize: '1.2em', marginTop: 4, paddingTop: 4, borderTop: '1px solid #000', borderBottom: '2px solid #000', paddingBottom: 4 }}>
                <span>{cap('TOTAL')}</span><span style={{ textAlign: 'right' }}>{amt(totals?.total)}</span>
              </div>
            </div>
          );
        })()}
        {opt('showAmountWords') && <div style={{ padding: secPad, fontSize: '0.9em', textAlign: 'center', ...dashLine, fontStyle: 'italic', fontWeight: baseWeight }}>{cap(amountInWords(totals?.total || 0))}</div>}
        {opt('showBankDetails') && (account?.bankName || profile?.bankName) && (
          <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }}>
            <div style={{ fontWeight: strongWeight, textAlign: 'center', marginBottom: 3 }}>{cap('BANK DETAILS')}</div>
            {account?.accountHolderName && account.accountHolderName.trim() && <div>{cap(account.accountHolderName)}</div>}
            <div>{cap(account?.bankName || profile?.bankName)}</div>
            {(account?.accountNumber || profile?.accountNumber) && <div>{cap('A/c: ' + (account?.accountNumber || profile?.accountNumber))}{account?.accountType ? ' · ' + cap(({ savings: 'Sav', current: 'Cur', cc: 'CC', od: 'OD', nre: 'NRE', nro: 'NRO' })[account.accountType] || account.accountType) : ''}</div>}
            {(account?.ifsc || profile?.ifsc) && <div>{cap('IFSC: ' + (account?.ifsc || profile?.ifsc))}</div>}
          </div>
        )}
        {opt('showUPI') && qrDataUrl && (() => {
          const isCustomThermal = paperCfg.cssClass === 'paper-thermal-custom';
          const size = isCustomThermal ? Math.min(qrSizePx, Math.round(paperCfg.widthMm * 3.78 * 0.55)) : (isNarrow ? Math.min(qrSizePx, 90) : qrSizePx);
          return (
            <div style={{ padding: secPad, textAlign: 'center', ...dashLine }}>
              <img src={qrDataUrl} alt="UPI QR" className="thermal-qr" style={{ width: size, height: size, filter: contrastFilter }} />
              <div style={{ fontSize: '0.85em', fontWeight: strongWeight }}>{cap('Scan to pay via UPI')}</div>
            </div>
          );
        })()}
        {opt('showNotes') && customNotes && <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(customNotes) }} />}
        {footerMessage && (
          <div style={{ padding: '6px 4px 6px', textAlign: 'center', fontSize: '0.95em', fontWeight: strongWeight }}>
            {cap(`*** ${footerMessage} ***`)}
            {profile?.email && <div style={{ fontWeight: baseWeight, marginTop: 2 }}>{cap(profile.email)}</div>}
          </div>
        )}
        {cutMark && <div style={{ padding: '10px 4px 4px', textAlign: 'center', fontSize: '0.85em', letterSpacing: '0.15em', color: '#000', fontFamily: 'monospace', fontWeight: strongWeight }}>{'- - - - -  ✂  CUT HERE  ✂  - - - - -'}</div>}
        {feedLines > 0 && <div style={{ height: `${feedLines * 8}px` }} />}
      </div>
    );
  }

  // ============================================================================
  // EXACT MARG ERP PHARMA FORMAT (REPLACES ALL A4 LAYOUTS)
  // ============================================================================

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
                  {profile?.businessName || 'buisness name'}
                </div>
                <div>Pharmaceutical Distributors</div>
                <div>{profile?.address}</div>
                <div>{[profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', ')}</div>
                <div>Phone : {profile?.phone}</div>
                <div>Licence No. : {details?.sellerLicence || 'for ex:20B/9612..........2026'}</div>
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

                <div className="font-bold">M/s {client?.name || 'sample name '}</div>
                <div>{client?.address}</div>
                <div>{[client?.city, client?.state, client?.pin].filter(Boolean).join(', ')}</div>
                <div>Ph.No.: {client?.phone}</div>
                <div>GST : {client?.gstin} &nbsp;&nbsp;&nbsp; Licence No. : {client?.licence || 'for ex: 20B/76/................2026'}</div>
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
              const lineAmount = item.quantity * item.rate;
              const discount = resolveLineDiscount(item);
              const grossAfterDiscount = Math.max(0, lineAmount - discount);
              const taxRate = item.taxPercent || 0;
              const isTaxInclusive = totals.taxInclusive;
              const afterDiscount = isTaxInclusive && showGST ? grossAfterDiscount / (1 + taxRate / 100) : grossAfterDiscount;
              const taxAmount = isTaxInclusive && showGST ? grossAfterDiscount - afterDiscount : afterDiscount * taxRate / 100;
              const halfTax = taxAmount / 2;
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
                  <td className="text-right">{discount > 0 ? discount : '0.00'}</td>
                 <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>
                 <td className="text-right">{halfRate > 0 ? halfRate.toFixed(2) : '0.00'}</td>
                  <td className="text-right">{afterDiscount.toFixed(2)}</td>
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
  {(() => {
    const gstSlabs = [5, 12, 18, 28];
    
    // Calculate totals for each slab dynamically
    const slabData = gstSlabs.map(slab => {
      let total = 0, disc = 0, sgst = 0, cgst = 0;
      
      items.forEach(item => {
        if ((item.taxPercent || 0) === slab) {
          const lineAmount = (item.quantity || 0) * (item.rate || 0);
          const actualDiscount = resolveLineDiscount(item);
          const gross = Math.max(0, lineAmount - actualDiscount);
          
          const isTaxInclusive = totals.taxInclusive;
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

    // Calculate grand totals for the bottom row
    const sumTotal = slabData.reduce((acc, d) => acc + d.total, 0);
    const sumDisc = slabData.reduce((acc, d) => acc + d.disc, 0);
    const sumSgst = slabData.reduce((acc, d) => acc + d.sgst, 0);
    const sumCgst = slabData.reduce((acc, d) => acc + d.cgst, 0);
    const sumTotalGst = slabData.reduce((acc, d) => acc + d.totalGst, 0);

    return (
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
    );
  })()}
</td>
              <td style={{ width: '35%', padding: 0, border: 'none' }}>
                <table className="marg-table" style={{ height: '100%', border: 'none', marginBottom: 0 }}>
                  <tbody>
                    <tr>
                      <td className="no-border-top">SUB TOTAL</td>
                      <td className="no-border-top no-border-right text-right">{totals.subtotal?.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>SGST PAYBLE</td>
                      <td className="no-border-right text-right">{totals.sgst?.toFixed(2) || '0.00'}</td>
                    </tr>
                    <tr>
                      <td>CGST PAYBLE</td>
                      <td className="no-border-right text-right">{totals.cgst?.toFixed(2) || '0.00'}</td>
                    </tr>
                    <tr>
                      <td>ADD/LESS</td>
                      <td className="no-border-right text-right">{totals.roundOff?.toFixed(2) || '0.00'}</td>
                    </tr>
                    <tr className="font-bold" style={{ fontSize: '13px' }}>
                      <td className="no-border-bottom">GRAND TOTAL</td>
                      <td className="no-border-bottom no-border-right text-right">{totals.total?.toFixed(2)}</td>
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
                Rs. {amountInWords(totals.total)}
              </td>
            </tr>
            <tr>
              <td style={{ width: '40%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none', borderLeft: 'none' }}>
                <div className="font-bold" style={{ textDecoration: 'underline', marginBottom: '2px' }}>Terms & Conditions</div>
                <div style={{ fontSize: '10px', lineHeight: '1.4' }} dangerouslySetInnerHTML={{ __html: customTerms || '1. Goods once sold will not be taken back & exchanged.<br/>2. Payment should be done within 15 days of bill date.<br/>3. @24% P.A. Interest will be charged if payment not done on time.' }} />
              </td>
              <td style={{ width: '30%', padding: '4px', borderRight: '1px solid #000', borderBottom: 'none' }}>
                <div className="font-bold text-center" style={{ textDecoration: 'underline', marginBottom: '4px' }}>BANK DETAIL</div>
                <div className="font-bold">{profile?.businessName || 'buisness name '}</div>
                <div className="font-bold">bank name </div>
                <div className="font-bold">A/C NO. {account?.accountNumber || profile?.accountNumber || 'account no'}</div>
                <div className="font-bold">IFSC CODE {account?.ifsc || profile?.ifsc || 'ifsc code'}</div>
              </td>
              <td style={{ width: '30%', padding: '4px', textAlign: 'center', verticalAlign: 'top', borderRight: 'none', borderBottom: 'none' }}>
                <div className="font-bold" style={{ textAlign: 'right', fontSize: '10px' }}>
                  For {profile?.businessName || 'buisness name'}
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