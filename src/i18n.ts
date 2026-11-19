import en from './locales/en';
import zh from './locales/zh';
import ja from './locales/ja';
import fr from './locales/fr';
import es from './locales/es';

export type Lang = 'en' | 'zh' | 'ja' | 'fr' | 'es';
export type TranslationKey = keyof typeof en;
export const SUPPORTED_LANGUAGES: { code: Lang; name: string; htmlLang: string }[] = [
  { code: 'en', name: 'English', htmlLang: 'en' },
  { code: 'zh', name: '简体中文', htmlLang: 'zh-CN' },
  { code: 'ja', name: '日本語', htmlLang: 'ja' },
  { code: 'fr', name: 'Français', htmlLang: 'fr' },
  { code: 'es', name: 'Español', htmlLang: 'es' },
];
const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, zh, ja, fr, es };
export const isLanguage = (value: string | null): value is Lang => SUPPORTED_LANGUAGES.some(language => language.code === value);
export function dictionary(lang: Lang): Record<TranslationKey, string> { return dictionaries[lang]; }
export function htmlLanguage(lang: Lang): string { return SUPPORTED_LANGUAGES.find(language => language.code === lang)!.htmlLang; }
export function resolveLanguage(preference: string | null, browserLanguages: readonly string[] = []): Lang {
  if (isLanguage(preference)) return preference;
  for (const value of browserLanguages) {
    const base = value.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}
