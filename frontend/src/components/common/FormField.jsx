import { useId } from 'react';

const CONTROL_STYLE = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  minHeight: 'var(--touch-target)',
};

/**
 * 라벨, 입력, 오류 메시지를 한 묶음으로 보여준다.
 * `children`을 함수로 주면 접근성 속성이 담긴 props를 받아 원하는 입력 요소에 펼쳐 쓸 수 있다.
 */
export default function FormField({ label, error, required = false, hint, children }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const controlProps = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    // border 단축 속성과 borderColor를 섞으면 리렌더 때 스타일이 어긋나므로 border 전체를 바꾼다.
    style: { ...CONTROL_STYLE, ...(error ? { border: '1px solid var(--color-danger)' } : {}) },
  };

  return (
    <div style={{ marginBottom: 'var(--spacing-4)' }}>
      <label htmlFor={id} style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--spacing-1)' }}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      {children(controlProps)}
      {hint && !error && (
        <p id={hintId} style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
