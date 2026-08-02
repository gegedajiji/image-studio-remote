import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { zh, type Dict } from "./zh";
import { en } from "./en";

export type Lang = "zh" | "en";

const DICTS: Record<Lang, Dict> = { zh, en };
const STORAGE_KEY = "mirage-lang";

type LangContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** 按点路径取词，如 t("nav.home") */
  t: (path: string) => string;
};

const LangContext = createContext<LangContextValue>({
  lang: "zh",
  setLang: () => {},
  t: (p) => p,
});

function lookup(dict: Dict, path: string): string {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      // 回退中文
      let fb: unknown = zh;
      for (const p2 of path.split(".")) {
        fb = fb && typeof fb === "object" ? (fb as Record<string, unknown>)[p2] : undefined;
      }
      return typeof fb === "string" ? fb : path;
    }
  }
  return typeof cur === "string" ? cur : path;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" ? "en" : "zh";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const t = useCallback((path: string) => lookup(DICTS[lang], path), [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>
  );
}

export function useI18n() {
  return useContext(LangContext);
}
