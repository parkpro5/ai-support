const webpush = require('web-push');
const prisma = require('../../config/prismaClient');
const env = require('../../config/env');
const logger = require('../../utils/logger');

webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

/** 푸시 서버가 알림을 하루 동안 보관하게 한다(기기가 꺼져 있어도 켜지면 받는다). */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** 푸시 서버가 이 시간 안에 답하지 않으면 그 전송은 실패로 본다. */
const PUSH_TIMEOUT_MS = 5000;

/** 실제 전송 (푸시 서버로 보낸다). */
const defaultTransport = (subscription, body) =>
  webpush.sendNotification(subscription, body, { TTL: PUSH_TTL_SECONDS, timeout: PUSH_TIMEOUT_MS });

/**
 * 테스트가 전송기를 가짜로 바꿔 끼우는 자리(실제 푸시 서버에 보내지 않기 위해).
 * 테스트 실행기가 이 모듈을 두 번 불러(테스트 쪽, 앱 쪽) 복사본이 둘이 될 수 있으므로,
 * 모듈 변수가 아니라 전역 심볼에 둬서 어느 복사본이든 같은 값을 보게 한다. 운영에서는 쓰이지 않는다.
 * @type {symbol}
 */
const TRANSPORT_OVERRIDE = Symbol.for('ai-support.pushTransportOverride');

/** @type {(subscription: { endpoint: string, keys: { p256dh: string, auth: string } }, body: string) => Promise<unknown>} */
const currentTransport = (subscription, body) => (globalThis[TRANSPORT_OVERRIDE] ?? defaultTransport)(subscription, body);

/** 테스트 전용: 전송기를 바꾼다. */
function setTransport(fn) {
  globalThis[TRANSPORT_OVERRIDE] = fn;
}

/** 테스트 전용: 원래 전송기로 되돌린다. */
function resetTransport() {
  delete globalThis[TRANSPORT_OVERRIDE];
}

async function upsertSubscription(userId, { endpoint, keys }) {
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
}

async function removeSubscription(userId, endpoint) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** 푸시 서버가 "이 구독은 더 이상 없다"고 답한 경우(404, 410). 기기에서 알림을 끄거나 앱을 지운 것이다. */
const isGone = (err) => err && (err.statusCode === 404 || err.statusCode === 410);

/**
 * 여러 사용자의 모든 기기에 같은 알림을 보낸다.
 * - 한 기기의 전송 실패가 다른 기기로의 전송을 막지 않는다.
 * - 푸시 서버가 만료(404, 410)로 답한 구독은 삭제한다. 그 밖의 실패는 로그만 남기고 구독은 남긴다.
 * @returns {Promise<{ sent: number, removed: number, failed: number }>}
 */
async function sendToUsers(userIds, payload) {
  if (userIds.length === 0) return { sent: 0, removed: 0, failed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  const body = JSON.stringify(payload);
  const counts = { sent: 0, removed: 0, failed: 0 };

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await currentTransport({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
        counts.sent += 1;
      } catch (err) {
        if (isGone(err)) {
          await prisma.pushSubscription.deleteMany({ where: { id: sub.id } }).catch(() => {});
          counts.removed += 1;
        } else {
          logger.error('Push notification send failed:', err && err.message);
          counts.failed += 1;
        }
      }
    })
  );
  return counts;
}

function sendToUser(userId, payload) {
  return sendToUsers([userId], payload);
}

module.exports = {
  upsertSubscription,
  removeSubscription,
  sendToUser,
  sendToUsers,
  setTransport,
  resetTransport,
};
