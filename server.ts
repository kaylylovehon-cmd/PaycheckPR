import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;

// Verified SHA-256 digests for Admin ID ("admin") and Access PIN ("2323")
const ADMIN_USER_DIGEST =
  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
const ADMIN_PIN_DIGEST =
  '61503690505f84b144e6ac89124540a3eb8d22e77db76500984cfc50a1d8776e';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const HMAC_SECRET = crypto
  .createHash('sha256')
  .update(
    `${process.env.SESSION_SECRET || process.env.GEMINI_API_KEY || 'paycheck_rp_default_key'}::paycheck_rp_hmac_v1`
  )
  .digest();

interface ScanSlipRequestBody {
  imageBase64?: string;
  mimeType?: string;
}

interface LoginRequestBody {
  adminId?: string;
  pin?: string;
}

interface RawScannedEntry {
  payee?: unknown;
  paycheck?: unknown;
  tax?: unknown;
  netPay?: unknown;
  date?: unknown;
  note?: unknown;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface LockoutEntry {
  failures: number;
  lockedUntil: number;
  windowStart: number;
}

const apiRateBuckets = new Map<string, RateBucket>();
const scanRateBuckets = new Map<string, RateBucket>();
const loginLockouts = new Map<string, LockoutEntry>();

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(
  store: Map<string, RateBucket>,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function timingSafeSha256Match(input: string, expectedHex: string): boolean {
  const actualHex = crypto.createHash('sha256').update(input).digest('hex');
  const a = Buffer.from(actualHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueAdminToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'admin',
      iat: Date.now(),
      exp: Date.now() + TOKEN_TTL_MS,
      nonce: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');

  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };
    return decoded.sub === 'admin' && typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function detectImageMagicMime(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF" ... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseNumericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1_000_000_000, Math.max(0, value));
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[฿,\s]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return Math.min(1_000_000_000, Math.max(0, parsed));
    }
  }
  return 0;
}

function extractJsonText(raw: string): string {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const isTransient =
        message.includes('429') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('unavailable') ||
        message.includes('timeout') ||
        message.includes('network');

      if (!isTransient || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers middleware (Anti-XSS, Clickjacking, MIME-Sniffing, Feature Lockdown)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
    );
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https://i.postimg.cc https://lh3.googleusercontent.com",
        "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
        "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // Global sliding-window rate limiter on /api/*
  app.use('/api', (req, res, next) => {
    const ip = getClientIp(req);
    const limitCheck = checkRateLimit(apiRateBuckets, ip, 80, 60_000);
    if (!limitCheck.allowed) {
      res.setHeader('Retry-After', String(limitCheck.retryAfterSec));
      res.status(429).json({
        error: `คำขอถี่เกินไป กรุณารอ ${limitCheck.retryAfterSec} วินาทีแล้วลองใหม่อีกครั้ง`,
      });
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Server-side Admin Login with Brute-Force Lockout
  app.post('/api/admin/login', (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const lockState = loginLockouts.get(ip);

    if (lockState && lockState.lockedUntil > now) {
      const waitSec = Math.ceil((lockState.lockedUntil - now) / 1000);
      res.status(429).json({
        error: `กรอกรหัสผิดเกินกำหนด ระบบล็อกชั่วคราว กรุณารอ ${waitSec} วินาที`,
      });
      return;
    }

    const body = req.body as LoginRequestBody;
    const adminId = typeof body?.adminId === 'string' ? body.adminId.trim().toLowerCase() : '';
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';

    const isValid =
      adminId.length > 0 &&
      pin.length > 0 &&
      timingSafeSha256Match(adminId, ADMIN_USER_DIGEST) &&
      timingSafeSha256Match(pin, ADMIN_PIN_DIGEST);

    if (!isValid) {
      const windowMs = 5 * 60 * 1000;
      const current =
        lockState && now - lockState.windowStart < windowMs
          ? lockState
          : { failures: 0, lockedUntil: 0, windowStart: now };

      current.failures += 1;
      if (current.failures >= 5) {
        current.lockedUntil = now + windowMs;
      }
      loginLockouts.set(ip, current);

      res.status(401).json({
        error:
          current.failures >= 5
            ? 'กรอกรหัสผิดครบ 5 ครั้ง ระบบล็อกชั่วคราว 5 นาที'
            : 'ข้อมูลยืนยันสิทธิ์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      });
      return;
    }

    loginLockouts.delete(ip);
    const token = issueAdminToken();
    res.json({ token, expiresInMs: TOKEN_TTL_MS });
  });

  app.get('/api/admin/verify', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token || !verifyAdminToken(token)) {
      res.status(401).json({ valid: false });
      return;
    }
    res.json({ valid: true });
  });

  app.post('/api/scan-slip', async (req, res) => {
    try {
      // Verify Admin session token before calling Gemini AI
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token || !verifyAdminToken(token)) {
        res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ Admin ก่อนใช้งานระบบสแกน AI' });
        return;
      }

      const ip = getClientIp(req);
      const scanLimit = checkRateLimit(scanRateBuckets, ip, 15, 60_000);
      if (!scanLimit.allowed) {
        res.setHeader('Retry-After', String(scanLimit.retryAfterSec));
        res.status(429).json({
          error: `สแกนถี่เกินไป กรุณารอ ${scanLimit.retryAfterSec} วินาที`,
        });
        return;
      }

      const body = req.body as ScanSlipRequestBody;
      const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64.trim() : '';

      if (!imageBase64) {
        res.status(400).json({ error: 'ไม่พบข้อมูลรูปภาพสำหรับสแกน' });
        return;
      }

      // Decode & verify binary magic bytes to block disguised malware / non-image payloads
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      if (imageBuffer.length === 0 || imageBuffer.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: 'ขนาดไฟล์รูปภาพไม่ถูกต้อง (ต้องไม่เกิน 10MB)' });
        return;
      }

      const detectedMime = detectImageMagicMime(imageBuffer);
      if (!detectedMime) {
        res.status(400).json({
          error: 'ตรวจพบไฟล์ที่ไม่ใช่รูปภาพ JPG/PNG/WEBP ที่ถูกต้อง ระบบปฏิเสธเพื่อความปลอดภัย',
        });
        return;
      }

      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'ยังไม่ได้ตั้งค่า GEMINI_API_KEY บนเซิร์ฟเวอร์ กรุณากรอกข้อมูลในฟอร์มด้วยตนเองหรือตรวจสอบ Settings > Secrets',
        });
        return;
      }

      const promptText = [
        'วิเคราะห์รูปภาพนี้ (อาจเป็นสลิปเงินเดือนเดี่ยว, ใบเบิกจ่าย, หรือรูปตาราง/Google Sheets/Excel ที่มีหลายรายชื่อ)',
        'ดึงข้อมูลของ "ทุกคน/ทุกแถว" ที่พบในภาพเป็นรายการใน entries เรียงจากบนลงล่าง:',
        '- ข้ามแถวหัวตาราง (เช่น ชื่อผู้เบิก, ยอดเงิน Paycheck, ภาษี, ยอดเงินสุทธิ) และข้ามแถวผลรวม (Total / รวมทั้งหมด) ถ้ามี',
        '- payee: ชื่อผู้เบิกหรือชื่อพนักงาน',
        '- paycheck: ตัวเลขรายได้รวมก่อนหักภาษี (number ไม่มีเครื่องหมายจุลภาค)',
        '- tax: ตัวเลขภาษีหรือรายการหักรวม (number ไม่มีเครื่องหมายจุลภาค ถ้าไม่มีให้ใส่ 0)',
        '- netPay: ตัวเลขยอดเงินสุทธิ (number ไม่มีเครื่องหมายจุลภาค ถ้าไม่ระบุให้คำนวณจาก paycheck - tax)',
        '- date: วันที่ในเอกสารรูปแบบ YYYY-MM-DD (ถ้าไม่พบให้เว้นเป็นค่าว่าง "")',
        '- note: รายละเอียดสั้นๆ เช่น เงินเดือน หรือ รายการเบิกจ่าย (ถ้าไม่พบให้เว้นเป็นค่าว่าง "")',
      ].join('\n');

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: detectedMime,
                  data: imageBase64,
                },
              },
              {
                text: promptText,
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                entries: {
                  type: Type.ARRAY,
                  description: 'รายการข้อมูลผู้เบิกจ่ายทั้งหมดที่สแกนพบในภาพ',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      payee: {
                        type: Type.STRING,
                        description: 'ชื่อผู้เบิกหรือชื่อพนักงาน',
                      },
                      paycheck: {
                        type: Type.NUMBER,
                        description: 'ยอดเงิน Paycheck หรือรายได้รวมก่อนหักภาษี',
                      },
                      tax: {
                        type: Type.NUMBER,
                        description: 'ภาษีหรือรายการหักรวม',
                      },
                      netPay: {
                        type: Type.NUMBER,
                        description: 'ยอดเงินสุทธิที่ได้รับ',
                      },
                      date: {
                        type: Type.STRING,
                        description: 'วันที่รูปแบบ YYYY-MM-DD หรือค่าว่างหากไม่พบ',
                      },
                      note: {
                        type: Type.STRING,
                        description: 'หมายเหตุหรือรายละเอียดสั้นๆ',
                      },
                    },
                    required: ['payee', 'paycheck', 'tax', 'netPay', 'date', 'note'],
                  },
                },
              },
              required: ['entries'],
            },
          },
        })
      );

      const rawText = extractJsonText(response.text ?? '{}');
      const parsedJson = JSON.parse(rawText) as
        | { entries?: RawScannedEntry[] }
        | RawScannedEntry[]
        | RawScannedEntry;

      let rawEntries: RawScannedEntry[] = [];
      if (Array.isArray(parsedJson)) {
        rawEntries = parsedJson;
      } else if (
        parsedJson &&
        typeof parsedJson === 'object' &&
        'entries' in parsedJson &&
        Array.isArray(parsedJson.entries)
      ) {
        rawEntries = parsedJson.entries;
      } else if (parsedJson && typeof parsedJson === 'object' && 'payee' in parsedJson) {
        rawEntries = [parsedJson as RawScannedEntry];
      }

      const normalizedEntries = rawEntries
        .map((item) => {
          const payee = sanitizeText(item.payee, 120);
          const paycheck = parseNumericValue(item.paycheck);
          const tax = parseNumericValue(item.tax);
          const rawNet = parseNumericValue(item.netPay);
          const netPay = rawNet > 0 || paycheck === 0 ? rawNet : Math.max(0, paycheck - tax);
          const date =
            typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date.trim())
              ? item.date.trim()
              : '';
          const note = sanitizeText(item.note, 200);

          return {
            payee,
            paycheck,
            tax,
            netPay,
            date,
            note,
          };
        })
        .filter((item) => item.payee.length > 0 || item.paycheck > 0 || item.netPay > 0);

      if (normalizedEntries.length === 0) {
        res.status(422).json({
          error:
            'ไม่พบข้อมูลชื่อผู้เบิกหรือตัวเลขในรูปภาพ กรุณาลองใช้ภาพที่คมชัดขึ้นหรือกรอกข้อมูลด้วยตนเอง',
        });
        return;
      }

      res.json({ entries: normalizedEntries });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสแกนสลิปด้วย AI';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Paycheck RP server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
