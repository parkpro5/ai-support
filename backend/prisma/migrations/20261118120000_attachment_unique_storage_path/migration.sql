-- 같은 저장소 객체를 두 번 등록할 수 없게 한다.
CREATE UNIQUE INDEX "Attachment_storagePath_key" ON "Attachment"("storagePath");
