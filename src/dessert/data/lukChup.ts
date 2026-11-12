import type { DessertDef } from '../types';

export const lukChup: DessertDef = {
  id: "luk-chup",
  nameTh: "ลูกชุบ",
  nameEn: "Luk Chup",
  unlock: { cost: 150 },
  ingredients: [
    { id: "mung-bean", nameTh: "ถั่วเขียวกวน", color: "#d9c27a" },
    { id: "coconut-milk", nameTh: "กะทิ", color: "#fdf5e6" },
    { id: "agar", nameTh: "วุ้นเคลือบ", color: "#e6f2ff" },
    { id: "food-color", nameTh: "สีผสมอาหาร", color: "#e06666" },
  ],
  steps: [
    { id: "knead", nameTh: "นวดถั่วเขียวกวน", anim: "knead", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "shape", nameTh: "ปั้นเป็นรูปผลไม้", anim: "shape", sound: "pop", weight: 3, maxMs: 16000 },
    { id: "paint", nameTh: "แต้มสีให้สวย", anim: "drizzle", sound: "syrup", weight: 2, maxMs: 12000 },
    { id: "glaze", nameTh: "จุ่มวุ้นเคลือบเงา", anim: "drizzle", sound: "syrup", weight: 2, maxMs: 12000 },
    { id: "arrange", nameTh: "จัดใส่กล่อง", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "box", layout: "grid" },
  palette: ["#e06666", "#f6b26b", "#93c47d", "#6fa8dc"],
  reward: { baseScore: 160, baseCoins: 16, xp: 10 },
};
