import type { DessertDef } from '../types';

/** The café's everyday dessert: what customers order when nobody has sent a gift. */
export const khaoTomMat: DessertDef = {
  id: 'khao-tom-mat',
  nameTh: 'ข้าวต้มมัด',
  nameEn: 'Khao Tom Mat',
  unlock: { default: true },
  ingredients: [
    { id: 'glutinous-rice', nameTh: 'ข้าวเหนียว', color: '#fffaf0' },
    { id: 'coconut-milk', nameTh: 'กะทิ', color: '#fdf5e6' },
    { id: 'banana', nameTh: 'กล้วยน้ำว้า', color: '#f1c232' },
    { id: 'black-bean', nameTh: 'ถั่วดำ', color: '#3b3b3b' },
    { id: 'banana-leaf', nameTh: 'ใบตอง', color: '#6aa84f' },
  ],
  steps: [
    { id: 'mix', nameTh: 'ผสมข้าวเหนียวกับกะทิ', anim: 'knead', sound: 'stir', weight: 2, maxMs: 12000 },
    { id: 'fill', nameTh: 'ใส่ไส้กล้วยกับถั่วดำ', anim: 'shape', sound: 'pop', weight: 2, maxMs: 12000 },
    { id: 'wrap', nameTh: 'ห่อด้วยใบตอง', anim: 'shape', sound: 'arrange', weight: 3, maxMs: 16000 },
    { id: 'steam', nameTh: 'นึ่งให้สุก', anim: 'steam', sound: 'steam', weight: 3, maxMs: 16000 },
    { id: 'arrange', nameTh: 'จัดใส่ถาด', anim: 'arrange', sound: 'arrange', weight: 1, maxMs: 10000 },
  ],
  presentation: { container: 'tray', layout: 'pile' },
  palette: ['#fffaf0', '#f1c232', '#6aa84f'],
  reward: { baseScore: 100, baseCoins: 10, xp: 7 },
};
