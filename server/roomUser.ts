/**
 * The "how many people are in the live" message from the event source (TikFinity calls it roomUser). The field names are not
 * confirmed against real data, so this looks for a few common names and shows what it saw on /monitor.
 */
const COUNT_KEYS = ['viewerCount', 'viewer_count', 'viewers', 'totalViewers', 'total', 'totalUser', 'userCount', 'onlineCount', 'currentViewerCount', 'audienceCount', 'memberCount'];
const KIND = ['roomuser', 'roomusers', 'viewercount', 'roomstats'];

export interface RoomUserInfo {
  /** People in the live now, or null when no known field held a number. */
  count: number | null;
  /** Every field of the message with a harmless description of its value (numbers shown, text only by length). */
  fields: Record<string, string>;
  /** Names of viewers listed in the message (some sources list the top viewers), at most 10. */
  names: string[];
}

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, max) : '');

function nameOf(item: unknown): string {
  if (typeof item !== 'object' || item === null) return '';
  const o = item as Record<string, unknown>;
  const u = typeof o.user === 'object' && o.user !== null ? (o.user as Record<string, unknown>) : {};
  return clean(o.nickname ?? o.displayName ?? o.uniqueId ?? u.nickname ?? u.displayName ?? u.uniqueId, 30);
}

/** Null when the message is not a roomUser message. Never throws. */
export function readRoomUser(message: unknown): RoomUserInfo | null {
  try {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
    const m = message as Record<string, unknown>;
    const raw = m.event ?? m.type ?? m.eventName ?? m.action;
    const kind = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z]/g, '') : '';
    if (!KIND.includes(kind)) return null;
    const d = typeof m.data === 'object' && m.data !== null && !Array.isArray(m.data) ? (m.data as Record<string, unknown>) : m;
    let count: number | null = null;
    for (const k of COUNT_KEYS) {
      const v = d[k];
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,8}$/.test(v) ? Number(v) : NaN;
      if (Number.isFinite(n) && n >= 0 && n <= 1e7) {
        count = Math.floor(n);
        break;
      }
    }
    const fields: Record<string, string> = {};
    const names: string[] = [];
    for (const [k, v] of Object.entries(d).slice(0, 40)) {
      const key = clean(k, 40);
      if (key === '') continue;
      if (typeof v === 'number' || typeof v === 'boolean') fields[key] = String(v);
      else if (typeof v === 'string') fields[key] = `ข้อความ ${v.length} ตัวอักษร`;
      else if (Array.isArray(v)) {
        fields[key] = `รายการ ${v.length} ชิ้น`;
        if (names.length < 10) for (const item of v) if (names.length < 10) { const n = nameOf(item); if (n !== '') names.push(n); }
      } else if (v !== null && typeof v === 'object') fields[key] = 'ออบเจ็กต์';
    }
    return { count, fields, names };
  } catch {
    return null;
  }
}
