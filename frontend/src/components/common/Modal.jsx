import { useEffect, useId, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 아래에서 올라오는 대화상자.
 * 접근성: 대화상자로 알려 주고(role, aria-modal, 제목 연결), 열리면 안쪽으로 초점을 옮기며,
 * Tab 이동이 안에서만 돌고, Esc로 닫고, 닫히면 열기 전에 있던 곳으로 초점을 돌려 준다.
 * onClose가 없으면(처리 중) 배경 클릭·Esc로 닫히지 않는다.
 */
export default function Modal({ open, onClose, title, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const contentRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    // 본문의 첫 입력·버튼으로, 없으면 닫기 버튼으로 초점을 옮긴다.
    (contentRef.current?.querySelector(FOCUSABLE) ?? closeButtonRef.current ?? dialogRef.current)?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) ?? []);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: '16px 16px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 'var(--spacing-4)',
          boxSizing: 'border-box',
        }}
        className="modal-sheet"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: '1.1rem' }}>
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.4rem',
              lineHeight: 1,
              width: 'var(--touch-target)',
              height: 'var(--touch-target)',
              flexShrink: 0,
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}
