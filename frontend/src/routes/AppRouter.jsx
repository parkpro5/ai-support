import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import ProtectedRoute from './ProtectedRoute';
import AdminRoute from './AdminRoute';
import AdminPage from '../pages/AdminPage';
import DashboardPage from '../pages/DashboardPage';
import LoginPage from '../pages/LoginPage';
import OAuthCallbackPage from '../pages/OAuthCallbackPage';
import HoursPage from '../pages/HoursPage';
import RequestListPage from '../pages/RequestListPage';
import RequestDetailPage from '../pages/RequestDetailPage';
import RequestEditorPage from '../pages/RequestEditorPage';
import RequestWorkPage from '../pages/RequestWorkPage';
import RequestReviewPage from '../pages/RequestReviewPage';
import SettingsPage from '../pages/SettingsPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/requests" replace />} />
          <Route path="/requests" element={<RequestListPage />} />
          <Route path="/requests/new" element={<RequestEditorPage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/requests/:id/edit" element={<RequestEditorPage />} />
          <Route path="/requests/:id/work" element={<RequestWorkPage />} />
          <Route path="/requests/:id/review" element={<RequestReviewPage stage="first" />} />
          <Route path="/requests/:id/final-review" element={<RequestReviewPage stage="final" />} />
          <Route path="/hours" element={<HoursPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
