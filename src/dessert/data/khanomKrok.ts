import type { DessertDef } from '../types';

export const khanomKrok: DessertDef = {
  id: "khanom-krok",
  nameTh: "ขนมครก",
  nameEn: "Khanom Krok",
  unlock: { default: true },
  ingredients: [
    { id: "rice-flour", nameTh: "แป้งข้าวเจ้า", color: "#f5f0e1" },
    { id: "coconut-milk", nameTh: "กะทิ", color: "#fdf5e6" },
    { id: "spring-onion", nameTh: "ต้นหอมซอย", color: "#93c47d" },
    { id: "corn", nameTh: "ข้าวโพด", color: "#f1c232" },
  ],
  steps: [
    { id: "mix", nameTh: "คนแป้งกับกะทิ", anim: "stir", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "pour", nameTh: "เทลงเบ้าพิมพ์ร้อน", anim: "pour", sound: "sizzle", weight: 3, maxMs: 16000 },
    { id: "cook", nameTh: "ปิดฝาย่างให้สุก", anim: "fry", sound: "sizzle", weight: 3, maxMs: 16000 },
    { id: "pair", nameTh: "ประกบสองฝั่ง", anim: "shape", sound: "pop", weight: 2, maxMs: 12000 },
    { id: "arrange", nameTh: "จัดใส่ถาด", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "tray", layout: "grid" },
  palette: ["#fdf5e6", "#f1c232", "#93c47d"],
  reward: { baseScore: 140, baseCoins: 14, xp: 9 },
};
