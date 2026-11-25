import translationsJson from "./translations.json";

export type Language = "en" | "ar";

const translations: Record<Language, Record<string, string>> = translationsJson;

let currentLang: Language = "en";

export function setLang(lang: Language): void {
  currentLang = lang;
}

export function getLang(): Language {
  return currentLang;
}

export function toggleLang(): Language {
  currentLang = currentLang === "en" ? "ar" : "en";
  return currentLang;
}

export function t(key: string): string {
  return translations[currentLang]?.[key] ?? translations.en[key] ?? key;
}
