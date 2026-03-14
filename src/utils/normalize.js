export function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTeamName(value = "") {
  let v = normalizeText(value);
  const replacements = [
    [/^m\s*gladbach$/, "borussia monchengladbach"],
    [/^b\.?\s*monchengladbach$/, "borussia monchengladbach"],
    [/newcastle utd\.?/, "newcastle united"],
    [/st\.?\s*pauli/, "saint pauli"],
    [/fc spisska n.? ves/, "spisska nova ves"],
    [/spisska\s+n.?\s+ves/, "spisska nova ves"],
    [/hc sparta praha/, "sparta praha"],
    [/rybakina e\.?/, "rybakina"],
    [/svitolina e\.?/, "svitolina"],
    [/\bas rim\b/, "as roma"],
    [/\baryna sabalenka\b/, "sabalenka"],
    [/\belena rybakina\b/, "rybakina"]
  ];
  for (const [pattern, replacement] of replacements) {
    v = v.replace(pattern, replacement);
  }
  return v;
}

/** Valid odds range 1.01–50.0. Rejects time-like and (by default) date-like values. */
export function parseOdd(text = "", options = {}) {
  const { rejectDateLike = true, rejectTimeLike = true } = options;
  if (text == null || typeof text !== "string") return null;
  const match = text.match(/(?<!\d)(\d{1,2}[.,]\d{1,2})(?!\d)/);
  if (!match) return null;
  const num = Number(match[1].replace(",", "."));
  if (num < 1.01 || num > 50.0) return null;
  const intPart = Math.floor(num);
  const fracPart = Math.round((num - intPart) * 100);
  const looksLikeTime = fracPart === 0 || fracPart === 15 || fracPart === 30 || fracPart === 45;
  if (rejectTimeLike && intPart >= 13 && intPart <= 23 && looksLikeTime) return null;
  if (rejectDateLike && intPart >= 13 && intPart <= 31 && fracPart >= 1 && fracPart <= 12) return null;
  return num;
}

export function slugifyMarket(value = "") {
  return normalizeText(value).replace(/\s+/g, "_");
}
