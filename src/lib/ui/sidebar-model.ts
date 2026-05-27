// PURE shaping: Curriculum + TutorState → the serializable view-model the
// Sidebar renders. Groups by track (curriculum order preserved within a track),
// resolves each module's mastery + open-diagnosis flag from state (defaulting
// to blank/false when absent). No React — server builds this, passes it down.

import type { Curriculum, Mastery, TrackId, TutorState } from '@/lib/types';

export interface SidebarRow {
  id: string;
  name: string;
  track: TrackId;
  mastery: Mastery;
  openDiagnosis: boolean;
}

export interface SidebarGroup {
  track: TrackId;
  rows: SidebarRow[];
}

const TRACK_ORDER: TrackId[] = ['A', 'B', 'C'];

/** Build the per-track grouped sidebar view-model. */
export function buildSidebarModel(
  curriculum: Curriculum,
  state: TutorState,
): SidebarGroup[] {
  const byTrack = new Map<TrackId, SidebarRow[]>();

  for (const m of curriculum.modules) {
    const ms = state.modules[m.id];
    const row: SidebarRow = {
      id: m.id,
      name: m.name,
      track: m.track,
      mastery: ms?.mastery ?? 'blank',
      openDiagnosis: Boolean(ms?.mcq?.openDiagnosis),
    };
    const list = byTrack.get(m.track);
    if (list) list.push(row);
    else byTrack.set(m.track, [row]);
  }

  // Emit tracks in canonical A,B,C order, skipping empty ones.
  return TRACK_ORDER.filter((t) => byTrack.has(t)).map((track) => ({
    track,
    rows: byTrack.get(track)!,
  }));
}
