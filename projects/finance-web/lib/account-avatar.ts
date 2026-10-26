const colors = ["teal", "blue", "violet", "rose", "amber", "green"] as const;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function accountAvatar(name: string, id = name) {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  const trimmed = name.trim();
  const initial = (segmenter?.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? Array.from(trimmed)[0] ?? "?").toUpperCase();
  return { initial: initial || "?", color: colors[hash % colors.length] };
}

export function isAccountLogo(value?: string): value is string {
  return Boolean(value && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value));
}
