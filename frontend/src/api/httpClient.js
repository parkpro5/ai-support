import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// API 서버 주소. 값이 없을 때의 기본값은 개발과 운영이 다르다.
// - 개발(vite dev): 따로 뜨는 백엔드 http://localhost:4000
// - 운영 빌드: 빈 문자열 = 같은 도메인의 /api/* (Vercel이 api/index.js 로 보낸다)
// 운영에서 이 값을 비워 두거나 아예 만들지 않아도 localhost 로 새지 않게, 기본값을 빌드 종류로 정한다.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

export const httpClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

httpClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export { API_BASE_URL };
