// src/components/Sidebar.tsx
// Persistent left nav. Pure shaping is done server-side by buildSidebarModel;
// this is a dumb renderer + two bits of client state: active-route highlight
// (usePathname) and a localStorage-persisted collapsed flag. Each row shows a
// ProgressRing reflecting that module's mastery (V1 spec §1).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SidebarGroup } from '@/lib/ui/sidebar-model';
import ProgressRing from '@/components/ProgressRing';

const STORAGE_KEY = 'llmtutor.sidebar.collapsed';

interface SidebarProps {
  groups: SidebarGroup[];
}

export default function Sidebar({ groups }: SidebarProps) {
  const pathname = usePathname();

  // Persisted collapse state. Read after mount (localStorage is browser-only);
  // default expanded to avoid a hydration mismatch on first paint.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // localStorage unavailable (private mode etc.) — stay expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore persistence failure
      }
      return next;
    });
  }

  return (
    <nav
      aria-label="Modules"
      data-collapsed={collapsed}
      className={`flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Modules
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <section key={group.track} className="mb-4">
            {!collapsed && (
              <h2 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Track {group.track}
              </h2>
            )}
            <ul className="space-y-1">
              {group.rows.map((row) => {
                const href = `/module/${row.id}`;
                const active = pathname === href;
                return (
                  <li key={row.id}>
                    <Link
                      href={href}
                      title={row.name}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        active
                          ? 'bg-slate-800 font-medium text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <ProgressRing
                        mastery={row.mastery}
                        openDiagnosis={row.openDiagnosis}
                        size={20}
                      />
                      {!collapsed && <span className="truncate">{row.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
