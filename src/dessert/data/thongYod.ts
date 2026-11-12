import type { DessertDef } from '../types';

export const thongYod: DessertDef = {
  id: "thong-yod",
  nameTh: "ทองหยอด",
  nameEn: "Thong Yod",
  unlock: { default: true },
  ingredients: [
    { id: "duck-egg-yolk", nameTh: "ไข่แดงเป็ด", color: "#f1c232" },
    { id: "rice-flour", nameTh: "แป้งข้าวเจ้า", color: "#f5f0e1" },
    { id: "sugar", nameTh: "น้ำตาลทราย", color: "#ffffff" },
  ],
  art: "syrupBall",
  steps: [
    { id: "knead", nameTh: "นวดไข่แดงกับแป้ง", anim: "knead", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "syrup", nameTh: "เคี่ยวน้ำเชื่อม", anim: "boil", sound: "boil", weight: 2, maxMs: 14000 },
    { id: "drop", nameTh: "หยอดลูกกลมลงน้ำเชื่อม", anim: "pour", sound: "syrup", weight: 4, maxMs: 18000 },
    { id: "scoop", nameTh: "ตักขึ้นสะเด็ดน้ำเชื่อม", anim: "drizzle", sound: "syrup", weight: 1, maxMs: 10000 },
    { id: "cup", nameTh: "ใส่ถ้วยกระดาษ", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "box", layout: "grid" },
  palette: ["#f1c232", "#f6b26b"],
  reward: { baseScore: 130, baseCoins: 13, xp: 9 },
};
