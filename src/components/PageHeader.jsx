/**
 * Reusable page-header card.
 *
 * Props:
 *   icon      emoji / string / element rendered inside the 44px badge
 *   title     page title (h1)
 *   subtitle  one-line description shown below the title
 *   meta      optional short string rendered as a pill next to the subtitle
 *   children  right-hand slot for action buttons, HelpButton, etc.
 */
export default function PageHeader({ icon, title, subtitle, meta, children }) {
  return (
    <div className="page-header" style={{
      padding: '1.1rem 1.35rem',
      background: 'linear-gradient(135deg, rgba(var(--primary-rgb), 0.12), var(--card-bg))',
      border: '1px solid var(--border)',
      borderRadius: 12,
      marginBottom: '1.25rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        {icon !== undefined && (
          <div style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, var(--primary), var(--primary-darker))',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.15rem',
            boxShadow: '0 6px 18px rgba(var(--primary-rgb), 0.35)',
            flexShrink: 0,
          }}>{icon}</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0 }}>{title}</h1>
          {(subtitle || meta) && (
            <p className="page-subtitle" style={{ margin: '0.15rem 0 0', display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              {subtitle && <span>{subtitle}</span>}
              {meta && (
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.5rem',
                  borderRadius: 999,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}>{meta}</span>
              )}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}