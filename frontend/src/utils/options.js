export function parseOptions(value = '') {
  const seen = new Set();
  return String(value)
    .split(/[,;|\n]+/)
    .map((option) => option.trim())
    .filter((option) => {
      const key = option.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
