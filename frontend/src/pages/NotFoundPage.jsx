import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--spacing-5)' }}>
      <h1>404</h1>
      <p>페이지를 찾을 수 없습니다.</p>
      <Link className="tap-link" to="/requests">홈으로 이동</Link>
    </div>
  );
}
