import type { DessertDef } from '../types';

export const thongYip: DessertDef = {
  id: "thong-yip",
  nameTh: "ทองหยิบ",
  nameEn: "Thong Yip",
  unlock: { cost: 250 },
  ingredients: [
    { id: "duck-egg-yolk", nameTh: "ไข่แดงเป็ด", color: "#f1c232" },
    { id: "sugar", nameTh: "น้ำตาลทราย", color: "#ffffff" },
    { id: "jasmine-water", nameTh: "น้ำลอยดอกมะลิ", color: "#fff2cc" },
  ],
  steps: [
    { id: "whisk", nameTh: "ตีไข่แดงให้ขึ้นฟู", anim: "stir", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "syrup", nameTh: "เคี่ยวน้ำเชื่อม", anim: "boil", sound: "boil", weight: 2, maxMs: 14000 },
    { id: "drop", nameTh: "หยอดไข่ลงน้ำเชื่อม", anim: "pour", sound: "syrup", weight: 3, maxMs: 16000 },
    { id: "pinch", nameTh: "จับจีบให้เป็นดอก", anim: "shape", sound: "pop", weight: 3, maxMs: 16000 },
    { id: "arrange", nameTh: "จัดใส่ถ้วยกระดาษ", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "tray", layout: "grid" },
  palette: ["#f1c232", "#e69138"],
  reward: { baseScore: 200, baseCoins: 20, xp: 14 },
};
