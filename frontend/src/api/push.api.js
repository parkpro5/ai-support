import { httpClient } from './httpClient';

export async function subscribePush(subscription) {
  const { data } = await httpClient.post('/push/subscribe', subscription);
  return data;
}

export async function unsubscribePush(endpoint) {
  const { data } = await httpClient.post('/push/unsubscribe', { endpoint });
  return data;
}
