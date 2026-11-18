import { Link } from 'react-router-dom';

const VARIANT_STYLES = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: '1px solid transparent' },
  ghost: { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
};

/**
 * 버튼처럼 보이는 링크. <a> 안에 <button>을 넣으면 상호작용 요소가 중첩되어
 * 키보드·스크린리더에서 동작이 어긋나므로, 이동하는 동작에는 이 컴포넌트를 쓴다.
 */
export default function LinkButton({ variant = 'primary', style, children, ...props }) {
  return (
    <Link
      style={{
        padding: '10px 16px',
        minHeight: 'var(--touch-target)',
        borderRadius: 'var(--radius)',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        ...VARIANT_STYLES[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
