import type { Game } from './Game';

/** What the shortcut panel needs from the page. Kept as small callbacks so this file has no hidden dependencies. */
export interface DevKeyTargets {
  game: Game;
  giftCoins: readonly number[];
  setMuted(muted: boolean): void;
  cycleBackground(): string;
  speak(text: string, pitch: number, gender: 'male' | 'female'): void;
  playSound(id: string): void;
}

export interface DevKey {
  key: string;
  label: string;
  run: (t: DevKeyTargets) => string | void;
}

let seq = 0;
const ev = (t: DevKeyTargets, type: string, extra: Record<string, unknown> = {}): void => {
  t.game.ingestEvent({ id: `dev${++seq}`, type, count: 1, tsMs: t.game.nowMs, ...extra });
};

/** The test shortcuts (only active with ?keys=1, ?debug=1 or in the hosted demo). */
export function devKeys(): DevKey[] {
  const gifts: DevKey[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    key: String(n),
    label: `ของขวัญชั้น ${n} (ลูกค้าสั่งขนมตามชั้น)`,
    run: (t) => {
      const coins = t.giftCoins[n - 1];
      if (coins === undefined) return;
      ev(t, 'gift', { giftCoins: coins, displayName: `ทดสอบ${n}` });
      return `ส่งของขวัญ ${coins} เหรียญ`;
    },
  }));
  return [
    ...gifts,
    { key: 'l', label: 'กดไลก์รัว 30 ครั้ง (หัวใจ + ซูม)', run: (t) => (ev(t, 'like', { count: 30 }), 'ไลก์ ×30') },
    { key: 'k', label: 'ไลก์ระเบิด 400 ครั้ง', run: (t) => (ev(t, 'like', { count: 400 }), 'ไลก์ ×400') },
    { key: 'f', label: 'กดติดตาม → แมวกวักนำโชค', run: (t) => (ev(t, 'follow'), 'ติดตาม') },
    { key: 'o', label: 'หัวใจสีส้ม → ลูกค้า VIP + ฝนทิป', run: (t) => (ev(t, 'orangeHeart'), 'หัวใจสีส้ม') },
    { key: 's', label: 'แชร์ (โบนัสคะแนน)', run: (t) => (ev(t, 'share'), 'แชร์') },
    { key: 'r', label: 'กุหลาบ (เอฟเฟกต์)', run: (t) => (ev(t, 'rose', { displayName: 'ทดสอบ' }), 'กุหลาบ') },
    { key: 'p', label: 'โทรศัพท์ดัง → ผีไทยมา (ผีบีบถ้าช้า)', run: (t) => (t.game.callGhostNow() ? 'โทรศัพท์ดัง!' : 'มีผีอยู่แล้ว หรือคิวเต็ม') },
    ...(['นางรำ', 'ผีพราย', 'กระสือ', 'แม่นาค', 'ผีหิว'] as const).map((name, i): DevKey => ({
      key: ['q', 'w', 'e', 't', 'y'][i] as string,
      label: `เสก${name} (โทรศัพท์ดังแล้วผีตัวนี้มา)`,
      run: (t) => (t.game.callGhostNow(i) ? `เสก ${name}` : 'มีผีอยู่แล้ว หรือคิวเต็ม'),
    })),
    { key: 'z', label: 'ผีบีบทันที (ดูฉากโดนบีบ)', run: (t) => (t.game.squeezeNow() ? 'ผีบีบ!' : 'ยังไม่มีผีกำลังถูกเสิร์ฟ') },
    { key: 'c', label: 'ทำขนมให้เสร็จทันที', run: (t) => (t.game.finishCookingNow() ? 'เสร็จทันที' : 'ยังไม่ได้ทำขนม') },
    { key: 'b', label: 'สลับพื้นหลัง กลางวัน/ฝน/กลางคืน', run: (t) => `พื้นหลัง: ${t.cycleBackground()}` },
    { key: 'v', label: 'ทดสอบเสียงพูด (ผู้หญิง ผู้ชาย ผี)', run: (t) => {
      t.speak('เอา… ข้าวต้มมัด… ค่ะ', 1.35, 'female');
      setTimeout(() => t.speak('เอา… ข้าวต้มมัด… ครับ', 0.85, 'male'), 2600);
      setTimeout(() => t.speak('ฮือ ๆ… ช่วยด้วย… ผีอยากกินขนม…', 1.9, 'female'), 5400);
      return 'ทดสอบเสียงพูด 3 แบบ';
    } },
    { key: 'j', label: 'เสียงรางวัล', run: (t) => (t.playSound('reward'), 'เสียงรางวัล') },
    { key: 'g', label: 'เสียงผี', run: (t) => (t.playSound('ghost'), 'เสียงผี') },
    { key: 'm', label: 'ปิด/เปิดเสียง', run: (() => { let muted = false; return (t: DevKeyTargets) => { muted = !muted; t.setMuted(muted); return muted ? 'ปิดเสียง' : 'เปิดเสียง'; }; })() },
  ];
}

/** Installs the keyboard handler and a small help panel (toggle with ? or h). Returns an uninstall function. */
export function installDevKeys(t: DevKeyTargets, doc: Document = document): () => void {
  const keys = devKeys();
  const panel = doc.createElement('div');
  panel.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:min(92vw,380px);max-height:70vh;overflow:auto;background:rgba(20,12,8,.86);color:#ffe9c8;font:12px/1.5 system-ui,sans-serif;padding:8px 10px;border-radius:10px;z-index:9;display:none';
  panel.innerHTML = '<b>คีย์ลัดทดสอบ</b> (กด ? หรือ h ซ่อน/แสดง)<br>' + keys.map((k) => `<kbd style="background:#4a2c17;border-radius:4px;padding:0 5px">${k.key.toUpperCase()}</kbd> ${k.label}`).join('<br>');
  const toast = doc.createElement('div');
  toast.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);background:rgba(20,12,8,.9);color:#fff;font:600 14px system-ui,sans-serif;padding:6px 14px;border-radius:16px;z-index:10;opacity:0;transition:opacity .2s;pointer-events:none';
  const hint = doc.createElement('div');
  hint.textContent = 'กด ? ดูคีย์ลัดทดสอบ';
  hint.style.cssText = 'position:fixed;left:8px;bottom:8px;color:#ffe9c8;background:rgba(20,12,8,.6);font:12px system-ui,sans-serif;padding:3px 8px;border-radius:8px;z-index:9';
  doc.body.append(panel, toast, hint);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (m: string): void => {
    toast.textContent = m;
    toast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.style.opacity = '0'), 1400);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === '?' || k === 'h' || k === '/') {
      const open = panel.style.display === 'none';
      panel.style.display = open ? 'block' : 'none';
      hint.style.display = open ? 'none' : 'block';
      return;
    }
    const def = keys.find((d) => d.key === k);
    if (!def) return;
    try {
      const msg = def.run(t);
      if (msg) say(msg);
    } catch (err) {
      say('ผิดพลาด: ' + String(err));
    }
  };
  doc.addEventListener('keydown', onKey);
  return () => {
    doc.removeEventListener('keydown', onKey);
    panel.remove();
    toast.remove();
    hint.remove();
  };
}
