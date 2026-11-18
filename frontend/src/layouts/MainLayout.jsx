import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

export default function MainLayout() {
  return (
    <div>
      <a href="#main-content" className="skip-link">
        본문 바로가기
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="page-container" style={{ outline: 'none' }}>
        <Outlet />
      </main>
    </div>
  );
}
