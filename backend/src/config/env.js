require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_EMAILS: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z.string().min(1, 'GOOGLE_REDIRECT_URI is required'),
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  VAPID_PUBLIC_KEY: z.string().min(1, 'VAPID_PUBLIC_KEY is required'),
  VAPID_PRIVATE_KEY: z.string().min(1, 'VAPID_PRIVATE_KEY is required'),
  VAPID_SUBJECT: z.string().min(1, 'VAPID_SUBJECT is required'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
  // 첨부파일 저장소(Supabase Storage). 비어 있으면 첨부 기능만 꺼진다(나머지는 정상 동작).
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default('attachments'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
env.adminEmailList = env.ADMIN_EMAILS.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

module.exports = env;
