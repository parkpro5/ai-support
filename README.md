# AI 전환 지원요청 관리 웹앱

대학교직원(요청자)이 "AI 전환 지원요청서"를 올리면 근로학생(지원자)이 접수해 처리하고, 작업내역을 요청자(1차)와 관리자(최종)가 차례로 확인하는 웹앱입니다. 자세한 요구사항과 작업 순서는 [VIBE_BRIEF.md](VIBE_BRIEF.md)를 따릅니다.

> 현재 단계: 기능 **T-01~T-18 완료**, 운영 배포 안내(T-19)는 아래 [배포](#배포-vercel--supabase) 절에 있습니다. 실제 Google 로그인·Supabase 연결·푸시 수신은 배포 후 직접 확인해야 합니다.

## 기술 스택

- 백엔드: Node.js 20, Express, Prisma, PostgreSQL(Supabase), `web-push`
- 프런트엔드: React + Vite, zustand, PWA(`vite-plugin-pwa`)
- 인증: Google OAuth 2.0 로그인 + 앱 자체 JWT(7일)
- 배포: Vercel (`api/index.js`가 Express 앱을 서버리스 함수로 감쌈, 프런트는 정적 빌드)

## 폴더 구조

```
├── api/index.js        # Vercel 서버리스 함수 진입점
├── vercel.json         # 빌드/라우팅 설정
├── backend/            # Express REST API, Prisma schema
└── frontend/           # React(Vite) SPA
```

백엔드 모듈은 `backend/src/modules/{auth,admin,requests,attachments,notifications,push,stats,supportTypes,health,cron}` 아래에 도메인별로 있습니다.

## 환경 설정 (처음 한 번)

비밀값이 필요한 단계는 직접 해야 합니다. 값을 만든 뒤 `.env.example`을 `.env`로 복사해 채웁니다. (`.env`는 커밋하지 않습니다.)

### 1. Supabase 프로젝트 (새로 만들기)

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다. DB 비밀번호는 안전한 곳에 보관합니다.
2. 대시보드 → **Project Settings → Database → Connection string**에서 두 주소를 복사합니다.
   - **Transaction pooler**(포트 6543) → `DATABASE_URL`. 끝에 `?pgbouncer=true&connection_limit=1`을 붙입니다.
   - **Direct connection**(포트 5432) → `DIRECT_URL`. 마이그레이션 전용입니다.
3. (첨부파일에서 사용) **Project Settings → API**의 `Project URL` → `SUPABASE_URL`, `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY`. 이 키는 서버에서만 쓰고 프런트에 노출하지 않습니다.
4. 무료 플랜은 7일 동안 접속이 없으면 프로젝트가 일시중지됩니다. 막는 방법(헬스체크 + cron-job.org)은 [배포 7단계](#7단계-supabase-일시중지-막기-cron-joborg)에 있습니다.

### 2. Google OAuth 클라이언트 (새로 만들기)

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 선택 또는 생성 → **API 및 서비스 → OAuth 동의 화면**을 설정합니다. 사용자 유형은 학교 Google Workspace 계정만 쓰면 "내부", 그 외 계정도 쓰면 "외부"입니다.
2. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**, 애플리케이션 유형은 **웹 애플리케이션**입니다.
3. **승인된 리디렉션 URI**에 아래 두 개를 등록합니다. `.env`의 `GOOGLE_REDIRECT_URI`와 글자까지 같아야 합니다.
   - `http://localhost:4000/api/auth/google/callback`
   - `https://<프로젝트>.vercel.app/api/auth/google/callback` (배포 후)
4. 발급된 클라이언트 ID·비밀을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣습니다.
5. 요청하는 권한은 `openid email profile`뿐입니다.

### 3. 나머지 값

| 변수 | 만드는 법 |
|---|---|
| `JWT_SECRET`, `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `VAPID_SUBJECT` | `mailto:` 로 시작하는 담당자 이메일 |
| `ADMIN_EMAILS` | 관리자 3명의 Google 이메일, 쉼표로 구분 |
| `FRONTEND_URL`, `CORS_ORIGIN` | 로컬은 `http://localhost:5173`, 운영은 배포 도메인 |

프런트 전용 값(`VITE_API_BASE_URL`, `VITE_VAPID_PUBLIC_KEY`)은 `frontend/.env.example`을 `frontend/.env`로 복사해 채웁니다. `VITE_VAPID_PUBLIC_KEY`는 `VAPID_PUBLIC_KEY`와 같은 값입니다.

## 로컬 실행

1. 위 환경 설정을 끝내고 `.env`를 채웁니다.
2. 의존성 설치: `npm install` (루트에서 한 번)
3. DB 준비 (루트에서 실행): `npx prisma migrate dev`로 스키마를 적용하고 `npx prisma db seed`로 지원 유형 기본값 5건을 넣습니다. 시드는 여러 번 실행해도 중복되지 않습니다.
   - Supabase 대신 로컬 DB를 쓰려면: `docker run -d --name ai-support-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_support -p 5433:5432 postgres:16` 후 `DATABASE_URL`, `DIRECT_URL`을 둘 다 `postgresql://postgres:postgres@localhost:5433/ai_support`로 설정합니다.
4. 백엔드: `npm run dev --workspace backend` (기본 포트 4000)
5. 프런트엔드: `npm run dev --workspace frontend` (기본 포트 5173)
6. 테스트 (루트에서 실행)
   - `npm test`: 단위 테스트. DB·외부 서비스 없이 실행됩니다.
   - DB 테스트는 실제 푸시 서버로 알림을 보내지 않고 실제 Supabase Storage에도 접속하지 않습니다. 둘 다 기본값을 "차단"으로 두고, 알림·첨부 테스트는 메모리 가짜를 끼웁니다. `.env`에 실제 Supabase 키가 있어도 테스트 환경은 값을 비워 덮어쓰지 못하게 했습니다.
   - 저장소 드라이버(`createSupabaseStorage`)는 로컬 가짜 Supabase Storage 서버(`backend/src/test/fakeSupabaseStorage.js`)를 상대로 단위 테스트합니다.
   - `npm run test:db`: DB를 쓰는 테스트(동시 접수 등). **전용 테스트 DB에서만** 실행됩니다. 처음 한 번 `npm run test:db:setup`으로 테스트 DB를 만들고 마이그레이션을 적용합니다.
   - 테스트 DB 기본 주소는 `postgresql://postgres:postgres@localhost:5433/ai_support_test`(위 Docker 컨테이너)이고, 다른 로컬 DB를 쓰려면 `TEST_DATABASE_URL`을 지정합니다. 주소가 **로컬이 아니거나 DB 이름이 `_test`로 끝나지 않으면** 테스트가 시작되지 않습니다. `DATABASE_URL`이나 `backend/.env`의 Supabase 주소는 테스트가 절대 쓰지 않습니다.
7. `http://localhost:5173`에서 Google로 로그인하고, `GET /api/auth/me`가 `role`과 함께 응답하는지 확인합니다.

## 배포 (Vercel + Supabase)

구성: 프런트는 정적 빌드(`frontend/dist`), 백엔드는 Vercel 서버리스 함수 하나(`api/index.js`가 Express 앱을 감쌉니다)입니다. `vercel.json`이 `/api/*`는 그 함수로, 나머지 주소는 `index.html`(SPA)로 보냅니다. 프런트와 API가 **같은 도메인**이라 CORS 설정이 필요 없고, 프런트는 `/api/...`를 상대 경로로 부릅니다.

준비물: Node.js 20(내 PC), 새 GitHub 저장소, Vercel 계정, Supabase 프로젝트와 Google OAuth 클라이언트(위 "환경 설정" 1·2).

### 1단계: 데이터베이스 만들기 (내 PC에서, 배포 전 한 번)

Vercel 빌드는 DB 표를 만들지 않습니다. 마이그레이션은 직접 실행합니다. 프로젝트 루트의 PowerShell에서, 값은 Supabase 대시보드에서 복사한 주소로 바꿉니다(풀드 6543 / 다이렉트 5432).

```powershell
$env:DATABASE_URL = "postgresql://postgres.[ref]:[비밀번호]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
$env:DIRECT_URL = "postgresql://postgres:[비밀번호]@db.[ref].supabase.co:5432/postgres"
npx prisma migrate deploy
npx prisma db seed
npx prisma migrate status
```

- `migrate deploy`가 `backend/prisma/migrations`의 모든 마이그레이션을 순서대로 적용합니다. 마지막 `migrate status`가 "Database schema is up to date!"를 보여야 합니다.
- `db seed`는 지원 유형 기본 5건을 넣습니다. 여러 번 실행해도 중복되지 않습니다.
- 이 PowerShell 창을 닫으면 위 값은 사라집니다. 로컬 `.env`에 이미 다른 DB 주소가 들어 있어도 `$env:` 값이 우선하므로, **어느 DB에 적용하는지** 명령 실행 전에 두 주소를 다시 확인하세요.
- 첨부파일을 쓴다면 이때 [첨부파일 저장소 설정](#supabase-storage-설정-직접-해야-합니다)(비공개 버킷 `attachments`, 파일 크기 10MB 제한)도 합니다.

### 2단계: GitHub에 올리고 Vercel에 연결

1. 이 폴더를 새 GitHub 저장소에 올립니다. `.env`와 `.env.*`는 `.gitignore`로 제외되어 있으니, 올리기 전에 `git status`에 `.env`가 보이지 않는지 확인하세요.
2. Vercel → **Add New → Project** → 그 저장소를 Import합니다.
   - **Root Directory**: 저장소 루트(기본값). **Framework Preset**: `Other`. 빌드·설치·출력 폴더는 `vercel.json`이 정하므로 건드리지 않습니다.
   - **Node.js Version**: Project Settings → General에서 20.x.
3. **Deploy를 누르기 전에** 다음 단계의 환경변수를 넣습니다. 필수 값이 없으면 서버 함수가 시작하지 못하고 모든 `/api` 요청이 오류가 납니다.

### 3단계: 환경변수 (Vercel → Settings → Environment Variables → Production)

| 변수 | 필수 | 값 |
|---|---|---|
| `DATABASE_URL` | 예 | Supabase 풀드 연결(6543), 끝에 `?pgbouncer=true&connection_limit=1`. 서버리스는 요청마다 연결이 생기므로 `connection_limit=1`을 꼭 붙입니다 |
| `DIRECT_URL` | 예 | Supabase 다이렉트 연결(5432). 마이그레이션이 쓰는 값이라 Vercel에도 같이 넣어 둡니다 |
| `JWT_SECRET` | 예 | 긴 무작위 문자열(위 "나머지 값"). 바꾸면 모든 사용자가 다시 로그인해야 합니다 |
| `JWT_EXPIRES_IN` | 아니오 | 로그인 유지 기간. 기본 `7d` |
| `ADMIN_EMAILS` | 예 | 관리자 3명의 Google 이메일, 쉼표로 구분 |
| `GOOGLE_CLIENT_ID` | 예 | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 예 | Google OAuth 클라이언트 비밀 |
| `GOOGLE_REDIRECT_URI` | 예 | `https://<도메인>/api/auth/google/callback` (Google 콘솔의 승인된 리디렉션 URI와 글자까지 같아야 함) |
| `FRONTEND_URL` | 예 | `https://<도메인>` (끝에 `/` 없이). 로그인 후 브라우저를 돌려보내는 주소 |
| `CORS_ORIGIN` | 아니오 | 같은 도메인이라 운영에서는 필요 없습니다. 기본값은 로컬 주소이니 그대로 둬도 됩니다 |
| `VAPID_PUBLIC_KEY` | 예 | 웹 푸시 공개키 |
| `VAPID_PRIVATE_KEY` | 예 | 웹 푸시 비밀키 |
| `VAPID_SUBJECT` | 예 | `mailto:` 로 시작하는 담당자 이메일 |
| `CRON_SECRET` | 예 | 긴 무작위 문자열. `/api/cron/*` 호출을 보호합니다 |
| `SUPABASE_URL` | 첨부 사용 시 | Supabase `Project URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | 첨부 사용 시 | Supabase `service_role` 키. 서버 전용, 절대 `VITE_` 이름으로 넣지 않습니다 |
| `SUPABASE_BUCKET` | 아니오 | 첨부 버킷 이름. 기본 `attachments` |
| `VITE_VAPID_PUBLIC_KEY` | 알림 사용 시 | `VAPID_PUBLIC_KEY`와 같은 값. **빌드 때 프런트 코드에 들어가므로** 바꾸면 다시 배포해야 합니다 |
| `VITE_API_BASE_URL` | 아니오 | **운영에서는 만들지 않습니다.** 없으면 같은 도메인의 `/api`를 부릅니다 |
| `NODE_ENV` | 자동 | Vercel이 `production`으로 설정합니다 |
| `PORT` | 로컬만 | 로컬 서버 포트(기본 4000). Vercel에서는 쓰지 않습니다 |

- 환경변수를 바꾼 뒤에는 **Redeploy**해야 반영됩니다. `VITE_*`는 빌드 때 들어가므로 특히 그렇습니다.
- 도메인은 첫 배포 뒤에야 확정됩니다. 처음에는 임시 값으로 배포 → 도메인 확인 → `FRONTEND_URL`·`GOOGLE_REDIRECT_URI`를 고치고 → Redeploy 순서로 합니다.
- 값을 구하는 방법은 위 "환경 설정"과 `.env.example`의 주석을 따릅니다.

### 4단계: Google 콘솔

1. **승인된 리디렉션 URI**에 `https://<도메인>/api/auth/google/callback`을 추가합니다(저장하고 몇 분 걸릴 수 있음).
2. OAuth 동의 화면이 "외부"이고 게시 상태가 "테스트"라면 **등록한 테스트 사용자만** 로그인할 수 있습니다. 학생·직원 전체가 써야 하면 "프로덕션으로 게시"하거나, 학교 계정만 쓴다면 "내부"로 둡니다.

### 5단계: 배포 확인 (체크리스트)

1. `https://<도메인>/api/health`를 브라우저로 엽니다 → `{"status":"ok","db":"ok"}`. (`db`가 `down`이면 503: `DATABASE_URL`을 확인하세요.)
2. `https://<도메인>`에서 로그인 화면이 열리고 **Google 로그인**이 끝나 요청서 목록이 보입니다.
3. `ADMIN_EMAILS`의 계정으로 로그인하면 메뉴에 **통계·근로시간 현황·관리**가 보입니다.
4. 관리자가 **관리 → 사용자** 탭의 "지원자 이메일로 등록"에 근로학생들의 Google 이메일을 넣습니다. 그 학생이 **처음 로그인하면 바로 지원자**로 시작합니다(이미 로그인한 학생은 즉시 지원자로 바뀝니다).
5. 요청자 계정으로 **요청서 제출 → 지원자 접수 → 작업내역 입력 → 요청자 1차 확인 → 관리자 최종 확인**이 끝까지 되는지 봅니다. 이 흐름이 운영 완료 조건입니다.
6. (선택) 설정 화면에서 알림을 켜고 다른 기기에서 요청서를 제출해 푸시가 오는지, 요청서에 파일을 올려 보는지 확인합니다.

### 6단계: 이후 배포와 운영

- 코드 변경: 기본 브랜치에 push하면 Vercel이 자동 배포합니다. 배포 목록(Deployments)에서 이전 배포를 **Promote**해 되돌릴 수 있습니다. DB는 함께 되돌아가지 않습니다.
- **스키마가 바뀐 배포**(`backend/prisma/migrations`에 새 폴더가 생겼다면. 지원자 이메일 등록을 넣은 `20261118130000_supporter_invite`가 그 예입니다): 배포 **전에** 1단계의 `npx prisma migrate deploy`를 먼저 실행합니다. 새 코드가 먼저 올라가면 처음 로그인하는 사람의 가입이 실패합니다. 새 코드가 아직 없는 컬럼을 읽는 순간이 생기지 않게, 컬럼 추가처럼 옛 코드도 견디는 변경 위주로 하세요.
- 오류 확인: Vercel → Logs. 서버 오류는 `[ERROR]` 줄로 남습니다.
- 사용자·역할: 지원자 지정과 유형 관리는 앱의 관리 화면에서 합니다. 관리자를 바꾸려면 `ADMIN_EMAILS`를 고치고 Redeploy합니다(추가된 사람은 다음 로그인 때 관리자가 되고, 목록에서 뺀 사람은 자동으로 강등되지 않습니다).

### 7단계: Supabase 일시중지 막기 (cron-job.org)

무료 플랜은 **7일 동안 DB 활동이 없으면 프로젝트가 일시중지**됩니다(방학처럼 쓰지 않는 기간에 일어나기 쉽습니다). `GET /api/health`는 DB에 실제로 `SELECT 1`을 보내므로, 이것을 정기적으로 부르면 활동으로 잡힙니다. Vercel Cron 대신 무료 외부 서비스 [cron-job.org](https://cron-job.org)를 씁니다.

1. cron-job.org에 가입하고 **Create cronjob**을 누릅니다.
2. **Title**: `ai-support health` / **URL**: `https://<도메인>/api/health`
3. **Execution schedule**: 하루 1~2회(예: 매일 09:00과 21:00). 7일 한도보다 훨씬 촘촘하면 한두 번 실패해도 안전합니다.
4. 요청 방식은 기본 **GET**이고, 인증 헤더는 필요 없습니다.
5. **Notify me when…**에서 "실행 실패" 알림을 켭니다. 응답이 503(DB 연결 실패)이거나 시간 초과면 실패로 처리되어 메일이 옵니다.
6. 저장한 뒤 **Test run**으로 응답이 200 `{"status":"ok","db":"ok"}`인지 확인합니다.

- **희망 완료일 하루 전 알림**을 보내려면 cron-job.org에 작업을 **하나 더** 만듭니다(위 건강 확인과는 별개입니다).
  1. **Title**: `ai-support reminders` / **URL**: `https://<도메인>/api/cron/reminders`
  2. **Request method**: **POST**
  3. **Advanced → Headers**에 `Authorization` = `Bearer <CRON_SECRET 값>`을 추가합니다. 값은 Vercel의 `CRON_SECRET`과 같아야 합니다(다르면 401).
  4. **Execution schedule**: **매시간**(예: 매시 정각)이면 충분합니다. 한국 시간 오전 9시 이후 첫 실행에서 보내고, 같은 요청서에는 두 번 보내지 않으므로 더 자주 불러도 중복되지 않습니다.
  5. 저장한 뒤 **Test run**으로 응답이 200이고 `{"ok":true,...}`인지 확인합니다. 오전 9시 전에는 `"skipped":true`로 나오는 것이 정상입니다.
  6. 이 작업을 만들지 않으면 하루 전 알림만 가지 않습니다(상태가 바뀔 때의 알림은 영향이 없습니다).
- 이미 일시중지된 프로젝트는 Supabase 대시보드에서 **Restore**해야 합니다. 복구 가능 기간은 Supabase 안내를 확인하세요.

### 문제 해결

| 증상 | 확인할 것 |
|---|---|
| Google 로그인에서 `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI`와 Google 콘솔의 승인된 리디렉션 URI가 글자까지 같은지(`https`, 도메인, 끝의 `/api/auth/google/callback`) |
| 로그인 뒤 엉뚱한 주소(localhost 등)로 이동 | `FRONTEND_URL`이 운영 도메인인지. 바꿨다면 Redeploy |
| 모든 `/api` 호출이 500, 로그에 `Invalid environment configuration` | 로그에 적힌 이름의 필수 환경변수가 빠졌습니다. 추가하고 Redeploy |
| `/api/health`가 503 | `DATABASE_URL`(6543, `pgbouncer=true`), 비밀번호, Supabase 프로젝트가 일시중지 상태인지 |
| 화면이 `localhost:4000`을 부름 | 운영에 `VITE_API_BASE_URL`이 들어 있는지. 지우고 Redeploy |
| 첨부 업로드가 503 | `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`, 비공개 버킷 `attachments`가 있는지 |
| 설정 화면이 "알림 서버 설정이 되어 있지 않다" | `VITE_VAPID_PUBLIC_KEY`가 없습니다. 추가하고 Redeploy(빌드에 들어가는 값) |
| 등록한 학생이 로그인했는데 지원자가 아님 | 등록한 이메일이 그 학생이 로그인에 쓴 Google 이메일과 같은지("로그인 대기 중" 목록에 아직 남아 있다면 다른 이메일로 로그인한 것입니다). 이미 가입한 뒤라면 사용자 목록에서 지원자로 지정하거나 같은 이메일을 다시 등록하세요 |
| 새 배포 뒤 "column does not exist" 같은 DB 오류 | 새 마이그레이션을 적용하지 않았습니다. 1단계 `migrate deploy` 실행 |

## 인증과 역할

이메일/비밀번호 가입은 없고 Google 계정으로만 로그인합니다.

- 최초 로그인 시 사용자가 자동 생성됩니다. `ADMIN_EMAILS`에 있는 이메일은 `ADMIN`, 그 외는 `REQUESTER`입니다.
- 지원자(`SUPPORTER`)는 관리자가 **관리 화면(`/admin`)의 사용자 탭**에서 지정합니다. 다시 로그인해도 역할은 바뀌지 않고, 지정·해제는 사용자가 다시 로그인하지 않아도 다음 요청부터 바로 적용됩니다. (서버가 요청마다 DB의 현재 역할을 읽습니다.)
- **이메일로 미리 등록**: 사용자 탭 위쪽의 "지원자 이메일로 등록"에 근로학생의 Google 이메일을 넣으면(여러 명은 쉼표·공백·줄바꿈으로 구분, 한 번에 50명까지), **아직 로그인하지 않은 학생도 등록**됩니다.
  - 이미 가입한 요청자는 바로 지원자가 됩니다. 아직 가입 전이면 "로그인 대기 중" 목록에 올라가고, 그 이메일로 **처음 로그인할 때 지원자로 시작**하며 목록에서 사라집니다.
  - 이메일을 잘못 넣었다면 대기 목록의 **취소**로 지웁니다. 철자가 틀린 이메일은 아무도 쓰지 않으므로 대기 목록에 계속 남습니다.
  - 이메일은 대소문자를 구분하지 않습니다. 형식이 틀린 이메일이 하나라도 있으면 어느 것이 틀렸는지 알려 주고 **아무것도 등록하지 않습니다**.
  - 관리자 계정과 `ADMIN_EMAILS`의 이메일은 지원자로 등록되지 않습니다(처음 로그인하면 관리자가 되므로).
  - 사전 등록은 **처음 가입할 때만** 적용됩니다. 이미 가입한 사람이 지원자로 지정된 뒤 해제되면 다시 로그인해도 요청자로 남습니다. Google이 이메일 소유를 확인한(`email_verified`) 로그인에만 적용합니다.
- `ADMIN_EMAILS`에 새로 추가한 이메일의 기존 사용자는 다음 로그인 때 `ADMIN`으로 올라갑니다. 목록에서 뺀 이메일은 자동으로 강등되지 않습니다.

## 요청서 작성과 연락처

- **착수일시 ~ 희망 완료일**이 작업을 희망하는 기간입니다. 목록 카드와 상세 화면에 "작업 희망 기간"으로 보입니다. (DB와 API의 필드 이름은 `interviewAt` 그대로이고 화면 이름만 "착수일시"입니다.) 희망 완료일이 착수일보다 앞서는 입력을 막는 검사는 아직 없습니다.
- **작성 화면의 기본값**: 담당자에는 로그인한 Google 계정의 이름이, 소속에는 **가장 최근에 작성한 요청서의 소속**이 미리 채워지며 언제든 다른 부서·다른 사람으로 고칠 수 있습니다. Google 로그인으로는 이름과 이메일만 얻을 수 있고 **부서 정보는 얻을 수 없어서**, 처음 한 번은 직접 입력하고 그 뒤부터 기억해 둔 값을 씁니다. 연락처(전화번호)는 매번 입력합니다.
- **연락처 공개 범위**: 지원자가 **접수하기 전에** 전화로 내용을 확인하거나 방문 일정을 조율할 수 있도록, 접수 가능한(제출됨) 요청서의 연락처는 **모든 지원자**가 목록 카드와 상세에서 볼 수 있습니다. 휴대폰·태블릿에서는 번호를 누르면 바로 전화가 걸리고, PC에서는 번호만 글자로 보입니다(PC에서 전화 링크를 누르면 브라우저가 "앱 선택을 열려고 합니다" 확인 창을 띄우기 때문). 누군가 접수하면 그 요청서는 다른 지원자에게 보이지 않으므로 연락처도 함께 가려지고, 접수된 뒤에는 작성자·담당 지원자·관리자만 봅니다. 접수를 취소해 다시 제출됨이 되면 다시 모든 지원자에게 보입니다. 처리 이력·작업내역·첨부는 이 변경과 상관없이 계속 작성자·담당 지원자·관리자에게만 보입니다. 요청자에게는 작성 화면의 연락처 칸 안내로 이 범위를 알립니다.

## 첨부파일

요청서(작성자)와 작업내역(담당 지원자)에 파일을 붙일 수 있습니다. 파일은 서버를 거치지 않고 **브라우저가 Supabase Storage에 직접 올립니다**(Vercel 서버리스 함수의 요청 크기 제한 4.5MB 때문). 서버는 주소를 발급하고, 올라온 파일을 확인하고, 내려받기 주소를 발급합니다.

- **형식·크기**: pdf, hwp, hwpx, docx, xlsx, pptx, png, jpg(jpeg) / 파일당 10MB 이하 / 요청서와 작업내역 제출 한 번에 각각 최대 10개. 실행 파일·HTML·SVG 등은 허용하지 않습니다.
- **흐름**: ① 서버에서 업로드 주소 발급(형식·크기·권한 검사) → ② 브라우저가 저장소에 업로드 → ③ 서버에 등록(저장소에서 **실제 크기**를 읽어 다시 검증, 규칙을 어기면 저장소에서 지움).
- **누가 올리나**: 요청서 첨부는 작성자가 제출됨 상태일 때만, 작업내역 첨부는 담당 지원자가 접수됨·재작업 상태일 때만 올리고 지울 수 있습니다. 작업내역 첨부는 미리 올려 두면 **제출할 때 그 제출에 묶이며**, 제출 전에는 올린 본인에게만 보이고 제출 후에는 지울 수 없습니다.
- **누가 보나**: 요청서를 볼 수 있는 사람(작성자, 담당 지원자, 관리자)만 목록에서 보고 내려받습니다. 내려받기 주소는 **60초만** 유효하고 원래 파일 이름으로 저장됩니다.
- **저장 경로**: `<요청서 id>/<uuid>.<확장자>` — 사용자가 정한 파일 이름은 경로에 넣지 않습니다(경로 조작 방지, 이름 충돌 방지). 원래 이름은 DB에만 저장합니다.

### Supabase Storage 설정 (직접 해야 합니다)

1. Supabase 대시보드 → **Storage → New bucket**: 이름 `attachments`(다른 이름이면 `SUPABASE_BUCKET`), **Public bucket은 끕니다(비공개)**.
2. 버킷 설정에서 **File size limit을 10MB**로 둡니다. 서명 주소로 올리는 파일의 크기는 서버가 아니라 **저장소가 업로드 시점에 강제**하므로 이 설정이 필수입니다. (서버는 등록할 때 실제 크기를 다시 검사하지만, 이미 올라간 큰 파일을 막지는 못하고 지울 뿐입니다.)
3. `.env`와 Vercel 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`을 넣습니다. 서비스 키는 서버에서만 쓰며 프런트에 절대 노출하지 않습니다.
4. 새 DB 마이그레이션을 적용합니다: `npx prisma migrate deploy` (이번에 첨부 경로의 중복 등록을 막는 고유 인덱스가 추가되었습니다).
5. hwp·hwpx는 브라우저가 파일 형식(MIME)을 비워서 보내는 경우가 있으므로 버킷의 "Allowed MIME types"는 **설정하지 마세요**. 형식은 서버가 확장자로 정해 저장합니다.

### 알아둘 한계

- 업로드만 하고 등록하지 않은 파일(작성 도중 창을 닫은 경우 등)은 저장소에 남습니다. 요청서를 지우면 그 요청서의 등록된 파일은 함께 지워집니다.
- 파일 내용은 검사하지 않습니다(바이러스·악성 문서 검사 없음). 확장자와 크기만 검사합니다.
- 설정이 비어 있으면 첨부 기능만 "파일 저장소가 설정되지 않았습니다"(503)로 막히고 요청서 작성·처리는 정상 동작합니다.

## 만족도 평가

- 요청서가 **완료**되면 **작성한 요청자**가 1~5점과 한 줄 후기(선택)를 한 번 남길 수 있습니다. 남긴 뒤에는 고칠 수 없습니다. 상세 화면의 "만족도 평가" 영역에서 입력하고 표시합니다.
- 평가는 요청서를 보는 사람 중 **작성자·담당 지원자·관리자**에게 보입니다(관련 없는 지원자는 요청서 자체를 볼 수 없습니다). 담당 지원자에게 보이지 않게 하려면 `request.policy.js`의 `rating` 노출 조건을 바꿔야 합니다.
- 관리자가 작성한 요청서는 그 관리자가 작성자이므로 평가할 수 있습니다. 평균 만족도 집계는 통계 대시보드(T-17)에서 다룹니다.

## 모바일·접근성

화면은 폭 375px 휴대폰에서 가로 스크롤 없이 쓸 수 있고, 접수와 작업내역 입력을 끝까지 할 수 있도록 점검했습니다. 기준은 다음과 같습니다(공식 인증이 아니라 **기본 수준 점검**입니다).

- **가로 스크롤 없음**: 공백 없이 긴 제목·부서명도 줄바꿈됩니다. 목록·통계·근로시간은 표 대신 카드로 보여줍니다.
- **누르는 영역 44px 이상**: 버튼·입력·따로 놓인 링크(`tap-link` 클래스)·파일 선택 버튼·대화상자 닫기. 글줄 안의 링크는 제외합니다.
- **글자 확대 허용**: 화면 확대를 막지 않습니다(`viewport`에서 `maximum-scale` 제거). 입력칸 글자는 16px이라 iOS가 자동 확대하지 않습니다.
- **라벨**: 모든 입력에 라벨이 있고(보이지 않는 라벨은 `sr-only` 클래스), 아이콘 버튼에는 `aria-label`이 있습니다.
- **키보드**: 모든 동작을 Tab·Enter·Space로 할 수 있습니다. 첫 Tab에 "본문 바로가기"가 나타나고, 메뉴는 `aria-expanded`와 Esc 닫기를 지원하며, 대화상자는 열리면 안으로 초점이 가고 Tab이 안에서만 돌며 Esc로 닫히고 닫히면 원래 자리로 돌아옵니다. 초점은 3px 남색 테두리로 항상 보입니다(점수 선택처럼 숨긴 라디오도 라벨에 표시).
- **색 대비 4.5:1 이상**: 본문·보조 글자·상태 배지·버튼·오류 글자를 계산으로 확인했습니다. 페이지 배경 위에서 4.5:1에 못 미치던 보조 글자색(`--color-text-muted`)과 오류색(`--color-danger`)을 조금 진하게 바꿨습니다.
- **확인하지 못한 것**: 스크린리더(NVDA·VoiceOver 등)로 읽어 본 것, 실제 휴대폰 기기, 다크 모드(이 앱은 라이트 테마만 지원), 가로 모드·375px보다 좁은 화면.

## 통계 대시보드

관리자 메뉴의 **통계**에서 봅니다. 조회 기간(최근 3·6·12·24개월)을 고를 수 있고 차트 라이브러리 없이 목록과 CSS 막대로 보여줍니다. 집계 기준은 다음과 같습니다.

- **기간은 완료 시각 기준**(한국 시간 달 경계)입니다. 지난달에 제출해 이번 달에 완료했다면 이번 달 완료로 셉니다.
- **처리 시간 = 요청서 제출부터 최종 확인 완료까지**입니다. 재작업·확인 대기로 걸린 시간도 모두 들어가므로 "실제로 일한 시간"이 아니라 "요청자가 기다린 시간"입니다. 평균은 분 단위로 반올림하고, 건수가 0이면 0분이 아니라 `-`(없음)로 보입니다.
- **유형별 건수**는 기간 중 제출된 **요청 건수**와 기간 중 **완료 건수**를 따로 보여줍니다. 사용을 중지한 유형은 기간 안에 활동이 있을 때만 나옵니다.
- **지원자별**: 완료 건수·평균 처리 시간은 담당 지원자 기준, 근로시간은 제출한 작업내역의 소요 시간(아래 "근로시간"과 같은 기준), 평균 만족도는 기간 중 완료된 담당 요청서에 달린 평가의 평균(소수 첫째 자리)입니다.
- **현재 상태별 건수**는 기간과 무관하게 지금 요청서가 어느 단계에 있는지 보여줍니다.

## 근로시간

- 근로시간은 지원자가 **제출한 작업내역의 소요 시간(분)을 더한 값**입니다. 지원자는 메뉴의 **내 근로시간**, 관리자는 **근로시간 현황**(지원자별)에서 월별로 봅니다. **금액은 계산하지 않습니다**(급여 정산은 범위 밖).
- 월은 **한국 시간(KST) 기준**입니다. 매월 1일 0시(한국 시각)부터 말일 24시까지가 한 달이며, UTC로 자르지 않습니다.
- 재작업으로 다시 제출한 **회차도 각각 더합니다**. 요청자·관리자의 확인(승인·반려) 결과와 상관없이 **제출한 기록은 모두 포함**됩니다. 반려되어 승인되지 않은 작업은 빼야 한다면 집계 기준을 바꿔야 합니다.
- 지원자 지정이 해제된 사람도 그 달에 제출한 기록이 있으면 관리자 현황에 남습니다.

## 웹 푸시 알림

요청서 상태가 바뀌면 관련자의 구독한 모든 기기로 알림을 보냅니다. 구독은 **설정 화면**에서 기기마다 켜고 끕니다.

| 상황 | 받는 사람 |
|---|---|
| 요청서 제출 | 모든 지원자와 모든 관리자 |
| 지원자가 접수 | 요청서 작성자 |
| 관리자 배정 | 배정받은 지원자 |
| 작업내역 제출·재제출 | 요청서 작성자 |
| 1차 승인 | 모든 관리자 |
| 1차·최종 반려 | 담당 지원자 |
| 최종 승인(완료) | 작성자와 담당 지원자 |

- 처리한 본인에게는 보내지 않습니다. 접수 취소는 알리지 않습니다.
- **희망 완료일 하루 전 알림**: 희망 완료일이 한국 시간으로 **내일**인 요청서에, 한국 시간 **오전 9시 이후** 첫 실행 때 **한 번만** 보냅니다. 완료된 요청서는 보내지 않고, 지금 **처리할 차례인 사람**에게만 갑니다. 희망 완료일을 고치면 새 날짜에 맞춰 다시 보냅니다. 이 알림은 외부 스케줄러가 `POST /api/cron/reminders`를 불러야 동작합니다([배포 7단계](#7단계-supabase-일시중지-막기-cron-joborg)).

  | 요청서 상태 | 받는 사람 |
  |---|---|
  | 제출됨(아직 접수 전) | 모든 지원자와 모든 관리자 |
  | 접수됨, 재작업 | 담당 지원자 |
  | 1차 확인 대기 | 요청서 작성자 |
  | 최종 확인 대기 | 모든 관리자 |

- 알림은 부가 기능입니다. 전송에 실패하거나 푸시 서버가 느려도 요청서 처리 결과와 응답에는 영향이 없고(최대 4초 대기), 실패는 로그로만 남깁니다. 푸시 서버가 만료(404, 410)로 답한 구독은 자동으로 삭제됩니다.
- iPhone·iPad는 Safari에서 "홈 화면에 추가"한 앱에서만 알림을 켤 수 있습니다. 설정 화면이 안내합니다.
- 필요한 환경변수: 서버 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, 프런트 `VITE_VAPID_PUBLIC_KEY`(서버 공개키와 같은 값). 프런트 값이 없으면 설정 화면이 "알림 서버 설정이 되어 있지 않다"고 안내합니다.
- 공용 PC에서는 로그아웃해도 그 기기의 구독이 남아 있으므로, 쓰고 나서 설정 화면에서 알림을 끄세요.

## API (현재)

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | `/health` | 없음 | 상태 확인 |
| GET | `/api/auth/google/login` | 없음 | Google 로그인 시작 |
| GET | `/api/auth/google/callback` | state 검증 | 로그인 콜백, JWT 발급 |
| GET | `/api/auth/me` | 필요 | 내 정보(id, email, name, role) |
| GET | `/api/requests` | 필요 | 요청서 목록. 역할별 범위(요청자: 내 것, 지원자: 접수 가능 `scope=available` 또는 내 담당 `scope=mine`, 관리자: 전체), `status`, `page`, `pageSize`(최대 100). 카드에 쓰는 `interviewAt`(착수일시)·`contactName`·`contactPhone`을 포함하며, 전화번호는 볼 수 있는 사람(아래 "연락처 공개 범위")에게만 나가고 나머지는 `null` |
| GET | `/api/requests/form-defaults` | 요청자·관리자 | 새 요청서 작성 화면의 기본값 `{contactName, department}`. 이름은 로그인한 계정의 이름, 소속은 가장 최근에 작성한 요청서의 소속(처음이면 `null`) |
| POST | `/api/requests` | 요청자·관리자 | 요청서 제출(상태 제출됨) |
| GET | `/api/requests/:id` | 필요 | 요청서 상세. `workLogs`(회차별 작업내역)와 `events`(시간순 처리 이력: 행위자, 반려 사유, 작업내역 제출의 회차)를 포함. 작업내역·이력·첨부는 작성자·담당 지원자·관리자에게만 보임(접수 가능 목록을 둘러보는 다른 지원자에게는 비어 있음). 전화번호는 "연락처 공개 범위" 참고. 볼 수 없는 요청서는 404 |
| PATCH | `/api/requests/:id` | 작성자 | 요청서 수정(제출됨 상태에서만, 아니면 409) |
| DELETE | `/api/requests/:id` | 작성자 | 요청서 삭제(제출됨 상태에서만, 아니면 409) |
| POST | `/api/requests/:id/accept` | 지원자 | 접수(선착순 단독). 이미 접수됐으면 409 |
| POST | `/api/requests/:id/cancel-accept` | 담당 지원자 | 접수 취소(접수됨 상태에서만). 제출됨으로 돌아가고 담당자가 비워짐 |
| POST | `/api/requests/:id/work-logs` | 담당 지원자 | 작업내역 제출 `{content, minutes}`(소요 분, 0 이상 정수). 접수됨 상태의 첫 제출(1회차) 또는 **재작업 상태의 재제출**(이전 회차는 보존하고 다음 회차 추가). 성공하면 항상 1차 확인 대기. 같은 제출이 겹쳐도 한 번만 반영(나머지 409) |
| POST | `/api/requests/:id/first-review` | 요청서 작성자 | 1차 확인 `{decision: "APPROVE"\|"REJECT", reason}`. 1차 확인 대기 상태에서만. 승인 → 최종 확인 대기, 반려(사유 필수) → 재작업. 이력에 사유가 남음. 겹친 요청은 하나만 반영(나머지 409) |
| POST | `/api/requests/:id/final-review` | 관리자 | 최종 확인 `{decision, reason}`(1차 확인과 같은 형식). 최종 확인 대기 상태에서만. 승인 → 완료(완료 시각 기록), 반려(사유 필수) → 재작업 |
| POST | `/api/requests/:id/assign` | 관리자 | 제출됨 요청서를 지원자에게 직접 배정 `{supporterId}`. 지원자로 지정된 사용자만 가능(아니면 400). 배정하면 접수됨이 되고 ASSIGN 이력이 남음. 지원자가 먼저 접수했거나 배정이 겹치면 409 |
| GET | `/api/admin/users` | 관리자 | 사용자 목록 `?role=&q=(이름·이메일)&page=&pageSize=` |
| PATCH | `/api/admin/users/:id/role` | 관리자 | 요청자 ↔ 지원자 변경 `{role: "REQUESTER"\|"SUPPORTER"}`. 관리자 계정은 변경 불가(403), 진행 중인 담당 요청서가 있는 지원자는 해제 불가(409). **다음 요청부터 바로 적용**(재로그인 불필요) |
| POST | `/api/admin/supporters` | 관리자 | 지원자 이메일 등록 `{emails: [...]}`(1~50개, 소문자로 정리·중복 제거). 이메일마다 `PROMOTED`(바로 지원자로 바꿈) / `INVITED`(첫 로그인 때 지원자로 시작) / `ALREADY_SUPPORTER` / `ALREADY_INVITED` / `ADMIN`(등록 불가) 결과를 돌려줌. 형식이 틀린 이메일이 있으면 400이고 아무것도 등록하지 않음 |
| GET | `/api/admin/supporter-invites` | 관리자 | 아직 로그인하지 않아 대기 중인 지원자 등록 목록(최근 순) |
| DELETE | `/api/admin/supporter-invites/:id` | 관리자 | 대기 중인 등록 취소(204, 없으면 404) |
| GET·POST | `/api/admin/support-types` | 관리자 | 지원 유형 전체 목록(사용 중지 포함, 쓰인 요청서 수) / 추가(맨 뒤에 붙음, 같은 이름은 409) |
| PATCH | `/api/admin/support-types/:id` | 관리자 | 이름·사용 여부·표시 순서 수정 `{name?, active?, sortOrder?}`. 삭제는 없고 `active:false`로 사용 중지. 사용 중인 유형이 하나도 안 남게 되는 중지는 409 |
| POST | `/api/requests/:id/attachments/upload-url` | 작성자 / 담당 지원자 | 업로드 주소 발급 `{target: "request"\|"work", fileName, size}`. 형식·크기·개수·권한 검사(400/403/409), 저장소 미설정이면 503 |
| POST | `/api/requests/:id/attachments` | 작성자 / 담당 지원자 | 업로드한 파일 등록 `{target, path, fileName}`. 저장소의 실제 크기를 다시 검증. 같은 파일 중복 등록은 409 |
| GET | `/api/attachments/:id/download-url` | 요청서 관계자 | 60초 유효한 내려받기 주소. 권한이 없으면 403 |
| DELETE | `/api/attachments/:id` | 올린 사람 | 첨부 삭제(수정 가능한 상태에서만, 제출된 작업내역의 파일은 409) |
| GET | `/api/stats/summary` | 관리자 | 대시보드 요약 `?months=1~24`(생략하면 6, 이번 달부터 거슬러 올라감). 기간 중 완료 건수·평균 처리 시간(제출→완료)·평균 만족도·요청 접수 건수, 달별 완료 건수(오래된 달부터), 유형별 요청·완료 건수, 현재 상태별 건수. 기간이 올바르지 않으면 400 |
| GET | `/api/stats/supporters` | 관리자 | 지원자별 현황 `?months=`. 완료 건수·평균 처리 시간·근로시간·평균 만족도(활동이 없는 지원자도 0으로 포함) |
| GET | `/api/stats/hours` | 관리자 | 지원자별 월 근로시간 현황 `?month=YYYY-MM`(생략하면 이번 달). 기록이 없는 지원자도 0분으로 포함, 형식이 틀리면 400 |
| GET | `/api/stats/my-hours` | 지원자 | 내 근로시간 `?month=YYYY-MM`. 선택한 달의 합계·제출 내역과 최근 12개월 월별 누적(본인 기록만) |
| POST | `/api/requests/:id/rating` | 요청서 작성자 | 만족도 `{score: 1~5 정수, comment?: 한 줄 후기(200자 이하, 줄바꿈 불가)}`. **완료된 요청서에 한 번만**: 작성자가 아니면 403(관련 없는 사람은 404), 완료 전이면 400, 이미 남겼으면 409(동시에 보내도 한 번만 저장). 상세 응답에 `rating`·`canRate`가 포함됨 |
| GET | `/api/support-types` | 필요 | 사용 중인 지원 유형 목록 |
| POST | `/api/push/subscribe`, `/api/push/unsubscribe` | 필요 | 웹 푸시 구독 등록·해제(기기별). 같은 기기를 다른 사용자가 다시 구독하면 마지막 사용자의 것이 됨 |
| GET | `/api/health` | 없음 | 헬스체크. DB에 `SELECT 1`을 보내 `{status, db}`를 돌려줌(DB 장애면 503, 내부 정보 없음). 외부 스케줄러가 불러 Supabase 일시중지를 막는 데 씀 |
| POST | `/api/cron/reminders` | `CRON_SECRET` | 주기 작업 진입점: 희망 완료일 하루 전 알림. 응답 `{ok, skipped, found, sent}` |
