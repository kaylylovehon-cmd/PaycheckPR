import { useEffect, useRef, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Shield,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { setServerAuthToken } from '../utils/crypto';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

export function AdminLoginModal({ isOpen, onClose, onAuthenticated }: AdminLoginModalProps) {
  const [adminId, setAdminId] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [isPinVisible, setIsPinVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [step, setStep] = useState<'credentials' | 'google'>('credentials');

  const idInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setAdminId('');
      setAdminPin('');
      setErrorMessage(null);
      setIsPinVisible(false);
      setStep('credentials');
      setTimeout(() => idInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleVerifyCredentials() {
    const inputUser = adminId.trim().toLowerCase();
    const inputPass = adminPin.trim();

    if (!inputUser || !inputPass) {
      setErrorMessage('กรุณากรอก Admin ID และ Access PIN');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: inputUser, pin: inputPass }),
      });
      const data = (await response.json()) as { token?: string; error?: string };

      if (!response.ok || !data.token) {
        setErrorMessage(data.error || 'ข้อมูลยืนยันสิทธิ์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        setAdminPin('');
        pinInputRef.current?.focus();
        return;
      }

      setServerAuthToken(data.token);

      if (auth.currentUser && auth.currentUser.emailVerified) {
        onAuthenticated();
      } else {
        setStep('google');
      }
    } catch {
      setErrorMessage('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบสิทธิ์ได้');
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleGoogleConnect() {
    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.emailVerified) {
        await signOut(auth);
        setErrorMessage('บัญชี Google นี้ยังไม่ได้ยืนยันอีเมล กรุณาใช้อีเมลที่ยืนยันแล้ว');
        return;
      }
      onAuthenticated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('popup-closed-by-user')) {
        setErrorMessage('ปิดหน้าต่างเชื่อมต่อ Google ก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง');
      } else {
        setErrorMessage('ไม่สามารถเชื่อมต่อบัญชี Google ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gold-card rounded-2xl max-w-md w-full p-6 sm:p-7 space-y-6 border-amber-400/40 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดหน้าต่าง"
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-obsidian-950 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/25">
            <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
          </div>
          <h3 id="admin-modal-title" className="text-xl font-bold text-white">
            Admin
          </h3>
          <p className="text-xs text-slate-400">
            {step === 'credentials'
              ? 'ยืนยันสิทธิ์ผู้ดูแลระบบ Paycheck RP เพื่อจัดการข้อมูลออนไลน์'
              : 'ยืนยันบัญชี Google Admin เพื่อสิทธิ์บันทึกข้อมูลลงฐานข้อมูลออนไลน์'}
          </p>
        </div>

        {step === 'credentials' ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-id-field" className="block text-xs font-semibold text-amber-300">
                Admin ID
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={idInputRef}
                  id="admin-id-field"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={adminId}
                  onChange={(e) => {
                    setAdminId(e.target.value);
                    setErrorMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') pinInputRef.current?.focus();
                  }}
                  placeholder="กรอกรหัสผู้ดูแลระบบ (Admin ID)"
                  className="w-full bg-obsidian-950 border border-slate-700 focus:border-amber-400 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-pin-field" className="block text-xs font-semibold text-amber-300">
                Access PIN
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={pinInputRef}
                  id="admin-pin-field"
                  type={isPinVisible ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={adminPin}
                  onChange={(e) => {
                    setAdminPin(e.target.value);
                    setErrorMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleVerifyCredentials();
                  }}
                  placeholder="กรอกรหัสผ่าน PIN"
                  className="w-full bg-obsidian-950 border border-slate-700 focus:border-amber-400 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />
                <button
                  type="button"
                  onClick={() => setIsPinVisible((prev) => !prev)}
                  aria-label="แสดงหรือซ่อนรหัส"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-300 cursor-pointer"
                >
                  {isPinVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="rounded-xl bg-rose-950/70 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isVerifying}
              onClick={() => void handleVerifyCredentials()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-obsidian-950 text-sm font-bold shadow-lg shadow-amber-500/20 transition cursor-pointer disabled:opacity-60"
            >
              {isVerifying ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบหลังบ้าน'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-950/50 border border-emerald-500/30 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>ยืนยันรหัส Admin สำเร็จแล้ว เหลือขั้นตอนเชื่อมต่อบัญชี Google Admin</span>
            </div>

            {errorMessage && (
              <div className="rounded-xl bg-rose-950/70 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isVerifying}
              onClick={() => void handleGoogleConnect()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-obsidian-950 text-sm font-bold shadow-lg shadow-amber-500/20 transition cursor-pointer disabled:opacity-60"
            >
              {isVerifying ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อบัญชี Google Admin'}
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <Shield className="w-3.5 h-3.5 text-amber-400/70" />
          <span>HMAC-SHA256 &amp; Firebase Security Rules Protected</span>
        </div>
      </div>
    </div>
  );
}
