/**
 * The filler customers ("bots") are not anonymous faces: each walks in with a funny animal profile picture and a cheeky name,
 * like a viewer who showed up. Display only: a bot stays an anonymous filler customer for every rule of the line.
 */
export interface BotPersona {
  /** The cheeky name shown under the customer. */
  name: string;
  /** The picture (public/art/<pic>.webp, a round crop of the profile picture). */
  pic: string;
}

/** bot-1 bunny "I KNOW!", bot-2 cat in a hoodie, bot-3 bunny nose, bot-4 hamster, bot-5 guinea pig, bot-6 guinea pig on pink. */
export const BOT_PICS = ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5', 'bot-6'] as const;

const NAMES: readonly (readonly string[])[] = [
  ['รู้นะว่าหิว', 'ไอโนว์ๆๆ', 'กระต่ายรู้ทัน', 'รู้แล้วน่า', 'อย่ามาหลอก'],
  ['แมวฮู้ดสายโหด', 'ป๋าแมวฮู้ด', 'เมี้ยวขอกิน', 'แมวแอบจ้อง', 'ติดไว้ก่อนนะ'],
  ['จมูกชมพูเบียด', 'ใกล้ไปแล้วนะ', 'ขอหน่อยนะ', 'มองอะไรเนี่ย', 'ซูมเข้ามาอีก'],
  ['แฮมเตอร์จิ๋ว', 'ก้อนแป้งนุ่ม', 'หนูขาวขอกิน', 'ตัวเล็กหิวมาก', 'อย่าจับนะ'],
  ['ตะเภาอ้าปากรอ', 'หนูอ้วนหิวโซ', 'เคี้ยวไม่หยุด', 'พี่จมูกชมพู', 'รอนานแล้วนะ'],
  ['ตะเภาสีพีช', 'น้องพีชหิวจัง', 'พิงค์พิกกี้', 'ตาโตหิวโต', 'เสิร์ฟไวๆนะ'],
];

export const BOT_PERSONAS: readonly BotPersona[] = NAMES.flatMap((names, i) => names.map((name) => ({ name, pic: BOT_PICS[i] as string })));

/**
 * A persona for a new filler customer: not one of `taken` (names already in the café), and a picture nobody in the café has if
 * there is one left, so the line looks varied. `rng` gives 0..1. Never fails: with everything taken any persona is used.
 */
export function pickBotPersona(rng: () => number, taken: ReadonlySet<string> = new Set()): BotPersona {
  const r = (): number => {
    const v = rng();
    return Number.isFinite(v) ? Math.min(0.999999, Math.max(0, v)) : 0;
  };
  const takenPics = new Set(BOT_PERSONAS.filter((p) => taken.has(p.name)).map((p) => p.pic));
  const free = BOT_PERSONAS.filter((p) => !taken.has(p.name));
  const fresh = free.filter((p) => !takenPics.has(p.pic));
  const pool = fresh.length > 0 ? fresh : free.length > 0 ? free : BOT_PERSONAS;
  return pool[Math.floor(r() * pool.length)] as BotPersona;
}
