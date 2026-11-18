import { httpClient, API_BASE_URL } from './httpClient';

export function googleLoginUrl() {
  return `${API_BASE_URL}/api/auth/google/login`;
}

export async function fetchMe() {
  const { data } = await httpClient.get('/auth/me');
  return data;
}
