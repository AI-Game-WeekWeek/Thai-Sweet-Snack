import type { DessertDef } from '../types';
import { validateDessert } from '../validate';
import { khanomChan } from './khanomChan';
import { lukChup } from './lukChup';
import { foiThong } from './foiThong';
import { thongYip } from './thongYip';
import { thongYod } from './thongYod';
import { khanomKrok } from './khanomKrok';
import { buaLoy } from './buaLoy';
import { khanomBuang } from './khanomBuang';

export const ALL_DESSERTS: readonly DessertDef[] = [
  khanomChan,
  lukChup,
  foiThong,
  thongYip,
  thongYod,
  khanomKrok,
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
