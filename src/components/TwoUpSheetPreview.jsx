import { useEffect, useRef, useState } from 'react';

/**
 * Renders two identical copies of an invoice stacked top-and-bottom on one
 * A4 Portrait sheet (210mm × 297mm), stretched across the full width and
 * height of each half-page slot with minimal border margins and a center
 * horizontal tear line (Client Copy + Office/Self Copy).
 */
export default function TwoUpSheetPreview({
  enabled = true,
  showLabels = true,
  showCutLine = true,
  leftLabel = 'CLIENT COPY',
  rightLabel = 'OFFICE / SELF COPY',
  renderPrimary,
  renderSecondary,
}) {
  const measureRef = useRef(null);
  const [billRatio, setBillRatio] = useState(0.82);

  useEffect(() => {
    if (!enabled || !measureRef.current) return;
    const el = measureRef.current;
    const update = () => {
      const w = el.scrollWidth || el.offsetWidth || 794;
      const h = el.scrollHeight || el.offsetHeight || 650;
      if (w > 100 && h > 100) {
        setBillRatio(h / w);
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  if (!enabled) {
    return <>{renderPrimary()}</>;
  }

  const slotW_mm = 205; // 210mm - 2.5mm left - 2.5mm right
  const labelHeight_mm = showLabels ? 3.2 : 0;
  const centerGap_mm = 4.5;
  const slotH_mm = +((297 - 2 - 2 - centerGap_mm - labelHeight_mm * 2) / 2).toFixed(2);
  const naturalHeight_mm = 210 * billRatio;
  const scaleX = +(slotW_mm / 210).toFixed(4);
  const scaleY = +(slotH_mm / Math.max(40, naturalHeight_mm)).toFixed(4);
  const halfHeight_mm = +(slotH_mm + labelHeight_mm).toFixed(2);

  return (
    <div
      className="two-up-sheet-frame"
      style={{
        width: '210mm',
        minHeight: '297mm',
        background: '#ffffff',
        padding: '2mm 2.5mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 0,
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.10)',
        border: '1px solid #e5e7eb',
        borderRadius: 4,
      }}
    >
      {/* Top Half — Client Copy */}
      <div
        className="two-up-column"
        style={{
          width: '100%',
          height: `${halfHeight_mm}mm`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {showLabels && (
          <div
            className="two-up-hide-on-capture"
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#475569',
              height: `${labelHeight_mm}mm`,
              lineHeight: `${labelHeight_mm}mm`,
              textTransform: 'uppercase',
            }}
          >
            {leftLabel}
          </div>
        )}
        <div
          className="two-up-slot"
          style={{
            width: `${slotW_mm}mm`,
            height: `${slotH_mm}mm`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            ref={measureRef}
            className="two-up-scale-box"
            style={{
              width: '210mm',
              transform: `scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
            }}
          >
            {renderPrimary()}
          </div>
        </div>
      </div>

      {/* Center Horizontal Tear Divider */}
      <div
        className="two-up-hide-on-capture"
        style={{
          width: '100%',
          height: `${centerGap_mm}mm`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        {showCutLine && (
          <>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '50%',
                borderTop: '1.5px dashed #94a3b8',
              }}
            />
            <span
              style={{
                fontSize: '8px',
                fontWeight: 700,
                color: '#64748b',
                letterSpacing: '0.06em',
                background: '#fff',
                padding: '0 8px',
                zIndex: 1,
                lineHeight: 1.1,
              }}
            >
              ✂ TEAR
            </span>
          </>
        )}
      </div>

      {/* Bottom Half — Office / Self Copy */}
      <div
        className="two-up-column two-up-hide-on-capture"
        style={{
          width: '100%',
          height: `${halfHeight_mm}mm`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {showLabels && (
          <div
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#475569',
              height: `${labelHeight_mm}mm`,
              lineHeight: `${labelHeight_mm}mm`,
              textTransform: 'uppercase',
            }}
          >
            {rightLabel}
          </div>
        )}
        <div
          className="two-up-slot"
          style={{
            width: `${slotW_mm}mm`,
            height: `${slotH_mm}mm`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            className="two-up-scale-box"
            style={{
              width: '210mm',
              transform: `scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
            }}
          >
            {renderSecondary ? renderSecondary() : renderPrimary()}
          </div>
        </div>
      </div>
    </div>
  );
}
