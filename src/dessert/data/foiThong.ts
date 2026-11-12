import type { DessertDef } from '../types';

export const foiThong: DessertDef = {
  id: "foi-thong",
  nameTh: "ฝอยทอง",
  nameEn: "Foi Thong",
  unlock: { cost: 200 },
  ingredients: [
    { id: "duck-egg-yolk", nameTh: "ไข่แดงเป็ด", color: "#f1c232" },
    { id: "sugar", nameTh: "น้ำตาลทราย", color: "#ffffff" },
    { id: "jasmine-water", nameTh: "น้ำลอยดอกมะลิ", color: "#fff2cc" },
  ],
  steps: [
    { id: "syrup", nameTh: "เคี่ยวน้ำเชื่อมให้เดือด", anim: "boil", sound: "boil", weight: 2, maxMs: 14000 },
    { id: "drizzle", nameTh: "โรยไข่แดงเป็นสายบางลงหม้อ", anim: "drizzle", sound: "syrup", weight: 4, maxMs: 18000 },
    { id: "lift", nameTh: "ตักพับเป็นแพ", anim: "shape", sound: "pop", weight: 2, maxMs: 12000 },
    { id: "arrange", nameTh: "จัดใส่ถาด", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "tray", layout: "pile" },
  palette: ["#f1c232", "#ffd966"],
  reward: { baseScore: 180, baseCoins: 18, xp: 12 },
};
