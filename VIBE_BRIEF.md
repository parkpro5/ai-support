# AI 전환 지원요청 관리 웹앱 바이브코딩 지침서 (VIBE_BRIEF)

> 대상 에이전트: Claude Code / 사용자 수준: 개발 경험 있음 / 결과물 유형: 코드(웹앱)
> 유형 판단 근거: 역할 3종, 다수 사용자 화면·로그인·DB·상태 흐름이 필요하므로 스킬이 아니라 코드가 적합하다.

---

## 파트 0. 에이전트 운영 규칙 (항상 먼저 읽을 것)

- **역할**: 시니어 풀스택 엔지니어. 이 문서의 파트 1(PRD)·파트 2(TASKS)·파트 3(PLAN)을 기준으로 따른다.
- **작업 규칙**
  - 한 번에 **한 태스크만** 구현하고 멈춰서 보고한다.
  - 끝내기 전에 해당 태스크의 완료 조건을 **실제로 실행·검증**한다.
  - 통과하면 파트 2의 체크박스를 갱신한다. 실패하면 원인과 수정 내용을 설명한다.
  - PRD의 Won't와, 태스크에 지정되지 않은 파일·기능을 임의로 추가하지 않는다.
  - 모호하거나 범위를 넘는 결정은 먼저 질문한다. 문서와 충돌하면 임의 판단 대신 보고한다.
- **코드 품질 규칙**
  - 함수는 단일 책임으로 짧게 쓰고, 중복을 만들지 않으며, 의미 있는 이름을 쓴다. 이 프로젝트는 pr03를 따라 **JavaScript**(Express, React)이고 TypeScript로 바꾸지 않는다. JSDoc으로 핵심 함수의 입출력 형태를 명시한다.
  - 에러 처리, 로딩 상태, 빈 상태를 모든 화면과 API에 둔다.
  - 비밀키는 `.env`에 두고 하드코딩하지 않는다. `.env.example`을 제공한다.
  - 입력 검증(스키마), SQL 인젝션·XSS 방지. `dangerouslySetInnerHTML` 금지.
  - 불필요한 의존성을 추가하지 않는다. 추가할 때는 이유를 설명한다.
- **보안 규칙**: 모든 API에서 서버가 역할·소유·상태를 검증한다(프런트 숨김은 보안이 아니다). 연락처는 요청자 본인, 담당 지원자, 관리자가 조회할 수 있고, 접수 가능한(제출됨) 요청서의 연락처는 접수 전 전화 확인을 위해 지원자도 조회할 수 있다.
- **참고 소스**: `D:\dev\pr03`(To-Do 칸반 앱). 이 프로젝트는 그 코드를 **복사해** 시작하되, pr03 폴더·저장소·배포·DB는 **절대 수정하지 않는다**.

---

## 파트 1. PRD

### 1-1. 개요
"AI 전환 지원요청서"를 올리면 근로학생(지원자)이 접수해 처리하고, 작업내역을 요청자(1차)와 관리자(최종)가 차례로 확인하는 내부용 웹앱. pr03 코드를 복사한 별도 프로젝트이며 새 GitHub 저장소, 새 Vercel, 새 Supabase에 배포한다.

### 1-2. 문제와 목표
- **문제**: 요청, 접수, 처리, 확인 과정이 흩어져 있어 누가 어느 단계인지, 무엇을 했는지 추적하기 어렵다.
- **목표**: 요청 한 건의 전 과정을 상태로 추적하고, 확인·반려 이력을 남긴다.
- **성공 지표**: 요청 1건이 상태 흐름을 끝까지 통과하고, 반려·재작업 이력이 모두 조회된다.

### 1-3. 사용자와 시나리오
| 역할 | 인원 | 하는 일 |
|---|---|---|
| 요청자(REQUESTER) | 대학교직원 다수 | 요청서 작성, 작업내역 1차 확인, 만족도 평가 |
| 지원자(SUPPORTER) | 근로학생 10명 | 요청서 접수, 작업내역 입력 |
| 관리자(ADMIN) | 3명 | 최종 확인, 지원자 지정·배정, 지원 유형 관리, 통계 |

- 시나리오 1(정상): 직원이 요청서를 제출한다. 근로학생이 접수해 작업한 뒤 내역을 제출한다. 직원이 1차 확인하고 관리자가 최종 확인하면 완료된다.
- 시나리오 2(반려): 반려 사유를 적으면 같은 지원자에게 재작업이 돌아가고, 재제출 후 다시 확인한다.
- 시나리오 3(배정): 관리자가 급한 요청서를 특정 학생에게 직접 배정한다.

### 1-4. 범위
- **Must**: FR-1~FR-6
- **Should**: FR-7~FR-13
- **Won't**: 외부 시스템 연동(학교 포털·SSO 포함), 급여 금액 정산(근로시간 기록은 한다)

### 1-5. 기능 요구사항
**상태**: SUBMITTED(제출됨), ACCEPTED(접수됨), FIRST_REVIEW(1차 확인 대기), FINAL_REVIEW(최종 확인 대기), REWORK(재작업), COMPLETED(완료)

- **FR-1 로그인·역할 (Must)**
  - Given 관리자 이메일 목록(`ADMIN_EMAILS`)의 계정, When 로그인하면, Then 관리자 권한이 부여된다.
  - Given 일반 계정, When 처음 로그인하면, Then 요청자로 생성된다.
  - Given 요청자 계정, When 관리자 전용 API를 호출하면, Then 403이 반환된다.
- **FR-2 요청서 작성·제출 (Must)** — 항목: 착수일시, 제목, 요청 내용, 소속, 담당자, 연락처, 지원 유형, 희망 완료일, 긴급도
  - Given 필수 항목을 모두 입력, When 제출하면, Then SUBMITTED가 되고 목록에 나타난다.
  - Given 필수 항목이 비어 있으면, When 제출하면, Then 항목별 오류가 표시되고 저장되지 않는다.
  - Given SUBMITTED 상태, When 작성자가 수정·삭제하면, Then 처리된다. 그 외 상태에서는 거부된다. `[가정]`
- **FR-3 목록 조회·접수 (Must)**
  - Given SUBMITTED 요청서, When 지원자가 접수하면, Then 담당자로 기록되고 ACCEPTED가 된다.
  - Given 두 지원자가 동시에 접수, When 한 명이 먼저 성공하면, Then 다른 사람은 409(이미 접수됨)를 받는다.
  - Given ACCEPTED이고 작업내역 제출 전, When 담당 지원자가 접수 취소하면, Then SUBMITTED로 돌아간다.
- **FR-4 작업내역 입력 (Must)**
  - Given ACCEPTED, When 담당 지원자가 작업내역을 제출하면, Then FIRST_REVIEW가 된다.
  - Given 담당이 아닌 지원자, When 제출하려 하면, Then 403이 반환된다.
- **FR-5 1차 확인 (Must)**
  - Given FIRST_REVIEW, When 요청서 작성자가 승인하면, Then FINAL_REVIEW가 된다.
  - Given 같은 상태, When 작성자가 반려하면(사유 필수), Then REWORK가 되고 이력이 남는다. 사유가 없으면 400이다.
  - Given 작성자가 아닌 요청자, When 확인하려 하면, Then 403이 반환된다.
- **FR-6 최종 확인 (Must)**
  - Given FINAL_REVIEW, When 관리자가 승인하면, Then COMPLETED가 된다.
  - Given 같은 상태, When 관리자가 반려하면(사유 필수), Then REWORK가 된다.
- **FR-7 반려·재작업 (Should)**
  - Given REWORK, When 담당 지원자가 수정해 재제출하면, Then FIRST_REVIEW가 된다. `[가정]`
  - Given 반려가 여러 번 있었을 때, When 상세를 열면, Then 반려·재제출 이력이 시간순으로 모두 보인다.
- **FR-8 관리자 기능 (Should)**
  - Given 요청자 계정, When 관리자가 지원자로 지정하면, Then 접수가 가능해진다.
  - Given SUBMITTED 요청서, When 관리자가 지원자를 배정하면, Then ACCEPTED가 되고 해당 지원자가 담당이 된다.
  - 지원 유형 목록(기본: 업무 자동화, 문서 작성, 데이터 정리, 교육·컨설팅, 기타)을 관리자가 추가·수정·비활성화한다. `[가정]`
- **FR-9 웹 푸시 알림 (Should)** — 새 요청서는 지원자에게, 작업내역 제출은 요청자에게, 1차 승인은 관리자에게, 반려는 담당 지원자에게, 완료는 요청자와 지원자에게 보낸다.
  - Given 알림을 허용한 사용자, When 해당 상태 전이가 발생하면, Then 푸시를 받는다. 구독 해제 사용자에게는 가지 않는다.
- **FR-10 첨부파일 (Should)**
  - Given 허용된 형식(pdf, hwp, hwpx, docx, xlsx, pptx, png, jpg)과 10MB 이하 `[가정]`, When 첨부하면, Then 저장되고 요청서 관계자만 내려받을 수 있다.
  - Given 허용되지 않은 형식이나 초과 크기, When 첨부하면, Then 거절된다.
- **FR-11 근로시간 기록 (Should)**
  - Given 작업내역 제출, When 소요 분을 입력하면, Then 지원자별·월별 누적 시간이 조회된다. 급여 계산은 하지 않는다.
- **FR-12 만족도 평가 (Should)**
  - Given COMPLETED 요청서, When 작성자가 1~5점과 한 줄 후기를 입력하면, Then 저장되고 한 번만 입력된다. 미완료 건은 400이다.
- **FR-13 통계 대시보드 (Should)**
  - Given 관리자, When 대시보드를 열면, Then 기간별 처리 건수, 평균 처리 시간, 지원자별 현황, 유형별 건수가 표시된다.
  - Given 비관리자, When 호출하면, Then 403이 반환된다.

### 1-6. 비기능 요구사항
- 보안: 서버에서 역할·소유·상태 검증, 연락처 접근 제한(접수 전 요청서의 연락처는 지원자에게 공개).
- 성능: 목록은 페이지 단위, 수백 건 규모에서 빠르게 동작.
- 접근성: 기본 수준(키보드 조작, 색 대비, 입력 라벨). 라이트 테마만.
- 언어: 한국어. PC 웹 중심 + 모바일 대응(폭 375px).

### 1-7. 화면 목록과 흐름
로그인 / 요청서 목록(역할별 필터·상태 필터) / 요청서 작성·수정 / 요청서 상세(상태 타임라인·이력) / 작업내역 입력 / 확인 처리(승인·반려) / 내 작업(지원자) / 관리자(사용자·지원자 지정, 배정, 지원 유형) / 통계 대시보드 / 알림 설정

### 1-8. 데이터 개념 모델
User, SupportType, Request, WorkLog, RequestEvent(접수·배정·반려 등 모든 전이 이력), Attachment, Rating, PushSubscription. Request 1건에 담당 User 1명, WorkLog와 RequestEvent는 여러 개. **입력 샘플·서식 파일은 없다**(`[가정]`: 위 항목으로 새로 설계).

### 1-9. 제약·가정·미해결
**제약**: 기한 없음, 무료 플랜 범위(Vercel, Supabase), 외부 연동 없음.

**유형 판단 근거**: 코드(웹앱). 판단형 업무가 아니라 다수 사용자의 정형 상태 흐름이다.

**[가정] 모음**
1. 지원 유형 기본 목록은 업무 자동화, 문서 작성, 데이터 정리, 교육·컨설팅, 기타이고 관리자가 수정한다.
2. 서식 파일이 없어서 위 항목으로 새로 설계한다.
3. 근로시간은 작업내역마다 소요 분을 입력한다.
4. 만족도는 1~5점과 한 줄 후기이고 완료 후 작성자가 1회 입력한다.
5. 재작업 재제출은 항상 1차 확인부터 다시 한다.
6. 요청자는 SUBMITTED 상태에서만 요청서를 수정·삭제할 수 있다.
7. 첨부파일은 10MB 이하, pdf·hwp·hwpx·docx·xlsx·pptx·png·jpg만 허용한다.
8. 사용자는 역할 하나만 가진다. 관리자는 요청서 작성도 가능하다.
9. 새 프로젝트 폴더는 `D:\dev\ai-support`로 한다(바꿔도 된다).
10. 성공 기준 3개(아래)는 사용자가 1번을 선택하고 2, 3번을 추가했다.

**성공 기준**
1. 요청자·지원자·관리자 계정으로 요청서 한 건이 제출부터 완료까지 상태 흐름을 끝까지 통과한다.
2. 역할별 권한이 분리된다(다른 역할의 API는 403, 타인 요청서는 수정 불가).
3. 반려·재작업을 여러 번 해도 사유와 이력이 모두 조회된다.

**미해결**: iOS 웹 푸시는 홈 화면 설치 후에만 동작하므로 사용 환경 확인이 필요하다(3-9에 대안 있음).

---

## 파트 2. TASKS

**공통 전제**: 한 태스크는 에이전트가 한 번에 끝낼 수 있는 S~M 크기다. 백엔드 핵심 로직 테스트는 `vitest`를 쓴다.

### M0 세팅 (결과: 로그인되는 빈 껍데기가 로컬에서 뜸)

- [x] **T-01 pr03 복사·정리** (공통, S)
  - 설명: pr03를 새 폴더로 복사하고 git을 새로 초기화한다. To-Do, 게시판, 댓글, Google Tasks 연동 코드를 제거하고 auth, push, cron, PWA 뼈대는 남긴다.
  - 의존: 없음
  - 산출물: 새 프로젝트 폴더(`backend/src/modules`에 auth와 push만 남김), 정리된 `README.md`
  - 완료 조건: `npm install && npm run dev` 후 로그인 페이지가 열리고, 제거한 경로(`/api/todos`)는 404를 반환한다.
- [x] **T-02 DB 스키마** (FR 전체, M)
  - 설명: Prisma 모델을 새로 작성한다(User, SupportType, Request, WorkLog, RequestEvent, Attachment, Rating, PushSubscription). 상태·역할·긴급도는 enum으로 둔다.
  - 의존: T-01
  - 산출물: `backend/prisma/schema.prisma`, 마이그레이션, 시드(지원 유형 기본 5건)
  - 완료 조건: `npx prisma migrate dev`가 성공하고 `npx prisma db seed` 후 SupportType 5건이 조회된다.
- [ ] **T-03 새 환경 연결** (공통, S)
  - 설명: 새 Supabase 프로젝트(풀드·다이렉트 연결), 새 Google OAuth 클라이언트, `ADMIN_EMAILS`, `.env.example`을 정리한다.
  - 의존: T-02
  - 산출물: `.env.example`, `README.md`의 환경 설정 절
  - 완료 조건: Google 로그인 후 `GET /api/auth/me`가 사용자 정보를 반환하고, `ADMIN_EMAILS`의 이메일은 role이 ADMIN이다.

### M1 핵심 Must (결과: 요청서 한 건이 끝까지 흐름)

- [x] **T-04 역할·권한 미들웨어** (FR-1, S)
  - 설명: 역할(REQUESTER, SUPPORTER, ADMIN) 미들웨어와 역할별 라우트 가드를 만든다.
  - 의존: T-03
  - 산출물: `backend/src/middleware/roles.js`, 테스트
  - 완료 조건: `npm test`에서 "요청자가 관리자 전용 경로를 호출하면 403" 케이스가 통과한다.
- [x] **T-05 상태 전이 서비스** (FR-3~6 기반, M)
  - 설명: 순수 함수로 상태 전이 규칙을 만들고 허용되지 않는 전이를 거부한다(접수, 접수 취소, 작업내역 제출, 1차 승인·반려, 최종 승인·반려, 재제출).
  - 의존: T-02
  - 산출물: `backend/src/modules/requests/stateMachine.js`와 단위 테스트
  - 완료 조건: `npm test`에서 모든 허용 전이는 성공하고 잘못된 전이(예: 제출됨에서 완료)는 오류를 낸다.
- [x] **T-06 요청서 작성·목록** (FR-2, M)
  - 설명: 요청서 CRUD API와 작성 화면, 역할별 목록 화면(상태 필터)을 만든다. SUBMITTED에서만 수정·삭제할 수 있다.
  - 의존: T-04, T-05
  - 산출물: `modules/requests/*`, `RequestListPage`, `RequestEditorPage`
  - 완료 조건: 필수 항목을 빼면 항목별 오류가 보이고, 제출하면 목록에 "제출됨"으로 나타난다.
- [x] **T-07 접수·접수 취소** (FR-3, M)
  - 설명: 선착순 단독 접수를 조건부 갱신으로 구현한다. 접수 취소와 지원자용 목록 화면도 만든다.
  - 의존: T-06
  - 산출물: 접수 API와 지원자 화면
  - 완료 조건: 동시 접수 테스트에서 정확히 1건만 성공하고 나머지는 409를 반환한다. 접수 취소 후 SUBMITTED로 돌아간다.
- [x] **T-08 작업내역 입력** (FR-4, M)
  - 설명: 담당 지원자만 작업내역을 입력·제출하며, 제출하면 FIRST_REVIEW가 된다.
  - 의존: T-07
  - 산출물: WorkLog API와 `WorkLogForm`
  - 완료 조건: 담당이 아닌 지원자는 403이고, 담당자가 제출하면 상태가 FIRST_REVIEW가 된다.
- [x] **T-09 1차 확인** (FR-5, M)
  - 설명: 요청서 작성자만 승인하거나 반려(사유 필수)하고, RequestEvent를 기록한다.
  - 의존: T-08
  - 산출물: 확인 API와 확인 화면
  - 완료 조건: 승인하면 FINAL_REVIEW, 사유 없는 반려는 400, 반려하면 REWORK와 이력이 생긴다.
- [x] **T-10 최종 확인** (FR-6, M)
  - 설명: 관리자만 최종 승인하거나 반려한다.
  - 의존: T-09
  - 산출물: 최종 확인 API와 관리자 확인 화면
  - 완료 조건: 승인하면 COMPLETED가 되고, 요청자 계정으로 호출하면 403이다.

**M1 완료 기준**: 계정 3개(요청자, 지원자, 관리자)로 한 건이 제출부터 완료까지 통과한다.

### M2 Should (결과: 하나씩 붙여도 항상 동작)

- [x] **T-11 재작업·이력 타임라인** (FR-7, M)
  - 설명: REWORK에서 재제출하면 FIRST_REVIEW가 된다. 상세 화면에 이력을 시간순으로 보여준다.
  - 의존: T-10
  - 산출물: 상세 페이지 타임라인
  - 완료 조건: 반려를 두 번 반복해도 사유와 이력이 모두 조회된다.
- [x] **T-12 관리자 기능** (FR-8, M)
  - 설명: 사용자를 지원자로 지정하고, SUBMITTED 요청서를 지원자에게 배정하며, 지원 유형을 관리한다.
  - 의존: T-10
  - 산출물: `AdminPage`, `modules/admin/*`
  - 완료 조건: 지정 전에는 접수가 403이고 지정 후에는 가능하다. 배정하면 상태가 ACCEPTED가 된다.
- [x] **T-13 웹 푸시 알림** (FR-9, M)
  - 설명: 상태 전이마다 해당 대상에게 pr03의 push 모듈로 푸시를 보낸다.
  - 의존: T-11
  - 산출물: 알림 발송 서비스, 알림 설정 화면
  - 완료 조건: 요청서를 제출하면 지원자 구독 기기에 푸시가 도착하고, 구독 해제한 사용자에게는 오지 않는다.
- [x] **T-14 첨부파일** (FR-10, M)
  - 설명: 브라우저가 서명 URL로 Supabase Storage에 직접 업로드하고, 서버는 메타데이터를 저장하며 권한 확인 후 다운로드 URL을 발급한다.
  - 의존: T-10
  - 산출물: 업로드 API, `FileAttach` 컴포넌트
  - 완료 조건: 허용 형식은 업로드되고, 초과 크기와 불허 형식은 거절되며, 권한 없는 사용자는 내려받을 수 없다.
- [x] **T-15 근로시간 기록** (FR-11, S)
  - 설명: 작업내역에 소요 분을 저장하고 지원자별·월별로 누적한다.
  - 의존: T-08
  - 산출물: 소요 분 필드와 누적 조회
  - 완료 조건: 두 건의 작업 후 월 누적 시간이 합계와 일치한다.
- [x] **T-16 만족도 평가** (FR-12, S)
  - 설명: 완료된 요청서에 작성자가 1~5점과 후기를 한 번만 입력한다.
  - 의존: T-10
  - 산출물: Rating API와 화면
  - 완료 조건: 두 번째 입력은 409이고 미완료 건은 400이다.
- [x] **T-17 통계 대시보드** (FR-13, M)
  - 설명: 처리 건수, 평균 처리 시간, 지원자별 현황, 유형별 건수를 관리자에게 보여준다.
  - 의존: T-15, T-16
  - 산출물: `DashboardPage`, 통계 API
  - 완료 조건: 시드 데이터 기준 수치가 직접 계산한 값과 일치하고, 비관리자는 403이다.

### M3 마무리

- [x] **T-18 모바일·접근성 점검** (비기능, S)
  - 설명: 주요 화면의 모바일 레이아웃, 키보드 조작, 색 대비, 라벨을 점검한다.
  - 의존: T-17
  - 산출물: 수정된 스타일
  - 완료 조건: 폭 375px에서 가로 스크롤 없이 접수와 작업내역 입력이 가능하다.
- [ ] **T-19 배포·운영 문서** (공통, S)
  - 설명: 새 Vercel 프로젝트에 연결하고 환경변수를 설정한다. 운영 절차를 README에 정리한다.
  - 의존: T-18
  - 산출물: `vercel.json`, 배포 가이드
  - 완료 조건: 프로덕션 주소에서 Google 로그인과 요청서 제출이 동작한다.
  - 진행 상태: 산출물(배포 가이드, 환경변수 표, `GET /api/health`, cron-job.org 안내)은 끝났다. **완료 조건은 사용자가 운영 환경에서 README "배포" 5단계 체크리스트로 확인한 뒤에 체크한다.**

### 추적표
| FR | 태스크 | 검증 |
|---|---|---|
| FR-1 | T-03, T-04 | 권한 테스트, `/auth/me` |
| FR-2 | T-02, T-06 | 필수값 오류와 목록 표시 |
| FR-3 | T-05, T-07 | 동시 접수 1건만 성공 |
| FR-4 | T-08 | 담당자만 제출 |
| FR-5 | T-09 | 승인과 반려 전이 |
| FR-6 | T-10 | 관리자만 완료 |
| FR-7 | T-09, T-10, T-11 | 이력 보존 |
| FR-8 | T-12 | 지정과 배정 |
| FR-9 | T-13 | 푸시 도착 |
| FR-10 | T-14 | 업로드 제한과 권한 |
| FR-11 | T-15 | 누적 시간 |
| FR-12 | T-16 | 1회 입력 |
| FR-13 | T-17 | 수치 일치 |
| 비기능 | T-18, T-19 | 모바일과 프로덕션 점검 |

Won't(외부 시스템 연동, 급여 정산)는 태스크로 만들지 않는다.

---

## 파트 3. PLAN

### 3-1. 아키텍처 개요
```
브라우저(React SPA/PWA) ──/api/*──▶ Vercel 서버리스 함수(Express) ──▶ Supabase PostgreSQL (Prisma)
        │                                      │                         └─▶ Supabase Storage
        └─ 서비스워커 ◀──── 웹 푸시(web-push) ◀──┘   (파일은 브라우저가 Storage에 직접 업로드)
```
프런트 정적 빌드는 Vercel이 서빙하고 `/api/*`는 Express 한 함수가 처리한다(pr03와 같은 구조). 상태 전이 규칙은 `stateMachine.js` 한 곳에 두고 모든 API가 이것만 통해 상태를 바꾼다.

### 3-2. 기술 스택과 선정 이유
| 영역 | 선택 | 이유 |
|---|---|---|
| 백엔드 | Node 20, Express, Prisma | pr03 코드 재사용 |
| 프런트 | React, Vite, zustand, PWA | 로그인·푸시 코드 재사용 |
| DB | Supabase PostgreSQL | 풀드와 다이렉트 연결 분리 설정 그대로 사용 |
| 파일 | Supabase Storage | 추가 서비스 없음 |
| 테스트 | vitest | 상태 전이와 권한 테스트 |
| 언어 | JavaScript 유지 | 복사 후 변경 범위를 줄이기 위해 |

### 3-3. 폴더 구조
```
ai-support/
├── api/index.js, vercel.json, .env.example
├── backend/prisma/{schema.prisma, seed.js}
├── backend/src/
│   ├── middleware/{auth.js, roles.js}
│   └── modules/{auth, push, requests, admin, stats, attachments}/ (routes, controller, service, schema)
│       └── requests/stateMachine.js (+ stateMachine.test.js)
└── frontend/src/{pages, components, api, store}
```

### 3-4. 데이터 모델 상세
- enum `RequestStatus`: SUBMITTED, ACCEPTED, FIRST_REVIEW, FINAL_REVIEW, REWORK, COMPLETED
- enum `Role`: REQUESTER, SUPPORTER, ADMIN
- enum `Urgency`: LOW, NORMAL, HIGH

| 모델 | 주요 필드 |
|---|---|
| User | id, email(unique), name, role, createdAt |
| SupportType | id, name, active, sortOrder |
| Request | id, requesterId, assigneeId?, supportTypeId, title, content, department, contactName, contactPhone, interviewAt, desiredDate, urgency, status, createdAt, completedAt? |
| WorkLog | id, requestId, authorId, content, minutes, round(제출 회차), submittedAt |
| RequestEvent | id, requestId, actorId, type(SUBMIT, ACCEPT, CANCEL_ACCEPT, ASSIGN, WORK_SUBMIT, FIRST_APPROVE, FIRST_REJECT, FINAL_APPROVE, FINAL_REJECT, RESUBMIT), reason?, createdAt |
| Attachment | id, requestId, workLogId?, uploaderId, storagePath, fileName, size, mime |
| Rating | requestId(unique), score(1~5), comment |
| PushSubscription | pr03 구조 유지, userId 연결 |

접수 경쟁은 `updateMany({where:{id, status:'SUBMITTED'}, data:{...}})`의 반환 count가 1일 때만 성공으로 처리해 해결한다. 상태 변경과 RequestEvent 기록은 같은 트랜잭션에서 한다.

### 3-5. API 명세
| 영역 | Method Path | 권한 |
|---|---|---|
| 인증 | GET `/api/auth/google/login`, `/callback`, `/me` | pr03 유지 |
| 요청서 | GET `/api/requests`, POST `/api/requests`, GET·PATCH·DELETE `/api/requests/:id` | 로그인, 소유·상태 제한 |
| 접수 | POST `/api/requests/:id/accept`, `/cancel-accept` | 지원자 |
| 배정 | POST `/api/requests/:id/assign` | 관리자 |
| 작업내역 | POST `/api/requests/:id/work-logs`(최초·재제출) | 담당 지원자 |
| 1차 확인 | POST `/api/requests/:id/first-review` {decision, reason} | 작성 요청자 |
| 최종 확인 | POST `/api/requests/:id/final-review` {decision, reason} | 관리자 |
| 만족도 | POST `/api/requests/:id/rating` | 작성 요청자, 완료 후 1회 |
| 첨부 | POST `/api/requests/:id/attachments/upload-url`, POST `/api/requests/:id/attachments`, GET `/api/attachments/:id/download-url` | 요청서 관계자 |
| 관리자 | GET `/api/admin/users`, PATCH `/api/admin/users/:id/role`, GET·POST·PATCH `/api/admin/support-types` | 관리자 |
| 통계 | GET `/api/stats/summary`, `/supporters`, `/hours` | 관리자 |
| 내 근로시간 | GET `/api/stats/my-hours` | 지원자 본인 |
| 푸시 | pr03의 `/api/push/*` 유지 | 로그인 |

### 3-6. 실행 순서
M0: T-01, T-02, T-03 → M1: T-04, T-05, T-06, T-07, T-08, T-09, T-10 → M2: T-11, T-12, T-14, T-15, T-16, T-13(알림은 전이가 안정된 뒤), T-17 → M3: T-18, T-19. 태스크 하나가 끝날 때마다 멈춰 보고한다.

### 3-7. 태스크별 구현 프롬프트

- **T-01**: "`D:\dev\pr03`를 `D:\dev\ai-support`로 복사하라(`node_modules`, `dist`, `dev-dist`, `.git`은 제외). `D:\dev\pr03`는 절대 수정하지 마라. 새 폴더에서 `git init` 하라. `backend/src/modules`에서 auth와 push만 남기고 todos, posts, comments, google 모듈과 관련 프런트 페이지·라우트·스토어를 제거하라. Google Tasks 관련 OAuth 스코프도 제거하라. 불필요한 의존성은 제거하되 이유를 보고하라. README는 새 프로젝트 설명으로 다시 써라. 완료 조건: `npm install && npm run dev` 후 로그인 페이지가 열리고 `/api/todos`가 404를 반환하는 것을 확인해 보고하라."
- **T-02**: "`backend/prisma/schema.prisma`를 파트 3-4에 따라 새로 작성하라(User, SupportType, Request, WorkLog, RequestEvent, Attachment, Rating, PushSubscription, enum 3종). 인덱스는 Request(status), Request(assigneeId), Request(requesterId), RequestEvent(requestId, createdAt)에 둔다. `prisma/seed.js`에 지원 유형 5건을 넣어라. 완료 조건: `npx prisma migrate dev` 성공, `npx prisma db seed` 후 SupportType 5건 조회."
- **T-03**: "`.env.example`을 `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ADMIN_EMAILS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`로 정리하라. 로그인 시 User를 upsert하고 `ADMIN_EMAILS`에 있으면 role=ADMIN, 아니면 최초 생성 시 REQUESTER로 설정하라(기존 사용자의 role은 로그인으로 덮어쓰지 않되 ADMIN_EMAILS 대상은 항상 ADMIN). 비밀값이 필요한 설정(Supabase·Google 콘솔)은 내가 직접 하므로, 해야 할 설정 절차를 README에 순서대로 적어라. 완료 조건: 로그인 후 `/api/auth/me`가 role과 함께 응답한다."
- **T-04**: "`backend/src/middleware/roles.js`에 `requireRole(...roles)`를 만들고 인증 미들웨어 뒤에서 쓰게 하라. 인증 실패는 401, 권한 부족은 403. vitest를 설정하고(필요 시 `supertest` 추가, 이유 보고) 역할별 접근 테스트를 작성하라. 완료 조건: `npm test`에서 '요청자가 관리자 전용 경로 호출 시 403'이 통과한다."
- **T-05**: "`backend/src/modules/requests/stateMachine.js`에 순수 함수 `transition(request, action, actor)`를 만들어라. 상태와 행위자(역할·소유·담당 여부) 조합이 허용될 때만 `{status, eventType}`을 반환하고, 아니면 코드가 있는 오류를 던져라. 허용: ACCEPT(SUBMITTED→ACCEPTED, 지원자), CANCEL_ACCEPT(ACCEPTED→SUBMITTED, 담당 지원자), WORK_SUBMIT(ACCEPTED→FIRST_REVIEW, 담당 지원자), FIRST_APPROVE(FIRST_REVIEW→FINAL_REVIEW, 작성자), FIRST_REJECT(→REWORK, 작성자, 사유 필수), FINAL_APPROVE(FINAL_REVIEW→COMPLETED, 관리자), FINAL_REJECT(→REWORK, 관리자, 사유 필수), RESUBMIT(REWORK→FIRST_REVIEW, 담당 지원자), ASSIGN(SUBMITTED→ACCEPTED, 관리자). DB 접근 금지. vitest로 허용 전이 전부와 대표 금지 전이를 테스트하라."
- **T-06**: "`modules/requests`에 요청서 CRUD를 만들어라. 입력은 스키마로 검증한다. POST는 상태 SUBMITTED로 생성하고 RequestEvent(SUBMIT)를 기록한다. PATCH·DELETE는 작성자이면서 SUBMITTED일 때만 허용한다. GET 목록은 역할별로 다르게 동작하며(요청자는 내 요청서, 지원자는 접수 가능 목록과 내 담당, 관리자는 전체), status 필터와 페이지네이션을 지원한다. 연락처는 3-8의 접근 규칙으로 가린다. 프런트는 목록 페이지(상태 배지, 필터)와 작성·수정 폼(항목별 오류 표시)을 만들어라. 완료 조건: 필수 항목을 빼면 항목별 오류가 보이고, 제출하면 목록에 '제출됨'으로 나타난다."
- **T-07**: "POST `/api/requests/:id/accept`를 구현하라. 지원자만 호출할 수 있고, `updateMany({where:{id, status:'SUBMITTED'}, data:{status:'ACCEPTED', assigneeId}})`의 count가 1일 때만 성공으로 처리하라. 0이면 409를 반환한다. 같은 트랜잭션에서 RequestEvent(ACCEPT)를 기록하라. `/cancel-accept`는 담당 지원자가 ACCEPTED이면서 작업내역 제출 전일 때만 SUBMITTED로 되돌린다. 지원자용 화면(접수 가능한 목록, 내 담당)을 만들어라. 완료 조건: 동시 접수 테스트(Promise.all로 2건)에서 정확히 1건만 성공하고 다른 하나는 409다."
- **T-08**: "POST `/api/requests/:id/work-logs`를 구현하라(담당 지원자, 상태 ACCEPTED). content는 필수이고 minutes는 0 이상의 정수다. WorkLog(round=1)를 만들고 상태를 FIRST_REVIEW로 바꾸며 RequestEvent(WORK_SUBMIT)를 기록하라(트랜잭션). 프런트에 작업내역 입력 폼을 만들어라. 완료 조건: 담당이 아닌 지원자는 403, 담당자가 제출하면 FIRST_REVIEW가 된다."
- **T-09**: "POST `/api/requests/:id/first-review` {decision:'APPROVE'|'REJECT', reason}를 구현하라. 요청서 작성자만 가능하다. REJECT는 reason이 필수(없으면 400)이며 REWORK로 가고, APPROVE는 FINAL_REVIEW로 간다. RequestEvent를 기록하라. 프런트에 확인 화면(작업내역 표시, 승인·반려 버튼, 반려 사유 입력)을 만들어라. 완료 조건: 승인 시 FINAL_REVIEW, 사유 없는 반려는 400, 반려 시 REWORK와 이력이 생긴다."
- **T-10**: "POST `/api/requests/:id/final-review` {decision, reason}를 T-09와 같은 방식으로 구현하되 관리자만 가능하게 하라. APPROVE는 COMPLETED와 completedAt을 기록한다. 프런트에 관리자 확인 대기 목록과 확인 화면을 만들어라. 완료 조건: 승인 시 COMPLETED, 요청자 계정 호출은 403. 그 뒤 계정 3개로 제출부터 완료까지 한 건을 통과시키는 통합 테스트를 작성해 M1 완료를 보고하라."
- **T-11**: "REWORK 상태에서 담당 지원자가 POST `/api/requests/:id/work-logs`를 다시 호출하면 round를 증가시켜 WorkLog를 추가하고 FIRST_REVIEW로 바꾸며 RequestEvent(RESUBMIT)를 기록하라. 요청서 상세 화면에 RequestEvent 기반 타임라인(누가, 언제, 무엇을, 사유)과 회차별 작업내역을 표시하라. 완료 조건: 반려를 두 번 반복한 뒤에도 사유와 모든 회차가 상세에서 보인다."
- **T-12**: "`modules/admin`에 사용자 목록, 역할 변경(REQUESTER↔SUPPORTER; ADMIN 변경은 불가), 요청서 배정(POST `/api/requests/:id/assign`, SUBMITTED만, ASSIGN 이벤트), 지원 유형 CRUD(비활성화는 삭제 대신 active=false)를 만들고 `AdminPage`를 만들어라. 모두 관리자 전용이다. 완료 조건: 지정 전 접수는 403, 지정 후 가능, 배정하면 ACCEPTED."
- **T-13**: "pr03의 `push` 모듈을 재사용해 상태 전이 후 알림을 보내는 `notify(eventType, request)`를 만들어라. 수신 대상은 FR-9 규칙을 따른다. 알림 실패는 본 처리에 영향을 주지 않도록 try/catch로 격리하고 로그만 남긴다. 만료된 구독(410)은 삭제한다. 알림 설정(구독·해제) 화면을 만들고, iOS는 홈 화면 설치 안내 문구를 표시하라. 완료 조건: 요청서를 제출하면 구독한 지원자 기기에 푸시가 도착하고 해제한 사용자에게는 가지 않는다."
- **T-14**: "Vercel 본문 제한(4.5MB) 때문에 파일은 서버를 거치지 않는다. POST `/attachments/upload-url`에서 형식(pdf, hwp, hwpx, docx, xlsx, pptx, png, jpg)과 크기(10MB)를 검증하고 Supabase Storage 서명 업로드 URL을 발급하라. 업로드 후 POST `/attachments`로 메타데이터를 등록하며, 서버는 Storage에서 실제 객체의 존재와 크기를 다시 확인한다. 다운로드는 요청서 관계자(작성자, 담당 지원자, 관리자)에게만 짧은 수명의 서명 URL로 준다. 버킷은 비공개다. 프런트에 `FileAttach` 컴포넌트를 요청서·작업내역 폼에 붙여라. 완료 조건: 불허 형식과 초과 크기는 거절, 권한 없는 사용자는 403."
- **T-15**: "WorkLog의 minutes를 지원자별, 월별로 합산하는 GET `/api/stats/hours`와 지원자 본인용 '내 근로시간' 화면 표시를 만들어라. 금액 계산은 하지 마라(Won't). 완료 조건: 시드한 두 건의 합계가 월 누적과 일치한다."
- **T-16**: "POST `/api/requests/:id/rating` {score 1~5, comment}를 구현하라. 작성자만, COMPLETED만, 1회만(재입력 409, 미완료 400). 완료 상세 화면에 평가 입력과 표시를 추가하라. 완료 조건: 위 세 경우가 테스트로 확인된다."
- **T-17**: "관리자 전용 통계 API(summary: 기간별 완료 건수·평균 처리 시간(제출→완료), supporters: 지원자별 처리 건수·시간·평균 만족도, 유형별 건수)와 `DashboardPage`를 만들어라. 차트 라이브러리는 추가하지 말고 표와 간단한 막대(CSS)로 표시하라. 완료 조건: 시드 데이터 수치가 직접 계산한 값과 일치하고 비관리자는 403."
- **T-18**: "주요 화면(목록, 작성, 접수, 작업내역, 확인)을 폭 375px에서 점검해 가로 스크롤을 없애고, 입력 라벨·포커스 표시·색 대비·키보드 조작을 기본 수준으로 맞춰라. 완료 조건: 375px에서 접수와 작업내역 입력을 끝까지 수행할 수 있다."
- **T-19**: "`vercel.json`과 `api/index.js`를 새 프로젝트에 맞게 확인하고, 환경변수 목록과 배포·마이그레이션(`prisma migrate deploy`) 절차를 README에 정리하라. Supabase 무료 플랜 일시중지를 막기 위한 헬스체크 엔드포인트와 외부 스케줄러(cron-job.org) 설정 방법을 문서화하라. 배포는 내가 직접 연결하므로 단계별 안내를 작성하라. 완료 조건: 프로덕션에서 Google 로그인과 요청서 제출이 동작한다(내가 확인)."

### 3-8. 테스트·보안 전략
- vitest로 상태 전이 단위 테스트, 권한 테스트(역할별 403), 동시 접수 테스트, M1 통합 테스트(계정 3개로 완료까지)를 작성한다.
- 모든 API는 서버에서 역할·소유·상태를 검증한다. 입력은 스키마로 검증하고 Prisma 쿼리만 쓴다. 출력은 React 기본 이스케이프에 맡긴다.
- 연락처는 작성자, 담당 지원자, 관리자가 조회하고, 제출됨(접수 전) 요청서의 연락처는 지원자도 조회한다. 첨부는 비공개 버킷과 짧은 수명의 서명 URL만 쓴다.
- 비밀키는 `.env`에 두고 `.env.example`만 커밋한다.

### 3-9. 리스크와 대안
| 리스크 | 대안 |
|---|---|
| Vercel 서버리스 본문 4.5MB 제한 | 파일은 Supabase 서명 URL로 브라우저가 직접 업로드 |
| Supabase 무료 플랜은 7일 미사용 시 일시중지 | 헬스체크 엔드포인트와 외부 스케줄러로 주기 호출 |
| iOS 웹 푸시는 홈 화면 설치 후에만 동작 | 안내 문구와 목록 상단의 "내 처리 대기" 배지로 보완 |
| 복사한 pr03의 잔여 코드가 섞임 | T-01 완료 조건과 grep으로 제거 목록 검증 |
| 요청자가 관리자·지원자를 겸함 | 역할은 하나만 두고 관리자는 요청서 작성 가능(`[가정]` 8) |

### 3-10. 배포·운영
새 GitHub 저장소를 만들고 새 Vercel 프로젝트에 연결한다. main에 push하면 자동 배포되고 PR은 Preview로 배포된다. 환경변수는 `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `GOOGLE_*`, `ADMIN_EMAILS`, `VAPID_*`, `SUPABASE_*`, `FRONTEND_URL`이다. 마이그레이션은 로컬에서 `prisma migrate deploy`로 적용한다.

---

## 파트 4. 첫 지시 (사용자가 에이전트에 붙여 넣을 문장)

> 이 파일(VIBE_BRIEF.md) 전체를 읽고 이해한 내용을 5줄로 요약하라. 샘플·서식 파일은 파트 1-8에 "없음"으로 명시되어 있으니 확인 절차는 건너뛰어라. 그 다음 `D:\dev\pr03`를 수정하지 않는 조건으로 T-01부터 시작하고, 완료 조건을 검증한 뒤 보고하고 멈춰라.
