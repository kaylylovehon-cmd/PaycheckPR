import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { ToastMessage } from '../types/paycheck';

interface ToastContainerProps {
  toasts: ToastMessage[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  const styles = {
    success: 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-500/50 text-rose-200',
    info: 'bg-obsidian-900/95 border-amber-400/40 text-amber-200',
  };

  return (
    <div className="fixed top-20 right-4 sm:right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md text-xs sm:text-sm font-medium transition-all duration-200 ${styles[toast.type]}`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {toast.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
