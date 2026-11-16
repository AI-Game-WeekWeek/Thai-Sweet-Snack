import { describe, expect, it } from 'vitest';
import { readRoomUser } from '../../server/roomUser';

describe('readRoomUser', () => {
  it('reads the viewer count from the common field names, in event/data or flat form, and ignores other messages', () => {
    expect(readRoomUser({ event: 'roomUser', data: { viewerCount: 4 } })?.count).toBe(4);
    expect(readRoomUser({ type: 'roomuser', viewers: '12' })?.count).toBe(12);
    expect(readRoomUser({ event: 'room_user', data: { total: 7.9 } })?.count).toBe(7);
    expect(readRoomUser({ event: 'gift', data: { viewerCount: 4 } })).toBeNull();
    expect(readRoomUser(null)).toBeNull();
    expect(readRoomUser([])).toBeNull();
    expect(readRoomUser('roomUser')).toBeNull();
  });

  it('gives null count (not a guess) when no known field holds a sane number, and still describes the fields', () => {
    const r = readRoomUser({ event: 'roomUser', data: { viewerCount: -5, mystery: 99999999999, note: 'ลับมาก', ok: true, nothing: null } });
    expect(r?.count).toBeNull();
    expect(r?.fields).toMatchObject({ viewerCount: '-5', mystery: '99999999999', ok: 'true' });
    expect(r?.fields.note).toBe('ข้อความ 6 ตัวอักษร'); // a text value is described by its length only
    expect('nothing' in (r?.fields ?? {})).toBe(false);
  });

  it('collects viewer names from a listed array (nickname, uniqueId or a nested user), cleaned and capped at 10', () => {
    const list = [{ nickname: 'พี่ต้น' }, { user: { uniqueId: 'neon' } }, { uniqueId: 'a\u0000b‮' }, 5, null, {}];
    const r = readRoomUser({ event: 'roomUser', data: { viewerCount: 3, topViewers: list } });
    expect(r?.names).toEqual(['พี่ต้น', 'neon', 'ab']);
    expect(r?.fields.topViewers).toBe('รายการ 6 ชิ้น');
    const many = Array.from({ length: 30 }, (_, i) => ({ nickname: `n${i}` }));
    expect(readRoomUser({ event: 'roomUser', data: { viewers: many } })?.names).toHaveLength(10);
  });

  it('never throws on hostile input', () => {
    const evil = { event: 'roomUser', data: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, { nested: { deep: [1, 2, 3] } }])) };
    expect(() => readRoomUser(evil)).not.toThrow();
    expect(Object.keys(readRoomUser(evil)?.fields ?? {}).length).toBeLessThanOrEqual(40);
    const circular: Record<string, unknown> = { event: 'roomUser' };
    circular.data = circular;
    expect(() => readRoomUser(circular)).not.toThrow();
  });
});
