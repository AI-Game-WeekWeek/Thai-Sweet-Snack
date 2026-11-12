import type { DessertDef } from '../dessert/types';

/** One optional recorded voice line: if public/voice/<file> exists the game plays it, otherwise the device voice speaks `text`. */
export interface VoiceFile {
  key: string;
  file: string;
  text: string;
  who: string;
}

/** Every recorded line the game can use (20 for 8 desserts). Names are fixed: the game looks for exactly these files. */
export function voiceFiles(desserts: readonly Pick<DessertDef, 'id' | 'nameTh'>[]): VoiceFile[] {
  const out: VoiceFile[] = [];
  for (const d of desserts) {
    out.push({ key: `voice-order-${d.id}-f`, file: `order-${d.id}-f.mp3`, text: `เอา… ${d.nameTh}… ค่ะ`, who: 'ลูกค้าผู้หญิง สั่งขนม' });
    out.push({ key: `voice-order-${d.id}-m`, file: `order-${d.id}-m.mp3`, text: `เอา… ${d.nameTh}… ครับ`, who: 'ลูกค้าผู้ชาย สั่งขนม' });
  }
  out.push({ key: 'voice-done', file: 'done.mp3', text: 'เสร็จแล้วค่ะ', who: 'พนักงานร้าน (ผู้หญิง) ตอนขนมเสร็จ' });
  out.push({ key: 'voice-ghost-call', file: 'ghost-call.mp3', text: 'ฮือ ๆ… ช่วยด้วย… ผีอยากกินขนม…', who: 'ผี ตอนรับสาย (เสียงสูงแหลม)' });
  out.push({ key: 'voice-ghost-order', file: 'ghost-order.mp3', text: 'ขอ… ขนม… หน่อย… จ้ะ', who: 'ผี ตอนมาสั่ง (เสียงสูงแหลม)' });
  out.push({ key: 'voice-shaman', file: 'shaman.mp3', text: 'ผีได๋ คือสิมาแข็งข้อกับกู๋', who: 'หมอผี (ผู้ชาย สำเนียงอีสาน)' });
  return out;
}
