import type { DessertDef } from '../types';
import { validateDessert } from '../validate';
import { khanomChan } from './khanomChan';
import { lukChup } from './lukChup';
import { foiThong } from './foiThong';
import { thongYip } from './thongYip';
import { thongYod } from './thongYod';
import { buaLoy } from './buaLoy';
import { khanomBuang } from './khanomBuang';
import { khaoTomMat } from './khaoTomMat';

/** The first menu item is the café's everyday ข้าวต้มมัด (black-bean and banana filling). */
export const ALL_DESSERTS: readonly DessertDef[] = [
  khaoTomMat,
  khanomChan,
  lukChup,
  foiThong,
  thongYip,
  thongYod,
  buaLoy,
  khanomBuang,
];

// Fail fast at load: a broken recipe must never reach the game loop.
const ids = new Set<string>();
for (const d of ALL_DESSERTS) {
  const errors = validateDessert(d);
  if (ids.has(d.id)) errors.push(`duplicate dessert id ${d.id}`);
  ids.add(d.id);
  if (errors.length > 0) throw new Error(`Invalid dessert data: ${errors.join('; ')}`);
}
