import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, X } from "lucide-react";
import type { CredentialField as CredentialFieldConfig } from "../../../setup.config";

type Props = {
  field: CredentialFieldConfig;
  initialHasValue: boolean;
  onChange: (key: string, value: string | null) => void;
  onValidationChange?: (key: string, isValid: boolean) => void;
};

type ValidationState = "idle" | "checking" | "valid" | "invalid";

export function CredentialField({
  field,
  initialHasValue,
  onChange,
  onValidationChange,
}: Props) {
  const [editing, setEditing] = useState(!initialHasValue);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [validation, setValidation] = useState<ValidationState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const isPassword = field.inputType === "password";

  useEffect(() => {
    setEditing(!initialHasValue);
    setValue("");
    setValidation("idle");
    setMessage(null);
  }, [initialHasValue]);

  useEffect(() => {
    if (!editing || !value.trim()) {
      setValidation("idle");
      // B-14: limpa a mensagem de erro antiga ao esvaziar o input — sem isso
      // o usuário vê o erro anterior em cinza pairando sobre um campo vazio.
      setMessage(null);
      onValidationChange?.(field.key, initialHasValue && !editing);
      return;
    }
    setValidation("checking");
    const timer = window.setTimeout(() => {
      void field.validate(value).then((result) => {
        setValidation(result.ok ? "valid" : "invalid");
        setMessage(result.message ?? null);
        onValidationChange?.(field.key, result.ok);
      }).catch((err: unknown) => {
        setValidation("invalid");
        setMessage(err instanceof Error ? err.message : "Falha ao validar");
        onValidationChange?.(field.key, false);
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [editing, field, initialHasValue, onValidationChange, value]);

  const inputType = useMemo(() => {
    if (!isPassword) return "text";
    return show ? "text" : "password";
  }, [isPassword, show]);

  function cancelEdit() {
    setEditing(false);
    setValue("");
    setValidation("idle");
    setMessage(null);
    onChange(field.key, null);
    onValidationChange?.(field.key, true);
  }

  return (
    <div className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[#CBD5E1]">
            {field.label}
          </label>
          {field.helpText && (
            <p className="text-[13px] leading-5 text-[#94A3B8]">{field.helpText}</p>
          )}
        </div>
        {field.docsUrl && (
          <a
            href={field.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-sm text-[#60A5FA] transition-colors hover:text-[#85B7EB]"
          >
            onde gerar
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {initialHasValue && !editing ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-h-11 flex-1 items-center rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 font-mono text-sm text-[#F8FAFC]">
            ••••••••
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 rounded-lg bg-[rgba(30,58,138,0.4)] px-4 text-sm font-medium text-[#F8FAFC] transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]"
          >
            Alterar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <input
              type={inputType}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                onChange(field.key, event.target.value || null);
              }}
              placeholder={field.placeholder}
              className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-[rgba(255,255,255,0.03)] px-4 py-3 pr-20 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {validation === "valid" && <Check className="h-4 w-4 text-[#10B981]" />}
              {validation === "invalid" && <X className="h-4 w-4 text-[#EF4444]" />}
              {isPassword && (
                <button
                  type="button"
                  onClick={() => setShow((current) => !current)}
                  className="text-[#94A3B8] transition-colors hover:text-[#F8FAFC]"
                  aria-label={show ? "Ocultar" : "Mostrar"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
          <div className="flex min-h-5 items-center justify-between gap-3 text-xs">
            <span
              className={
                validation === "valid"
                  ? "text-[#10B981]"
                  : validation === "invalid"
                    ? "text-[#EF4444]"
                    : "text-[#94A3B8]"
              }
            >
              {validation === "checking" ? "Validando..." : message}
            </span>
            {initialHasValue && (
              <button
                type="button"
                onClick={cancelEdit}
                className="text-[#94A3B8] transition-colors hover:text-[#F8FAFC]"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
