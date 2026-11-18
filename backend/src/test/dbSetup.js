// 모든 DB 테스트 파일이 시작하기 전에 실행된다(vitest.db.config.mjs 의 setupFiles).
// 테스트가 실제 푸시 서버로 알림을 보내는 일이 없도록 기본 전송기를 "차단"으로 바꿔 둔다.
// 알림을 검증하는 테스트는 자기 전송기(전송 기록을 남기는 가짜)로 다시 바꿔 끼운다.
import pushService from '../modules/push/push.service.js';
import storageService from '../modules/attachments/storage.service.js';

pushService.setTransport(async () => {
  throw new Error('Real push delivery is blocked in tests');
});

// 첨부파일 저장소도 마찬가지로 막아 둔다. 첨부를 검증하는 테스트는 자기 가짜 저장소(메모리)를 끼운다.
const blocked = () => {
  throw new Error('Real storage access is blocked in tests');
};
storageService.setStorage({
  createUploadUrl: blocked,
  getObjectInfo: blocked,
  createDownloadUrl: blocked,
  removeObjects: blocked,
});
