import { useEffect, useRef, useState } from "react";

// Hook useState que espelha o valor em localStorage sob `key`.
// Troca de key remonta o estado a partir do novo slot (usado para scoping por user).
export function useLocalStorageState<T>(
  key: string,
  initial: T
): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const read = (k: string): T => {
    try {
      const raw = localStorage.getItem(k);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  };

  const [value, setValue] = useState<T>(() => read(key));
  const keyRef = useRef(key);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(read(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota ou modo privado — ignora */
    }
  }, [key, value]);

  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignora */
    }
    setValue(initial);
  };

  return [value, setValue, clear];
}
