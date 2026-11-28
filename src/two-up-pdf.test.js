import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_PRINT_SETTINGS } from './utils/printSettings.js';
import {
  A4_PORTRAIT_W_MM,
  A4_PORTRAIT_H_MM,
  computeTwoUpLayout,
  composeInvoicePdfFromCanvas,
} from './utils/invoicePdfBuilder.js';

function createMockJsPdfClass() {
  const instances = [];

  class MockJsPDF {
    constructor(opts = {}) {
      this.opts = opts;
      this.calls = {
        addImage: [],
        addPage: [],
        line: [],
        rect: [],
        text: [],
        dashPatterns: [],
      };
      const isLandscape = opts.orientation === 'landscape';
      let w = isLandscape ? 297 : 210;
      let h = isLandscape ? 210 : 297;
      if (Array.isArray(opts.format) && opts.format.length === 2) {
        w = opts.format[0];
        h = opts.format[1];
      }
      this.internal = {
        pageSize: {
          getWidth: () => w,
          getHeight: () => h,
        },
      };
      instances.push(this);
    }

    saveGraphicsState() {}
    restoreGraphicsState() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    setFont() {}
    setFontSize() {}
    setTextColor() {}

    rect(x, y, w, h, style) {
      this.calls.rect.push({ x, y, w, h, style });
    }

    setLineDashPattern(pattern, phase) {
      this.calls.dashPatterns.push({ pattern, phase });
    }

    line(x1, y1, x2, y2) {
      this.calls.line.push({ x1, y1, x2, y2 });
    }

    text(label, x, y, opts) {
      this.calls.text.push({ label, x, y, opts });
    }

    addPage(format, orientation) {
      this.calls.addPage.push({ format, orientation });
    }

    addImage(img, fmt, x, y, w, h, alias, compression) {
      this.calls.addImage.push({ img, fmt, x, y, w, h, alias, compression });
    }
  }

  return { MockJsPDF, instances };
}

function createMockCanvas(width = 2100, height = 1800) {
  return {
    width,
    height,
    toDataURL: vi.fn((mime) => `data:${mime};base64,MOCK_${width}x${height}`),
  };
}

describe('2-Bills-Per-Page Tear Sheet Print Settings', () => {
  it('defaults to 2 bills per page enabled with cut line and copy labels', () => {
    expect(DEFAULT_PRINT_SETTINGS.twoPerPageEnabled).toBe(true);
    expect(DEFAULT_PRINT_SETTINGS.twoPerPageShowCutLine).toBe(true);
    expect(DEFAULT_PRINT_SETTINGS.twoPerPageShowLabels).toBe(true);
    expect(DEFAULT_PRINT_SETTINGS.twoPerPageLeftLabel).toBe('CLIENT COPY');
    expect(DEFAULT_PRINT_SETTINGS.twoPerPageRightLabel).toBe('OFFICE / SELF COPY');
  });
});

describe('computeTwoUpLayout (Top & Bottom A4 Portrait)', () => {
  it('fills top & bottom slots edge-to-edge across A4 Portrait with minimal page margins', () => {
    const layout = computeTwoUpLayout({
      canvasWidth: 2100,
      canvasHeight: 1700,
      showLabels: true,
    });

    expect(layout.pageWidth).toBe(A4_PORTRAIT_W_MM);
    expect(layout.pageHeight).toBe(A4_PORTRAIT_H_MM);
    expect(layout.isMultiPage).toBe(false);

    // Stretches across full available width & half-sheet height with minimal border gap (<= 3mm)
    expect(layout.padLeft).toBeLessThanOrEqual(3);
    expect(layout.padRight).toBeLessThanOrEqual(3);
    expect(layout.drawW).toBe(layout.slotW);
    expect(layout.drawH).toBe(layout.slotH);
    expect(layout.drawW).toBeGreaterThanOrEqual(204);
    expect(layout.drawX).toBe(layout.padLeft);
    expect(layout.drawX + layout.drawW).toBe(layout.pageWidth - layout.padRight);

    // Top copy sits above the center horizontal tear line; bottom copy sits below it
    expect(layout.topY + layout.drawH).toBeLessThan(layout.cutY);
    expect(layout.cutY).toBeLessThan(layout.bottomY);
    expect(layout.bottomY + layout.drawH).toBeCloseTo(layout.pageHeight - layout.padBottom, 2);
    expect(layout.cutY).toBeCloseTo(A4_PORTRAIT_H_MM / 2, 1);
  });

  it('gives slightly more vertical height when copy labels are turned off', () => {
    const withLabels = computeTwoUpLayout({ canvasWidth: 2100, canvasHeight: 1800, showLabels: true });
    const noLabels = computeTwoUpLayout({ canvasWidth: 2100, canvasHeight: 1800, showLabels: false });

    expect(withLabels.labelHeight).toBeGreaterThan(0);
    expect(noLabels.labelHeight).toBe(0);
    expect(noLabels.slotH).toBeGreaterThan(withLabels.slotH);
    expect(noLabels.drawH).toBeGreaterThan(withLabels.drawH);
  });

  it('keeps even a full A4-ratio single-page bill on 1 stacked sheet and flags extra-tall invoices as multi-page', () => {
    const fullSinglePage = computeTwoUpLayout({
      canvasWidth: 2100,
      canvasHeight: 2970,
      showLabels: true,
    });
    expect(fullSinglePage.isMultiPage).toBe(false);

    const tallLayout = computeTwoUpLayout({
      canvasWidth: 2100,
      canvasHeight: 6500,
      showLabels: true,
    });
    expect(tallLayout.isMultiPage).toBe(true);
  });
});

describe('composeInvoicePdfFromCanvas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const a4Cfg = {
    kind: 'sheet',
    widthMm: 210,
    jsPdfFormat: 'a4',
    jsPdfOrientation: 'portrait',
  };

  it('creates an A4 Portrait PDF with two identical proportionally scaled copies stacked top & bottom and horizontal tear markings', () => {
    const { MockJsPDF, instances } = createMockJsPdfClass();
    const canvas = createMockCanvas(2100, 1800);

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: a4Cfg,
      printSettings: { ...DEFAULT_PRINT_SETTINGS, twoPerPageEnabled: true },
    });

    expect(instances).toHaveLength(1);
    const pdf = instances[0];
    expect(pdf.opts).toMatchObject({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    expect(pdf.calls.addImage).toHaveLength(2);

    const [topImg, bottomImg] = pdf.calls.addImage;
    expect(topImg.w).toBeCloseTo(bottomImg.w, 5);
    expect(topImg.h).toBeCloseTo(bottomImg.h, 5);
    expect(topImg.x).toBeCloseTo(bottomImg.x, 5);
    expect(bottomImg.y).toBeGreaterThan(topImg.y + topImg.h);

    // Horizontal dashed tear line across width (y1 === y2, x2 > x1)
    expect(pdf.calls.line).toHaveLength(1);
    const tearLine = pdf.calls.line[0];
    expect(tearLine.y1).toBeCloseTo(tearLine.y2, 5);
    expect(tearLine.x2).toBeGreaterThan(tearLine.x1 + 180);
    expect(tearLine.y1).toBeGreaterThan(topImg.y + topImg.h);
    expect(tearLine.y1).toBeLessThan(bottomImg.y);
    expect(pdf.calls.dashPatterns.some((d) => Array.isArray(d.pattern) && d.pattern.length > 0)).toBe(true);

    const labels = pdf.calls.text.map((t) => t.label);
    expect(labels).toContain('TEAR');
    expect(labels).toContain('CLIENT COPY');
    expect(labels).toContain('OFFICE / SELF COPY');
  });

  it('respects custom toggles when cut line and labels are turned off', () => {
    const { MockJsPDF, instances } = createMockJsPdfClass();
    const canvas = createMockCanvas(2100, 1800);

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: a4Cfg,
      printSettings: {
        ...DEFAULT_PRINT_SETTINGS,
        twoPerPageEnabled: true,
        twoPerPageShowCutLine: false,
        twoPerPageShowLabels: false,
      },
    });

    const pdf = instances[0];
    expect(pdf.calls.addImage).toHaveLength(2);
    expect(pdf.calls.line).toHaveLength(0);
    expect(pdf.calls.text).toHaveLength(0);
  });

  it('renders a standard 1-bill-per-page A4 Portrait PDF when twoPerPageEnabled is false', () => {
    const { MockJsPDF, instances } = createMockJsPdfClass();
    const canvas = createMockCanvas(2100, 2970);

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: a4Cfg,
      printSettings: { ...DEFAULT_PRINT_SETTINGS, twoPerPageEnabled: false },
    });

    const pdf = instances[0];
    expect(pdf.opts).toMatchObject({ orientation: 'portrait', format: 'a4' });
    expect(pdf.calls.addImage).toHaveLength(1);
    expect(pdf.calls.line).toHaveLength(0);
    expect(pdf.calls.text).toHaveLength(0);
  });

  it('keeps thermal roll paper single-copy even if twoPerPageEnabled is true', () => {
    const { MockJsPDF, instances } = createMockJsPdfClass();
    const canvas = createMockCanvas(800, 1400);
    const thermalCfg = {
      kind: 'thermal',
      widthMm: 80,
      jsPdfFormat: [80, 297],
      jsPdfOrientation: 'portrait',
    };

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: thermalCfg,
      printSettings: { ...DEFAULT_PRINT_SETTINGS, twoPerPageEnabled: true },
    });

    const finalPdf = instances[instances.length - 1];
    expect(finalPdf.calls.addImage).toHaveLength(1);
    expect(Array.isArray(finalPdf.opts.format)).toBe(true);
    expect(finalPdf.opts.format[0]).toBe(80);
  });

  it('slices extra-tall invoices cleanly across multiple 2-up portrait pages', () => {
    const { MockJsPDF, instances } = createMockJsPdfClass();
    const canvas = createMockCanvas(2100, 6500);

    const createdStripCanvases = [];
    vi.stubGlobal('document', {
      createElement: vi.fn((tag) => {
        if (tag !== 'canvas') return {};
        const strip = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toDataURL: (mime) => `data:${mime};base64,STRIP_${strip.width}x${strip.height}`,
        };
        createdStripCanvases.push(strip);
        return strip;
      }),
    });

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: a4Cfg,
      printSettings: { ...DEFAULT_PRINT_SETTINGS, twoPerPageEnabled: true },
    });

    const pdf = instances[0];
    expect(pdf.calls.addPage.length).toBeGreaterThanOrEqual(1);
    expect(pdf.calls.addPage[0]).toEqual({ format: 'a4', orientation: 'portrait' });
    expect(createdStripCanvases.length).toBe(pdf.calls.addPage.length + 1);
    expect(pdf.calls.addImage).toHaveLength(createdStripCanvases.length * 2);
  });
});
