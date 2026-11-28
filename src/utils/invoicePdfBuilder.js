// src/utils/invoicePdfBuilder.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure PDF layout & compositing helpers for single-page (1-up A4) and
// tear-sheet (2-up top & bottom A4 Portrait: Client Copy + Office Copy) bills.
// Preserves the exact invoice layout while filling each half-sheet edge-to-edge.
// ─────────────────────────────────────────────────────────────────────────────

export const A4_PORTRAIT_W_MM = 210;
export const A4_PORTRAIT_H_MM = 297;

/**
 * Computes edge-to-edge placement for 2 identical bills stacked top-and-bottom
 * on one A4 Portrait sheet (210mm × 297mm) with minimal page border margins
 * and a center horizontal tear line.
 */
export function computeTwoUpLayout({
  canvasWidth,
  canvasHeight,
  marginTop = 0,
  marginBottom = 0,
  marginLeft = 0,
  marginRight = 0,
  showLabels = true,
} = {}) {
  const pageWidth = A4_PORTRAIT_W_MM;
  const pageHeight = A4_PORTRAIT_H_MM;

  const padLeft = Math.max(2.5, Number(marginLeft) || 0);
  const padRight = Math.max(2.5, Number(marginRight) || 0);
  const padTop = Math.max(2, Number(marginTop) || 0);
  const padBottom = Math.max(2, Number(marginBottom) || 0);
  const centerGap = 4.5; // 2.25mm gutter above and below the center tear line
  const labelHeight = showLabels ? 3.2 : 0;

  const slotW = Math.max(20, pageWidth - padLeft - padRight);
  const slotH = Math.max(20, (pageHeight - padTop - padBottom - centerGap - labelHeight * 2) / 2);

  const topLabelY = padTop;
  const topSlotY = padTop + labelHeight;
  const cutY = topSlotY + slotH + centerGap / 2;
  const bottomLabelY = topSlotY + slotH + centerGap;
  const bottomSlotY = bottomLabelY + labelHeight;

  const cw = Math.max(1, Number(canvasWidth) || 1);
  const ch = Math.max(1, Number(canvasHeight) || 1);

  const aspectRatio = ch / cw;
  const isMultiPage = aspectRatio > 1.55;

  // Stretch single-page bills across the full half-sheet width and height
  // (leaving only the minimal outer margin with the page borders).
  const drawW = slotW;
  const drawH = slotH;

  const drawX = padLeft;
  const topY = topSlotY;
  const bottomY = bottomSlotY;

  return {
    pageWidth,
    pageHeight,
    padTop,
    padBottom,
    padLeft,
    padRight,
    centerGap,
    labelHeight,
    slotW,
    slotH,
    cutY,
    topLabelY,
    bottomLabelY,
    topSlotY,
    bottomSlotY,
    drawX,
    topY,
    bottomY,
    drawW,
    drawH,
    isMultiPage,
  };
}

function drawTwoUpDecorations(pdf, layout, printSettings) {
  const showCut = printSettings?.twoPerPageShowCutLine !== false;
  const showLabels = printSettings?.twoPerPageShowLabels !== false;

  if (showCut) {
    pdf.saveGraphicsState?.();
    pdf.setDrawColor(135, 135, 135);
    pdf.setLineWidth(0.25);
    if (typeof pdf.setLineDashPattern === 'function') {
      pdf.setLineDashPattern([2, 2], 0);
    }
    pdf.line(layout.padLeft, layout.cutY, layout.pageWidth - layout.padRight, layout.cutY);
    if (typeof pdf.setLineDashPattern === 'function') {
      pdf.setLineDashPattern([], 0);
    }
    if (typeof pdf.setFillColor === 'function' && typeof pdf.rect === 'function') {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(layout.pageWidth / 2 - 7, layout.cutY - 1.5, 14, 3, 'F');
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(120, 120, 120);
    pdf.text('TEAR', layout.pageWidth / 2, layout.cutY + 0.8, { align: 'center' });
    pdf.restoreGraphicsState?.();
  }

  if (showLabels) {
    const topLabel = printSettings?.twoPerPageLeftLabel || 'CLIENT COPY';
    const bottomLabel = printSettings?.twoPerPageRightLabel || 'OFFICE / SELF COPY';
    const centerX = layout.drawX + layout.drawW / 2;
    pdf.saveGraphicsState?.();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(70, 70, 70);
    pdf.text(topLabel, centerX, layout.topLabelY + 2.3, { align: 'center' });
    pdf.text(bottomLabel, centerX, layout.bottomLabelY + 2.3, { align: 'center' });
    pdf.restoreGraphicsState?.();
  }
}

/**
 * Generates a jsPDF document from a captured invoice canvas, supporting:
 * - 2-up top & bottom tear sheet on A4 Portrait (Client + Office copy)
 * - Standard 1-up A4 Portrait (with multi-page strip slicing)
 * - Thermal continuous roll PDF
 */
export function composeInvoicePdfFromCanvas({
  jsPDF,
  canvas,
  paperCfg,
  printSettings = {},
  imgFormat = 'JPEG',
  quality = 0.95,
}) {
  const mimeType = imgFormat === 'PNG' ? 'image/png' : 'image/jpeg';
  const mTop = Math.max(0, Number(printSettings.marginTop) || 0);
  const mBottom = Math.max(0, Number(printSettings.marginBottom) || 0);
  const mLeft = Math.max(0, Number(printSettings.marginLeft) || 0);
  const mRight = Math.max(0, Number(printSettings.marginRight) || 0);

  // 2-bills-per-page top & bottom tear sheet (for sheet paper like A4)
  if (printSettings.twoPerPageEnabled && paperCfg?.kind !== 'thermal') {
    const showLabels = printSettings.twoPerPageShowLabels !== false;
    const layout = computeTwoUpLayout({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      marginTop: mTop,
      marginBottom: mBottom,
      marginLeft: mLeft,
      marginRight: mRight,
      showLabels,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    if (!layout.isMultiPage) {
      const imgData = canvas.toDataURL(mimeType, quality);
      drawTwoUpDecorations(pdf, layout, printSettings);
      pdf.addImage(imgData, imgFormat, layout.drawX, layout.topY, layout.drawW, layout.drawH, undefined, 'MEDIUM');
      pdf.addImage(imgData, imgFormat, layout.drawX, layout.bottomY, layout.drawW, layout.drawH, undefined, 'MEDIUM');
      return pdf;
    }

    // Multi-page 2-up (very long bills): slice vertically and stack mirrors onto each sheet
    const stripPxH = Math.max(100, Math.floor((layout.slotH * canvas.width) / layout.slotW));
    const totalStrips = Math.ceil(canvas.height / stripPxH);
    for (let i = 0; i < totalStrips; i++) {
      if (i > 0) pdf.addPage('a4', 'portrait');
      const sy = i * stripPxH;
      const sh = Math.min(stripPxH, canvas.height - sy);
      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = canvas.width;
      stripCanvas.height = sh;
      stripCanvas.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);

      const stripH_mm = (sh * layout.slotW) / canvas.width;
      const stripImg = stripCanvas.toDataURL(mimeType, quality);
      drawTwoUpDecorations(pdf, layout, printSettings);
      pdf.addImage(stripImg, imgFormat, layout.drawX, layout.topY, layout.slotW, stripH_mm, undefined, 'MEDIUM');
      pdf.addImage(stripImg, imgFormat, layout.drawX, layout.bottomY, layout.slotW, stripH_mm, undefined, 'MEDIUM');
    }
    return pdf;
  }

  // Standard 1-bill-per-page (or thermal roll)
  let pdf = new jsPDF({
    orientation: paperCfg?.jsPdfOrientation || 'portrait',
    unit: 'mm',
    format: paperCfg?.jsPdfFormat || 'a4',
    compress: true,
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfPageHeight = pdf.internal.pageSize.getHeight();
  const availWidth = Math.max(20, pdfWidth - mLeft - mRight);
  const availHeight = Math.max(20, pdfPageHeight - mTop - mBottom);
  const scaledImgHeight = (canvas.height * availWidth) / canvas.width;

  if (paperCfg?.kind === 'thermal') {
    const mainImg = canvas.toDataURL(mimeType, quality);
    const thermalHeightMm = Math.max(30, Math.ceil(scaledImgHeight + mTop + mBottom + 2));
    pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [paperCfg.widthMm, thermalHeightMm],
      compress: true,
    });
    pdf.addImage(mainImg, imgFormat, mLeft, mTop, availWidth, scaledImgHeight, undefined, 'MEDIUM');
    return pdf;
  }

  const drawCopyLabel = (label) => {
    if (!label) return;
    pdf.saveGraphicsState?.();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(70, 70, 70);
    pdf.text(String(label), pdfWidth - Math.max(4, mRight), Math.max(4.5, mTop > 2 ? mTop - 1.5 : 4.5), { align: 'right' });
    pdf.restoreGraphicsState?.();
  };

  const drawContinuationDecor = (pageIdx, totalPages) => {
    if (pageIdx > 0 && printSettings.pageHeaderEnabled && printSettings.businessName) {
      pdf.saveGraphicsState?.();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(80, 80, 80);
      pdf.text(String(printSettings.businessName), Math.max(4, mLeft), Math.max(4.5, mTop + 3.5));
      pdf.restoreGraphicsState?.();
    }
    if (totalPages > 1 && pageIdx > 0 && printSettings.pageNumbersEnabled) {
      pdf.saveGraphicsState?.();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Page ${pageIdx + 1} of ${totalPages}`, pdfWidth - Math.max(4, mRight), pdfPageHeight - Math.max(3, mBottom + 1), { align: 'right' });
      pdf.restoreGraphicsState?.();
    }
  };

  const copyCount = printSettings.multiCopyEnabled
    ? Math.max(1, Math.min(3, Number(printSettings.multiCopyCount) || 3))
    : 1;
  const defaultCopyLabels = ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER'];
  const copyLabels = Array.isArray(printSettings.multiCopyLabels) && printSettings.multiCopyLabels.length > 0
    ? printSettings.multiCopyLabels
    : defaultCopyLabels;

  const singlePageImg = scaledImgHeight <= availHeight + 2 ? canvas.toDataURL(mimeType, quality) : null;

  for (let copyIdx = 0; copyIdx < copyCount; copyIdx++) {
    if (copyIdx > 0) pdf.addPage();
    const copyLabel = printSettings.multiCopyEnabled
      ? (copyLabels[copyIdx] || `COPY ${copyIdx + 1}`)
      : '';

    if (singlePageImg) {
      const finalH = Math.min(scaledImgHeight, availHeight);
      pdf.addImage(singlePageImg, imgFormat, mLeft, mTop, availWidth, finalH, undefined, 'MEDIUM');
      if (copyLabel) drawCopyLabel(copyLabel);
    } else {
      const slicePxH = Math.max(100, Math.floor((availHeight * canvas.width) / availWidth));
      const totalSlices = Math.ceil(canvas.height / slicePxH);
      for (let i = 0; i < totalSlices; i++) {
        if (i > 0) pdf.addPage();
        const sy = i * slicePxH;
        const sh = Math.min(slicePxH, canvas.height - sy);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sh;
        slice.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        const headerOffset = (i > 0 && printSettings.pageHeaderEnabled && printSettings.businessName) ? 6 : 0;
        const sliceH_mm = Math.min(availHeight - headerOffset, (sh * availWidth) / canvas.width);
        pdf.addImage(slice.toDataURL(mimeType, quality), imgFormat, mLeft, mTop + headerOffset, availWidth, sliceH_mm, undefined, 'MEDIUM');
        if (i === 0 && copyLabel) drawCopyLabel(copyLabel);
        drawContinuationDecor(i, totalSlices);
      }
    }
  }

  return pdf;
}
