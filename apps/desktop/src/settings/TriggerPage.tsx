import { useEffect, useEffectEvent, useId, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ContentSwap, Crossfade, Reveal } from "@/components/motion";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { DEFAULT_SHORTCUT, EXPAND_MODES, type ExpandMode, type Settings } from "@/shared/settings";
import { Toggle, type Update } from "./controls";
import { pauseTriggerShortcut, setTriggerShortcut } from "./native";
import { formatShortcut, recordKey } from "./shortcut";

export function TriggerPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-base font-semibold">{t("trigger.title")}</h2>
      {/* Nest expand modes under auto-trigger so Reveal's margin:0 does not collapse space-y
          against the clipboard toggle (CONTEXT.md 展开方式). */}
      <div>
        <Toggle
          checked={settings.autoTrigger}
          onChange={(v) => update((s) => ({ ...s, autoTrigger: v }))}
          label={t("trigger.auto")}
          hint={t("trigger.autoHint")}
        />
        <Reveal show={settings.autoTrigger} before={20} after={4}>
          <ExpandModeField
            value={settings.expandMode}
            onChange={(expandMode) => update((s) => ({ ...s, expandMode }))}
          />
        </Reveal>
      </div>
      <Toggle
        checked={settings.clipboardFallback}
        onChange={(v) => update((s) => ({ ...s, clipboardFallback: v }))}
        label={t("trigger.clipboard")}
        hint={t("trigger.clipboardHint")}
      />
      <ShortcutField value={settings.shortcut} onSaved={(shortcut) => update((s) => ({ ...s, shortcut }))} />
      <Reveal show={!settings.autoTrigger && !settings.shortcut}>
        <p className="text-xs text-destructive">{t("trigger.nothingOn")}</p>
      </Reveal>
    </div>
  );
}

function ExpandModeField({ value, onChange }: { value: ExpandMode; onChange: (m: ExpandMode) => void }) {
  const t = useT();
  return (
    <RadioGroup
      label={t("trigger.expand")}
      description={t("trigger.expandHint")}
      value={value}
      onValueChange={onChange}
      options={EXPAND_MODES.map((mode) => ({
        value: mode,
        label: t(`trigger.expand.${mode}`),
        description: t(`trigger.expand.${mode}Hint`),
      }))}
    />
  );
}

function ShortcutField({ value, onSaved }: { value: string | null; onSaved: (accelerator: string | null) => void }) {
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
      await setTriggerShortcut(accelerator);
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
      <Label htmlFor={inputId}>{t("trigger.shortcut")}</Label>
      <div className="flex items-center">
        <button
          id={inputId}
          type="button"
          disabled={busy}
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
          <Reveal axis="x" show={value !== DEFAULT_SHORTCUT}>
            <Button variant="ghost" disabled={busy} onClick={() => void save(DEFAULT_SHORTCUT)} className="ml-2">
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
          {error ?? (recording ? t("trigger.recordHint") : t("trigger.shortcutHint"))}
        </Crossfade>
      </div>
    </div>
  );
}
