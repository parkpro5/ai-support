import { InlineSpinner } from './Spinner';

const VARIANT_STYLES = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
  danger: { background: 'var(--color-danger)', color: '#fff', border: 'none' },
  ghost: { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
};

const SPINNER_STYLES = {
  primary: { color: '#fff', trackColor: 'rgba(255,255,255,0.4)' },
  danger: { color: '#fff', trackColor: 'rgba(255,255,255,0.4)' },
  ghost: { color: 'var(--color-text)', trackColor: 'var(--color-border)' },
};

export default function Button({ variant = 'primary', style, children, loading = false, disabled, ...props }) {
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      aria-busy={loading}
      style={{
        padding: '10px 16px',
        borderRadius: 'var(--radius)',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--spacing-2)',
        ...VARIANT_STYLES[variant],
        ...(isDisabled && !loading ? { opacity: 0.6 } : {}),
        ...style,
      }}
      {...props}
    >
      {loading && <InlineSpinner size={14} {...SPINNER_STYLES[variant]} />}
      {children}
    </button>
  );
}
