import type { DessertDef } from '../types';

export const khanomBuang: DessertDef = {
  id: "khanom-buang",
  nameTh: "ขนมเบื้อง",
  nameEn: "Khanom Buang",
  unlock: { cost: 300 },
  ingredients: [
    { id: "rice-flour", nameTh: "แป้งข้าวเจ้า", color: "#f5f0e1" },
    { id: "meringue", nameTh: "ครีมไข่ขาว", color: "#ffffff" },
    { id: "foi-thong", nameTh: "ฝอยทอง", color: "#f1c232" },
    { id: "coconut", nameTh: "มะพร้าวขูด", color: "#fffaf0" },
  ],
  steps: [
    { id: "whip", nameTh: "ตีไข่ขาวทำครีม", anim: "stir", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "spread", nameTh: "ละเลงแป้งบนกระทะ", anim: "spread", sound: "sizzle", weight: 3, maxMs: 16000 },
    { id: "fill", nameTh: "ใส่ครีมและฝอยทอง", anim: "drizzle", sound: "syrup", weight: 2, maxMs: 12000 },
    { id: "fold", nameTh: "พับครึ่งแผ่น", anim: "shape", sound: "pop", weight: 2, maxMs: 12000 },
    { id: "arrange", nameTh: "จัดใส่ถาด", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "tray", layout: "grid" },
  palette: ["#f5f0e1", "#ffffff", "#f1c232"],
  reward: { baseScore: 220, baseCoins: 22, xp: 15 },
};
