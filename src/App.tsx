/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminPanel } from './components/AdminPanel';
import { Navbar } from './components/Navbar';
import { PublicDashboard } from './components/PublicDashboard';
import { ToastContainer } from './components/ToastContainer';
import { auth } from './firebase';
import { subscribePaychecks } from './services/paycheckService';
import { PaycheckRecord, ToastMessage, ToastType } from './types/paycheck';
import { clearServerAuthToken, getServerAuthToken } from './utils/crypto';

export default function App() {
  const [records, setRecords] = useState<PaycheckRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isServerAuthed, setIsServerAuthed] = useState(false);
  const [isFirebaseAdminAuthed, setIsFirebaseAdminAuthed] = useState(false);
  const [activeView, setActiveView] = useState<'public' | 'admin'>('public');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const isAuthenticated = isServerAuthed && isFirebaseAdminAuthed;

  const notify = useCallback((message: string, type: ToastType = 'info') => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Verify existing server HMAC session token on boot
  useEffect(() => {
    const token = getServerAuthToken();
    if (!token) return;
    fetch('/api/admin/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.ok) {
          setIsServerAuthed(true);
        } else {
          clearServerAuthToken();
        }
      })
      .catch(() => {
        // Keep unauthenticated on verification failure
      });
  }, []);

  // Track Firebase Auth state
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setIsFirebaseAdminAuthed(Boolean(user && user.emailVerified));
    });
    return () => unsubAuth();
  }, []);

  // Real-time online Firestore subscription for all viewers opening the shared link
  useEffect(() => {
    setIsLoadingData(true);
    const unsubData = subscribePaychecks(
      (items) => {
        setRecords(items);
        setIsLoadingData(false);
      },
      (err) => {
        setIsLoadingData(false);
        const msg = err.message || '';
        if (msg.toLowerCase().includes('quota exceeded')) {
          notify('โควต้าการใช้งานฐานข้อมูลรายวันเต็มแล้ว กรุณาลองใหม่ในวันถัดไป', 'error');
        } else {
          notify('ไม่สามารถโหลดข้อมูลออนไลน์ได้ กรุณารีเฟรชหน้าเว็บ', 'error');
        }
      }
    );
    return () => unsubData();
  }, [notify]);

  const handleSwitchView = useCallback(
    (view: 'public' | 'admin') => {
      if (view === 'admin' && !isAuthenticated) {
        setIsLoginModalOpen(true);
        return;
      }
      setActiveView(view);
    },
    [isAuthenticated]
  );

  const handleAuthenticated = useCallback(() => {
    setIsServerAuthed(true);
    setIsFirebaseAdminAuthed(true);
    setIsLoginModalOpen(false);
    setActiveView('admin');
    notify('ยืนยันสิทธิ์ Admin สำเร็จ ยินดีต้อนรับเข้าสู่ระบบหลังบ้าน', 'success');
  }, [notify]);

  const handleLogout = useCallback(() => {
    clearServerAuthToken();
    setIsServerAuthed(false);
    setIsFirebaseAdminAuthed(false);
    setActiveView('public');
    void signOut(auth);
    notify('ออกจากระบบ Admin เรียบร้อยแล้ว', 'info');
  }, [notify]);

  return (
    <div className="min-h-screen flex flex-col bg-obsidian-950 text-slate-100 relative overflow-x-clip">
      {/* Ambient Luxury Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-blue-900/20 blur-[120px]" />
        <div className="absolute top-1/4 -right-32 w-96 h-96 rounded-full bg-amber-600/10 blur-[130px]" />
      </div>

      <ToastContainer toasts={toasts} />

      <Navbar
        isAuthenticated={isAuthenticated}
        activeView={activeView}
        onSwitchView={handleSwitchView}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      {activeView === 'admin' && isAuthenticated ? (
        <AdminPanel
          records={records}
          onBackToDashboard={() => handleSwitchView('public')}
          onNotify={notify}
        />
      ) : (
        <PublicDashboard records={records} isLoading={isLoadingData} onNotify={notify} />
      )}

      <AdminLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      <footer className="relative z-10 border-t border-slate-900 bg-obsidian-950/90 py-5 px-4 text-center text-xs text-slate-500">
        Paycheck RP &copy; 2026 &mdash; Internal Payroll &amp; Receipt Management System
      </footer>
    </div>
  );
}
