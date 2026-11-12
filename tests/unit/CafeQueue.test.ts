import { describe, expect, it } from 'vitest';
import { CafeQueue } from '../../src/cafe/CafeQueue';

const mk = (maxWaiting = 5, patienceMs = 10_000) => new CafeQueue({ maxWaiting, patienceMs, maxNameLength: 16 });
const npc = (dessertId = 'khanom-krok') => ({ viewer: false, dessertId });
const viewer = (name: string | null = 'มะลิ', dessertId = 'bua-loy') => ({ viewer: true, name, dessertId });

describe('CafeQueue', () => {
  it('serves anonymous customers first-come first-served', () => {
    const q = mk();
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    expect(q.startNext()?.dessertId).toBe('a');
    expect(q.current?.state).toBe('SERVING');
    q.pay();
    expect(q.startNext()?.dessertId).toBe('b');
  });

  it('viewer customers go right behind the one being served, ahead of waiting anonymous ones', () => {
    const q = mk();
    q.enqueue(npc('a')); q.enqueue(npc('b')); q.enqueue(npc('c'));
    q.startNext(); // serving a
    q.enqueue(viewer('x', 'v1'));
    q.enqueue(viewer('y', 'v2'));
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['v1', 'v2', 'b', 'c']); // viewers keep their order of arrival
  });

  it('startNext does nothing while someone is being served or when the queue is empty', () => {
    const q = mk();
    expect(q.startNext()).toBeNull();
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    q.startNext();
    expect(q.startNext()).toBeNull();
    expect(q.current?.dessertId).toBe('a');
  });

  it('refuses customers beyond maxWaiting (viewers too)', () => {
    const q = mk(3);
    for (let i = 0; i < 3; i++) expect(q.enqueue(npc())).toBe('ok');
    expect(q.enqueue(npc())).toBe('full');
    expect(q.enqueue(viewer())).toBe('full');
    expect(q.waiting()).toHaveLength(3);
    q.startNext(); // one leaves the waiting list -> room again
    expect(q.enqueue(viewer())).toBe('ok');
  });

  it('only waiting customers lose patience; one who runs out leaves unhappy and is reported once', () => {
    const q = mk(5, 1000);
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    q.startNext();
    const left1 = q.tick(900);
    expect(left1).toEqual([]);
    const left2 = q.tick(200);
    expect(left2.map((c) => c.dessertId)).toEqual(['b']);
    expect(left2[0]?.state).toBe('LEFT');
    expect(q.waiting()).toHaveLength(0);
    expect(q.tick(5000)).toEqual([]);
    expect(q.current?.dessertId).toBe('a'); // the customer being served never leaves
    expect(q.current?.patienceMs).toBe(1000);
  });

  it('pay returns the customer once with its happiness and clears the counter', () => {
    const q = mk(5, 1000);
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    q.tick(250);
    const c = q.startNext()!;
    const r = q.pay()!;
    expect(r.customer.id).toBe(c.id);
    expect(r.customer.state).toBe('PAID');
    expect(r.happiness).toBeCloseTo(0.75, 5);
    expect(q.pay()).toBeNull();
    expect(q.current).toBeNull();
  });

  it('pay with nobody served is a no-op; release frees the counter without paying', () => {
    const q = mk();
    expect(q.pay()).toBeNull();
    q.enqueue(npc());
    q.startNext();
    expect(q.release()?.state).toBe('LEFT');
    expect(q.current).toBeNull();
    expect(q.pay()).toBeNull();
  });

  it('cleans names: control characters stripped, trimmed, truncated by characters, empty becomes null', () => {
    const q = mk();
    q.enqueue({ viewer: true, name: '  Som\u0000chai\n  ', dessertId: 'a' });
    q.enqueue({ viewer: true, name: 'ก'.repeat(100), dessertId: 'b' });
    q.enqueue({ viewer: true, name: '   ', dessertId: 'c' });
    q.enqueue({ viewer: true, name: '‮​', dessertId: 'd' });
    const names = q.waiting().map((c) => c.name);
    expect(names).toEqual(['Somchai', 'ก'.repeat(16), null, null]);
  });

  it('ids are unique and increasing; avatar seeds are stable per customer', () => {
    const q = mk(20);
    for (let i = 0; i < 10; i++) q.enqueue(npc());
    const ids = q.waiting().map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('invalid dt is ignored and reset empties everything', () => {
    const q = mk(5, 1000);
    q.enqueue(npc());
    for (const dt of [NaN, -5, 0, Infinity]) expect(q.tick(dt)).toEqual([]);
    expect(q.waiting()[0]?.patienceMs).toBe(1000);
    q.startNext();
    q.enqueue(npc());
    q.reset();
    expect(q.current).toBeNull();
    expect(q.waiting()).toHaveLength(0);
  });

  it('viewers are served first-come first-served among themselves, still ahead of anonymous customers', () => {
    const q = mk();
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    q.startNext(); // serving a
    q.enqueue(viewer('A', 'v1'));
    q.enqueue(viewer('B', 'v2'));
    q.enqueue(viewer('C', 'v3'));
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['v1', 'v2', 'v3', 'b']);
  });

  it('a combo of many gifts from one viewer cannot push earlier viewers back', () => {
    const q = mk(20);
    q.enqueue(npc('a')); q.startNext();
    q.enqueue(viewer('first', 'f'));
    for (let i = 0; i < 5; i++) q.enqueue(viewer('combo', `c${i}`));
    expect(q.waiting()[0]?.dessertId).toBe('f');
  });

  it('priority: vip, then phone order, then viewers, then anonymous; first-come first-served within a rank', () => {
    const q = mk(20);
    q.enqueue(npc('anon1')); q.enqueue(npc('anon2'));
    q.enqueue(viewer('V1', 'viewer1'));
    q.enqueue({ viewer: false, dessertId: 'phone1', kind: 'phone' });
    q.enqueue({ viewer: false, dessertId: 'vip1', kind: 'vip' });
    q.enqueue(viewer('V2', 'viewer2'));
    q.enqueue({ viewer: false, dessertId: 'phone2', kind: 'phone' });
    q.enqueue({ viewer: false, dessertId: 'vip2', kind: 'vip' });
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['vip1', 'vip2', 'phone1', 'phone2', 'viewer1', 'viewer2', 'anon1', 'anon2']);
  });

  it('customers carry their kind; normal is the default; a special customer can have its own patience', () => {
    const q = mk(5, 10_000);
    q.enqueue(npc('a'));
    q.enqueue({ viewer: false, dessertId: 'p', kind: 'phone', patienceMs: 3000 });
    const [p, a] = q.waiting();
    expect(p).toMatchObject({ kind: 'phone', patienceMs: 3000, patienceMaxMs: 3000 });
    expect(a).toMatchObject({ kind: 'normal', patienceMs: 10_000 });
    q.startNext();
    expect(q.pay()?.customer.kind).toBe('phone');
  });

  it('tick can slow patience loss (lucky cat); a bad slowdown value falls back to normal speed; the served customer is unaffected', () => {
    const q = mk(5, 1000);
    q.enqueue(npc('a')); q.enqueue(npc('b'));
    q.startNext();
    q.tick(400, 0.5);
    expect(q.waiting()[0]?.patienceMs).toBe(800);
    for (const bad of [NaN, -1, 0, Infinity, 5]) q.tick(100, bad);
    expect(q.waiting()[0]?.patienceMs).toBe(800 - 500);
    expect(q.current?.patienceMs).toBe(1000);
  });

  it('a phone order whose deadline passes while waiting leaves; everyone else keeps waiting', () => {
    const q = mk(5, 10_000);
    q.enqueue(npc('a')); q.startNext();
    q.enqueue({ viewer: false, dessertId: 'p', kind: 'phone', patienceMs: 1000 });
    q.enqueue(npc('b'));
    const left = q.tick(1500);
    expect(left.map((c) => c.dessertId)).toEqual(['p']);
    expect(left[0]?.kind).toBe('phone');
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['b']);
  });

  it('special customers respect the waiting cap too', () => {
    const q = mk(2);
    q.enqueue(npc()); q.enqueue(npc());
    expect(q.enqueue({ viewer: false, dessertId: 'v', kind: 'vip' })).toBe('full');
  });
});
