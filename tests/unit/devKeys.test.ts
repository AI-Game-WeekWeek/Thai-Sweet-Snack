// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { devKeys, installDevKeys, type DevKeyTargets } from '../../src/devKeys';

function targets() {
  const events: Record<string, unknown>[] = [];
  const t = {
    game: { nowMs: 1000, ingestEvent: (e: Record<string, unknown>) => (events.push(e), 'queued'), callGhostNow: vi.fn((_t?: number) => true), squeezeNow: vi.fn(() => true), callShaman: vi.fn(() => true), finishCookingNow: vi.fn(() => true) },
    giftCoins: [1, 5, 10, 20, 50, 99, 199, 500],
    setMuted: vi.fn(),
    cycleBackground: vi.fn(() => 'rain'),
    speak: vi.fn(),
    playSound: vi.fn(),
  };
  return { t: t as unknown as DevKeyTargets, raw: t, events };
}
const press = (key: string, init: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));

describe('test shortcuts', () => {
  it('has unique keys with a label each', () => {
    const keys = devKeys();
    expect(new Set(keys.map((k) => k.key)).size).toBe(keys.length);
    expect(keys.every((k) => k.label.length > 0)).toBe(true);
  });

  it('keys 1-8 send gifts of each tier, L/K send likes, F follow, O orange heart, P calls the ghost, C finishes cooking', () => {
    const { t, raw, events } = targets();
    const off = installDevKeys(t);
    for (const k of ['1', '8', 'l', 'k', 'f', 'o', 's', 'r']) press(k);
    expect(events.map((e) => [e.type, e.giftCoins ?? e.count])).toEqual([['gift', 1], ['gift', 500], ['like', 30], ['like', 400], ['follow', 1], ['orangeHeart', 1], ['share', 1], ['rose', 1]]);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    press('p');
    for (const k of ['q', 'w', 'e', 't', 'y']) press(k);
    press('z');
    press('x');
    press('c');
    press('b');
    press('m');
    press('m');
    press('j');
    press('g');
    expect(raw.game.callGhostNow.mock.calls.map((c) => c[0])).toEqual([undefined, 0, 1, 2, 3, 4]);
    expect(raw.game.squeezeNow).toHaveBeenCalledTimes(1);
    expect(raw.game.callShaman).toHaveBeenCalledTimes(1);
    expect(raw.game.finishCookingNow).toHaveBeenCalledTimes(1);
    expect(raw.cycleBackground).toHaveBeenCalled();
    expect(raw.setMuted.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(raw.playSound.mock.calls.map((c) => c[0])).toEqual(['reward', 'ghost']);
    off();
  });

  it('ignores keys with modifiers, keys typed into inputs, and unknown keys; uninstall removes everything', () => {
    const { t, events } = targets();
    const off = installDevKeys(t);
    press('l', { ctrlKey: true });
    press('l', { metaKey: true });
    press('z');
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(events.length).toBe(0);
    off();
    press('l');
    expect(events.length).toBe(0);
    expect(document.body.textContent).not.toContain('คีย์ลัด');
    input.remove();
  });

  it('? toggles the help panel', () => {
    const { t } = targets();
    const off = installDevKeys(t);
    const panel = () => [...document.body.querySelectorAll('div')].find((d) => d.textContent?.includes('คีย์ลัดทดสอบ') && d.querySelector('kbd')) as HTMLElement;
    expect(panel().style.display).toBe('none');
    press('?');
    expect(panel().style.display).toBe('block');
    press('?');
    expect(panel().style.display).toBe('none');
    off();
  });
});
