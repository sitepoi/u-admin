import type { ReactNode } from 'react';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  enrolled: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  idle: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'not-enrolled': 'bg-slate-100 text-slate-600 ring-slate-500/20',
  archived: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  retired: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  provisioning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  running: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  partial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'pending-delivery': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'rotation-due': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  suspended: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  error: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  denied: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  'failed-delivery': 'bg-rose-50 text-rose-700 ring-rose-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {label ?? status}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'indigo' | 'warning' | 'danger';
}) {
  const toneClasses = {
    neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
    warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    danger: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
