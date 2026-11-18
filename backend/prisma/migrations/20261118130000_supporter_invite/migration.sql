-- 관리자가 이메일로 미리 등록한 지원자. 그 이메일로 처음 로그인하면 지원자로 시작한다.
-- CreateTable
CREATE TABLE "SupporterInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupporterInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupporterInvite_email_key" ON "SupporterInvite"("email");
