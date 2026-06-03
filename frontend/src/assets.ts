export function publicAsset(path: string) {
  const trimmed = path.trim();
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return `${import.meta.env.BASE_URL}${trimmed.replace(/^\/+/, "")}`;
}
