import type { DessertDef } from '../types';

export const buaLoy: DessertDef = {
  id: "bua-loy",
  nameTh: "บัวลอย",
  nameEn: "Bua Loy",
  unlock: { default: true },
  ingredients: [
    { id: "glutinous-rice", nameTh: "แป้งข้าวเหนียว", color: "#fffaf0" },
    { id: "taro", nameTh: "เผือก", color: "#b4a7d6" },
    { id: "pumpkin", nameTh: "ฟักทอง", color: "#f6b26b" },
    { id: "coconut-milk", nameTh: "น้ำกะทิ", color: "#fdf5e6" },
  ],
  steps: [
    { id: "knead", nameTh: "นวดแป้งสามสี", anim: "knead", sound: "stir", weight: 2, maxMs: 12000 },
    { id: "roll", nameTh: "ปั้นเป็นเม็ดกลม", anim: "shape", sound: "pop", weight: 3, maxMs: 16000 },
    { id: "boil", nameTh: "ต้มจนลอย", anim: "boil", sound: "boil", weight: 3, maxMs: 16000 },
    { id: "pour", nameTh: "ราดน้ำกะทิ", anim: "pour", sound: "pour", weight: 2, maxMs: 12000 },
    { id: "arrange", nameTh: "จัดใส่ถ้วย", anim: "arrange", sound: "arrange", weight: 1, maxMs: 10000 },
  ],
  presentation: { container: "box", layout: "pile" },
  palette: ["#fffaf0", "#b4a7d6", "#f6b26b"],
  reward: { baseScore: 150, baseCoins: 15, xp: 10 },
};
