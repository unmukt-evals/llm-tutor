// src/components/TopBar.tsx
// Purely presentational server component.
// Receives pre-computed values from the parent server component — no data-fetching here.

interface TopBarProps {
  /** Current day streak count. */
  streakCount: number;
  /** Number of flashcards due for review today. */
  dueCount: number;
  /** XP earned this week. */
  weeklyXp: number;
}

export default function TopBar({ streakCount, dueCount, weeklyXp }: TopBarProps) {
  return (
    <header
      className="flex items-center gap-6 px-6 py-3 border-b border-slate-200 bg-white text-sm font-medium text-slate-700"
      role="banner"
    >
      <span aria-label={`${streakCount} day streak`}>
        🔥 <span data-testid="streak-count">{streakCount}</span> day{streakCount !== 1 ? 's' : ''}
      </span>
      <span aria-label={`${dueCount} flashcards due`}>
        📚 <span data-testid="due-count">{dueCount}</span> due
      </span>
      <span aria-label={`${weeklyXp} XP this week`}>
        ⚡ <span data-testid="weekly-xp">{weeklyXp}</span> XP this week
      </span>
    </header>
  );
}
