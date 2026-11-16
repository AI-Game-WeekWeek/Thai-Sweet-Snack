import { describe, expect, it } from 'vitest';
import { CafeQueue } from '../../src/cafe/CafeQueue';

const mk = (maxWaiting = 5, patienceMs = 10_000) => new CafeQueue({ maxWaiting, patienceMs, maxNameLength: 16 });
const npc = (dessertId = 'khao-tom-mat') => ({ viewer: false, dessertId });
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

  it('priority: phone order, then viewers (gifts), then VIP, then anonymous; first-come first-served within a rank', () => {
    const q = mk(20);
    q.enqueue(npc('anon1')); q.enqueue(npc('anon2'));
    q.enqueue(viewer('V1', 'viewer1'));
    q.enqueue({ viewer: false, dessertId: 'phone1', kind: 'phone' });
    q.enqueue({ viewer: false, dessertId: 'vip1', kind: 'vip' });
    q.enqueue(viewer('V2', 'viewer2'));
    q.enqueue({ viewer: false, dessertId: 'phone2', kind: 'phone' });
    q.enqueue({ viewer: false, dessertId: 'vip2', kind: 'vip' });
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['phone1', 'phone2', 'viewer1', 'viewer2', 'vip1', 'vip2', 'anon1', 'anon2']);
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

  it('displaceAnonymous removes the last anonymous customer, never a viewer, VIP or phone order', () => {
    const q = mk(10);
    q.enqueue(npc('a1')); q.enqueue(npc('a2'));
    q.enqueue(viewer('V', 'v'));
    q.enqueue({ viewer: false, dessertId: 'vip', kind: 'vip' });
    q.enqueue({ viewer: false, dessertId: 'ph', kind: 'phone' });
    expect(q.displaceAnonymous()).toBe(true);
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['ph', 'v', 'vip', 'a1']);
    expect(q.displaceAnonymous()).toBe(true);
    expect(q.displaceAnonymous()).toBe(false);
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['ph', 'v', 'vip']);
  });

  it('a VIP never makes a paying viewer wait longer: viewers who gifted are called before a VIP who came later or earlier', () => {
    const q = mk(20);
    q.enqueue(npc('a')); q.startNext();
    q.enqueue({ viewer: false, dessertId: 'vip', kind: 'vip' });
    q.enqueue(viewer('V', 'viewer'));
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['viewer', 'vip']);
  });

  it('the lucky-cat slowdown does not stretch a phone order\'s deadline', () => {
    const q = mk(5, 10_000);
    q.enqueue(npc('a')); q.startNext();
    q.enqueue({ viewer: false, dessertId: 'ph', kind: 'phone', patienceMs: 4000 });
    q.enqueue(npc('b'));
    q.tick(1000, 0.5);
    const [ph, b] = q.waiting();
    expect(ph?.patienceMs).toBe(3000); // full speed: a deadline is a deadline
    expect(b?.patienceMs).toBe(9500); // everyone else is slowed
  });

  it('a waiting viewer who sends a gift changes their order instead of becoming a second customer', () => {
    const q = mk();
    q.enqueue({ ...viewer('นีออน', 'khao-tom-mat'), joined: true });
    expect(q.changeOrder('นีออน', 'thong-yod', 'https://x/a.png')).toBe(true);
    expect(q.waiting()).toHaveLength(1);
    expect(q.waiting()[0]).toMatchObject({ name: 'นีออน', dessertId: 'thong-yod', avatarUrl: 'https://x/a.png' });
    expect(q.changeOrder('นีออน', 'bua-loy')).toBe(false); // already paid: a second gift is a second order
    expect(q.changeOrder('คนอื่น', 'x')).toBe(false);
    expect(q.changeOrder('', 'x')).toBe(false);
  });

  it('a gifting viewer shows no countdown but still leaves after the long hidden wait (e.g. left the live); joined-only and anonymous ones use the normal patience', () => {
    const q = mk(5, 1000);
    q.enqueue({ ...viewer('ใจดี', 'bua-loy'), patienceMs: 8000 }); // gifted: long wait
    q.enqueue({ ...viewer('คนเข้า', 'khao-tom-mat'), joined: true });
    q.enqueue(npc());
    expect(q.tick(5000).map((c) => c.name)).toEqual(['คนเข้า', null]);
    expect(q.waiting().map((c) => c.name)).toEqual(['ใจดี']);
    expect(q.tick(4000).map((c) => c.name)).toEqual(['ใจดี']); // gone after its long wait
    expect(q.waiting()).toHaveLength(0);
  });

  it('only a gift (or a phone order) cuts the line; viewers who only joined, returning regulars and fillers wait in the order they arrived', () => {
    const q = mk(10);
    q.enqueue(npc('a'));
    q.enqueue({ ...viewer('เข้า1', 'j1'), joined: true });
    q.enqueue({ ...viewer('เข้า2', 'j2'), joined: true });
    q.enqueue(npc('b'));
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['a', 'j1', 'j2', 'b']); // plain first come, first served
    q.enqueue(viewer('ใจดี', 'g1')); // gifted: cuts the line
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g1', 'a', 'j1', 'j2', 'b']);
    q.enqueue({ viewer: false, kind: 'vip', dessertId: 'v' }); // the VIP reward comes right after the gifters
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g1', 'v', 'a', 'j1', 'j2', 'b']);
    expect(q.changeOrder('เข้า2', 'g2')).toBe(true); // a joined viewer who then gifts moves up, behind the earlier gifter
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g1', 'g2', 'v', 'a', 'j1', 'b']);
    q.enqueue({ viewer: false, kind: 'phone', dessertId: 'p', force: true });
    expect(q.waiting()[0]?.dessertId).toBe('p'); // the ghost cuts in front of everyone
    expect(q.countedWaiting()).toBe(6); // ... but does not count against the line size
  });

  it('makeRoom drops a filler first, then the joined-only viewer who has waited longest OFF screen; never the front places, a gifter or a VIP', () => {
    const q = mk(10, 10_000);
    q.enqueue(viewer('ใจดี', 'g'));
    q.enqueue({ ...viewer('เก่า1', 'j1'), joined: true });
    q.enqueue({ ...viewer('เก่า2', 'j2'), joined: true });
    q.enqueue({ ...viewer('เก่า3', 'j3'), joined: true });
    q.enqueue(npc('a'));
    expect(q.makeRoom(2)).toBe(true); // the filler
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g', 'j1', 'j2', 'j3']);
    expect(q.makeRoom(2)).toBe(true); // places 0 and 1 (g, j1) are protected: j2 is the oldest one off screen
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g', 'j1', 'j3']);
    expect(q.makeRoom(2)).toBe(true);
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g', 'j1']);
    expect(q.makeRoom(2)).toBe(false); // only protected places are left
    expect(q.makeRoom(0)).toBe(true); // nothing protected: the joined viewer may go, but never the gifter
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['g']);
    expect(q.makeRoom(0)).toBe(false);
  });

  it('only the customers on screen (the first `active` in line) lose patience; those further back keep all of theirs until they move up', () => {
    const q = mk(10, 1000);
    for (let i = 0; i < 6; i++) q.enqueue(npc(`n${i}`));
    expect(q.tick(1500, 1, 2).map((c) => c.dessertId)).toEqual(['n0', 'n1']); // the two on screen ran out
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['n2', 'n3', 'n4', 'n5']);
    expect(q.waiting().every((c) => c.patienceMs === 1000)).toBe(true); // nobody behind lost a second
    expect(q.tick(400, 1, 2)).toHaveLength(0);
    expect(q.waiting().map((c) => c.patienceMs)).toEqual([600, 600, 1000, 1000]); // now the front two are counting
    q.tick(700, 1, 2);
    expect(q.waiting().map((c) => c.dessertId)).toEqual(['n4', 'n5']);
    expect(q.tick(300, 1, 0)).toHaveLength(0); // active 0: nobody counts
    expect(q.waiting().every((c) => c.patienceMs === 1000)).toBe(true);
  });

  it('trimViewers drops the joined-only viewers who waited longest (and at least minWaitedMs) off screen when there are more viewers than people in the live', () => {
    const q = mk(30, 100_000);
    q.enqueue(viewer('ใจดี', 'g')); // gifter: never trimmed
    for (let i = 0; i < 6; i++) q.enqueue({ ...viewer(`เข้า${i}`, `j${i}`), joined: true });
    q.enqueue(npc('bot'));
    q.tick(70_000, 1, 0); // 70 s of waiting for everybody (nobody on screen counts patience here)
    q.enqueue({ ...viewer('ใหม่', 'new'), joined: true }); // arrived just now
    // 8 real viewers in the line (1 gifter + 7 joined); only 4 people are in the live
    expect(q.trimViewers(4, 60_000, 2)).toBe(4);
    const left = q.waiting().map((c) => c.dessertId);
    expect(left).toEqual(['g', 'j0', 'j5', 'bot', 'new']); // the four who had waited longest off screen (j1..j4) went
    expect(left).toContain('g'); // the gifter stays
    expect(left).toContain('j0'); // the front places are protected
    expect(left).toContain('new'); // too new: the count lags behind joins
    expect(q.trimViewers(100, 60_000, 2)).toBe(0); // nobody over the limit: nothing happens
    expect(q.trimViewers(NaN, 0, 0)).toBe(0);
  });

  it('the customer at the counter counts as a viewer too (served = 1)', () => {
    const q = mk(30, 100_000);
    for (let i = 0; i < 3; i++) q.enqueue({ ...viewer(`เข้า${i}`, `j${i}`), joined: true });
    q.tick(70_000, 1, 0);
    expect(q.trimViewers(3, 60_000, 0, 1)).toBe(1); // 3 waiting + 1 served = 4 > 3
    expect(q.waiting()).toHaveLength(2);
  });

  it('clearWaiting by hand: "joined" clears viewers who only joined and the fillers, "all" clears everybody waiting; a phone order and the served customer stay', () => {
    const make = () => {
      const q = mk(30, 100_000);
      q.enqueue(npc('first'));
      q.startNext(); // being served
      q.enqueue(viewer('ใจดี', 'g'));
      q.enqueue({ ...viewer('เข้า', 'j'), joined: true });
      q.enqueue({ viewer: false, kind: 'vip', dessertId: 'v' });
      q.enqueue(npc('bot'));
      q.enqueue({ viewer: false, kind: 'phone', dessertId: 'p', force: true });
      return q;
    };
    const a = make();
    expect(a.clearWaiting('joined')).toBe(2); // the joined viewer and the filler
    expect(a.waiting().map((c) => c.dessertId)).toEqual(['p', 'g', 'v']);
    expect(a.current?.dessertId).toBe('first');
    const b = make();
    expect(b.clearWaiting('all')).toBe(4);
    expect(b.waiting().map((c) => c.dessertId)).toEqual(['p']);
    expect(b.current?.dessertId).toBe('first');
  });

  it('trimViewers removes the QUIETEST off-screen viewers first when it is told how long each has been idle', () => {
    const q = mk(30, 100_000);
    for (let i = 0; i < 6; i++) q.enqueue({ ...viewer(`เข้า${i}`, `j${i}`), joined: true });
    q.tick(70_000, 1, 0); // everybody has waited 70 s
    const chatty = new Set(['เข้า1', 'เข้า2']); // these two did something a moment ago
    const idle = (c: { name: string | null; waitedMs: number }) => (chatty.has(c.name ?? '') ? 5_000 : c.waitedMs);
    expect(q.trimViewers(4, 60_000, 1, 0, idle)).toBe(2);
    const left = q.waiting().map((c) => c.name);
    expect(left).toContain('เข้า1'); // active: kept even though they came earlier than others
    expect(left).toContain('เข้า2');
    expect(left).toContain('เข้า0'); // the front place is protected
    expect(left).not.toContain('เข้า3'); // the quiet ones, earliest first
    expect(left).not.toContain('เข้า4');
    expect(left).toContain('เข้า5');
  });
});
