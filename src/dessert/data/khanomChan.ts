import type { DessertDef } from '../types';

export const khanomChan: DessertDef = {
  id: "khanom-chan",
  nameTh: "ขนมชั้น",
  nameEn: "Khanom Chan",
  unlock: { default: true },
  ingredients: [
    { id: "rice-flour", nameTh: "แป้งข้าวเจ้า", color: "#f5f0e1" },
    { id: "tapioca", nameTh: "แป้งมัน", color: "#fffaf0" },
    { id: "coconut-milk", nameTh: "กะทิ", color: "#fdf5e6" },
    { id: "pandan", nameTh: "น้ำใบเตย", color: "#6aa84f" },
  ],
  art: "layered",
  steps: [
    { id: "mix", nameTh: "ผสมแป้งกับกะทิน้ำตาล", anim: "stir", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "color", nameTh: "แบ่งแป้ง ใส่สีใบเตย", anim: "pour", sound: "pour", weight: 2, maxMs: 12000 },
    { id: "layers", nameTh: "เทแป้งทีละชั้น สลับสีขาวเขียว", anim: "pour", sound: "pour", weight: 4, maxMs: 18000 },
    { id: "steam", nameTh: "นึ่งให้สุกทีละชั้น", anim: "steam", sound: "steam", weight: 3, maxMs: 16000 },
    { id: "rest", nameTh: "พักให้เย็น", anim: "arrange", sound: "arrange", weight: 1, maxMs: 8000 },
    { id: "cut", nameTh: "หั่นเป็นชิ้น", anim: "cut", sound: "slice", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "tray", layout: "stack" },
  palette: ["#6aa84f", "#fffaf0", "#f4cccc"],
  reward: { baseScore: 120, baseCoins: 12, xp: 8 },
};
