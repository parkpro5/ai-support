import { useSearchParams } from 'react-router-dom';
import { googleLoginUrl } from '../api/auth.api';

export default function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get('error');

  return (
    <div
      style={{
        minHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--spacing-4)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.5rem' }}>AI 전환 지원요청</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Google 계정으로 로그인하세요.</p>

      {error && (
        <p style={{ color: 'var(--color-danger)' }}>Google 로그인이 취소되었거나 실패했습니다.</p>
      )}

      <a
        href={googleLoginUrl()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          padding: '12px 24px',
          borderRadius: 'var(--radius)',
          background: '#fff',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          textDecoration: 'none',
          fontWeight: 600,
          minHeight: 'var(--touch-target)',
        }}
      >
        Google로 로그인
      </a>
    </div>
  );
}
