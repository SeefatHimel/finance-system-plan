/** A picker changes only the explicitly selected precision; never drops saved seconds. */
export function clockTimeValue(hour: string, minute: string, second?: string): string | null {
  const values = [hour, minute, ...(second === undefined ? [] : [second])];
  if (values.some((value, index) => !/^\d{1,2}$/.test(value) || Number(value) > (index === 0 ? 23 : 59))) return null;
  return values.map(value => value.padStart(2, '0')).join(':');
}
