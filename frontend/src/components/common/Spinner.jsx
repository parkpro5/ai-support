export function InlineSpinner({ size = 14, color = '#fff', trackColor = 'rgba(255,255,255,0.4)' }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${trackColor}`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

export default function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-5)' }}>
      <InlineSpinner size={28} color="var(--color-primary)" trackColor="var(--color-border)" />
    </div>
  );
}
