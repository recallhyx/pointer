import { useEffect, useEffectEvent, useId, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ContentSwap, Crossfade, Reveal } from "@/components/motion";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DEFAULT_OCR_SHORTCUT, OCR_LANGUAGES, type OcrLanguage, type Settings } from "@/shared/settings";
import { isTauri } from "@/shared/runtime";
import { Field, Toggle, type Update } from "./controls";
import {
  ocrOpenScreenSettings,
  ocrRequestScreenPermission,
  ocrScreenPermission,
  pauseTriggerShortcut,
  setOcrShortcut,
} from "./native";
import { formatShortcut, recordKey } from "./shortcut";

export function ScreenTextPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const refresh = useEffectEvent(() => {
    void ocrScreenPermission()
      .then(setAllowed)
      .catch(() => setAllowed(false));
  });

  useEffect(() => {
    refresh();
  }, []);

  const request = async () => {
    const ok = await ocrRequestScreenPermission().catch(() => false);
    setAllowed(ok);
    if (!ok) await ocrOpenScreenSettings().catch(() => {});
  };

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-base font-semibold">{t("ocr.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("ocr.intro")}</p>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("ocr.permission")}</div>
          <div className="text-xs text-muted-foreground">
            {allowed === null ? t("ocr.permissionUnknown") : allowed ? t("ocr.permissionOn") : t("ocr.permissionOff")}
          </div>
        </div>
        {allowed === false && (
          <Button type="button" variant="outline" size="sm" onClick={() => void request()}>
            {t("ocr.permissionOpen")}
          </Button>
        )}
      </div>

      <Toggle
        checked={settings.ocrAutoFallback}
        onChange={(v) => update((s) => ({ ...s, ocrAutoFallback: v }))}
        label={t("ocr.autoFallback")}
        hint={t("ocr.autoFallbackHint")}
      />

      <OcrShortcutField
        value={settings.ocrShortcut}
        onSaved={(ocrShortcut) => update((s) => ({ ...s, ocrShortcut }))}
      />

      <Field label={t("ocr.language")} hint={t("ocr.languageHint")}>
        {(id) => (
          <Select
            value={settings.ocrLanguage}
            onValueChange={(v) => update((s) => ({ ...s, ocrLanguage: v as OcrLanguage }))}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OCR_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`ocr.language.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
    </div>
  );
}

function OcrShortcutField({ value, onSaved }: { value: string | null; onSaved: (accelerator: string | null) => void }) {
  const t = useT();
  const inputId = useId();
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (accelerator: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await setOcrShortcut(accelerator);
      onSaved(accelerator);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setError(null);
    setPending("");
    setRecording(true);
  };

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setError(null);
      setRecording(false);
      return;
    }
    const r = recordKey(e);
    if (r.kind === "pending") {
      setPending(r.label);
    } else if (r.kind === "invalid") {
      setPending("");
      setError(r.reason);
    } else {
      setRecording(false);
      void save(r.accelerator);
    }
  });

  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) setPending("");
  });

  useEffect(() => {
    if (!recording) return;
    void pauseTriggerShortcut(true);
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const up = (e: KeyboardEvent) => onKeyUp(e);
    const cancel = () => setRecording(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", cancel);
      void pauseTriggerShortcut(false);
    };
  }, [recording]);

  const label = recording ? pending || t("trigger.press") : value ? formatShortcut(value) : t("trigger.unset");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{t("ocr.shortcut")}</Label>
      <div className="flex items-center">
        <button
          id={inputId}
          type="button"
          disabled={busy || !isTauri()}
          onClick={recording ? () => setRecording(false) : start}
          className={cn(
            "flex h-9 min-w-40 items-center justify-center rounded-md border px-3 font-mono text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
            "transition-[border-color,color,background-color] duration-200",
            recording ? "shortcut-recording border-primary text-primary" : "bg-background hover:bg-accent",
            !recording && !value && "text-muted-foreground",
          )}
        >
          <ContentSwap swapKey={label}>{label}</ContentSwap>
        </button>
        <Reveal axis="x" show={!recording}>
          <Button variant="outline" disabled={busy} onClick={start} className="ml-2">
            {t("trigger.change")}
          </Button>
          <Reveal axis="x" show={value !== DEFAULT_OCR_SHORTCUT}>
            <Button variant="ghost" disabled={busy} onClick={() => void save(DEFAULT_OCR_SHORTCUT)} className="ml-2">
              {t("trigger.reset")}
            </Button>
          </Reveal>
          <Reveal axis="x" show={!!value}>
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)} className="ml-2">
              {t("trigger.off")}
            </Button>
          </Reveal>
        </Reveal>
      </div>
      <div className={cn("text-xs transition-colors", error ? "text-destructive" : "text-muted-foreground")}>
        <Crossfade swapKey={error ?? (recording ? "rec" : "hint")}>
          {error ?? (recording ? t("trigger.recordHint") : t("ocr.shortcutHint"))}
        </Crossfade>
      </div>
    </div>
  );
}
