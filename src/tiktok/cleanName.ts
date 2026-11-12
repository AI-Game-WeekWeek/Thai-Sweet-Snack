/**
 * Makes a viewer-supplied display name safe to draw: strips control, bidi and zero-width characters,
 * collapses whitespace and cuts to `max` characters (code points). Returns '' when nothing is left.
 */
export function cleanName(raw: string, max: number): string {
  const stripped = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(stripped).slice(0, Math.max(0, max)).join('');
}
