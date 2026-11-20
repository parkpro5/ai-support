-- 희망 완료일 하루 전 알림을 보낸 시각. 한 번만 보내려고 쓴다.
-- AlterTable
ALTER TABLE "Request" ADD COLUMN "dueReminderSentAt" TIMESTAMP(3);
