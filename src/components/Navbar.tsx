import { useState } from 'react';
import { Lock, LogOut, ScanLine, Trophy } from 'lucide-react';

interface NavbarProps {
  isAuthenticated: boolean;
  activeView: 'public' | 'admin';
  onSwitchView: (view: 'public' | 'admin') => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export function Navbar({
  isAuthenticated,
  activeView,
  onSwitchView,
  onOpenLogin,
  onLogout,
}: NavbarProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-obsidian-900/90 backdrop-blur-xl border-b border-amber-500/20 shadow-lg shadow-black/40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => onSwitchView('public')}
          className="min-w-0 flex items-center gap-2 sm:gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-xl"
        >
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-obsidian-950/90 border border-amber-400/35 flex items-center justify-center p-1 shadow-md shadow-amber-500/15 shrink-0 overflow-hidden">
            {!logoFailed ? (
              <img
                src="https://i.postimg.cc/YSzhwp5K/RP-VI-Logo-1.png"
                alt="Paycheck RP Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-yellow-600 text-obsidian-950 font-extrabold text-xs sm:text-sm rounded-md sm:rounded-lg">
                RP
              </div>
            )}
          </div>
          <h1 className="text-sm sm:text-xl font-bold tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-200 bg-clip-text text-transparent whitespace-nowrap truncate">
            Paycheck RP
          </h1>
        </button>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {isAuthenticated && (
            <div className="flex items-center bg-obsidian-950/90 p-0.5 sm:p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => onSwitchView('public')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  activeView === 'public'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-obsidian-950 shadow-xs'
                    : 'text-slate-300 hover:text-amber-300'
                }`}
              >
                <Trophy className="w-3.5 h-3.5 shrink-0" />
                <span>เมนู</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchView('admin')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  activeView === 'admin'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-obsidian-950 shadow-xs'
                    : 'text-slate-300 hover:text-amber-300'
                }`}
              >
                <ScanLine className="w-3.5 h-3.5 shrink-0" />
                <span>Admin</span>
              </button>
            </div>
          )}

          {!isAuthenticated ? (
            <button
              type="button"
              onClick={onOpenLogin}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 border border-amber-400/40 text-amber-300 text-xs sm:text-sm font-semibold shadow-sm transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Admin</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogout}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/30 text-rose-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
