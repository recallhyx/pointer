import { useEffect, useState } from "react";

import { Reveal } from "@/components/motion";
import { LOCALES, useT, type UiLanguage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isValidSearchTemplate, SEARCH_ENGINE_IDS, type SearchEngineId } from "@/shared/search";
import type { Settings, Theme } from "@/shared/settings";
import { Field, Toggle, type Update } from "./controls";
import {
  accessibilityOpenSettings,
  accessibilityPermission,
  accessibilityRequest,
  autostartEnabled,
  setAutostart,
} from "./native";
import { applyTheme } from "./theme";

/** Each language is always listed in its own name, so it can be found whatever the current one is. */
const LOCALE_NAMES = {
  zh: "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
} as const;

export function GeneralPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [axAllowed, setAxAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    void autostartEnabled()
      .then(setAutostartState)
      .catch((e) => setAutostartError(String(e)));
  }, []);

  // Granting accessibility happens outside the app (System Settings), so poll instead of
  // waiting for a one-shot result; this also picks up a revoke without reopening the page.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void accessibilityPermission()
        .then((v) => {
          if (!cancelled) setAxAllowed(v);
        })
        .catch(() => {
          if (!cancelled) setAxAllowed(false);
        });
    };
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const requestAccessibility = async () => {
    const ok = await accessibilityRequest().catch(() => false);
    setAxAllowed(ok);
    if (!ok) await accessibilityOpenSettings().catch(() => {});
  };

  const search = settings.searchEngine;
  const customInvalid = search.customUrl.trim() !== "" && !isValidSearchTemplate(search.customUrl);

  const toggleAutostart = (on: boolean) => {
    setAutostartError(null);
    void setAutostart(on)
      .then(() => setAutostartState(on))
      .catch((e) =>
        setAutostartError(t(on ? "general.autostartOnFailed" : "general.autostartOffFailed", { error: String(e) })),
      );
  };

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-base font-semibold">{t("general.title")}</h2>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("general.accessibility")}</div>
            <div className="text-xs text-muted-foreground">
              {axAllowed === null
                ? t("general.accessibilityUnknown")
                : axAllowed
                  ? t("general.accessibilityOn")
                  : t("general.accessibilityOff")}
            </div>
          </div>
          {axAllowed === false && (
            <Button type="button" variant="outline" size="sm" onClick={() => void requestAccessibility()}>
              {t("general.accessibilityOpen")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("general.accessibilityHint")}</p>
      </div>
      <Field label={t("general.language")} hint={t("general.languageHint")}>
        {(id) => (
          <Select
            value={settings.uiLanguage}
            onValueChange={(v) => update((s) => ({ ...s, uiLanguage: v as UiLanguage }))}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("general.languageSystem")}</SelectItem>
              {LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label={t("general.theme")} hint={t("general.themeHint")}>
        {(id) => (
          <Select
            value={settings.theme}
            onValueChange={(v) => {
              const theme = v as Theme;
              applyTheme(theme);
              update((s) => ({ ...s, theme }));
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("general.themeSystem")}</SelectItem>
              <SelectItem value="light">{t("general.themeLight")}</SelectItem>
              <SelectItem value="dark">{t("general.themeDark")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label={t("general.search")} hint={t("general.searchHint")}>
        {(id) => (
          <Select
            value={search.id}
            onValueChange={(v) =>
              update((s) => ({ ...s, searchEngine: { ...s.searchEngine, id: v as SearchEngineId } }))
            }
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_ENGINE_IDS.map((e) => (
                <SelectItem key={e} value={e}>
                  {t(`general.search.${e}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {/* Wait out the select's pick-hold and popup exit so the two never overlap. */}
      <Reveal show={search.id === "custom"} after={20} delay={0.5}>
        <Field
          label={t("general.search.custom")}
          error={customInvalid}
          hint={customInvalid ? t("general.searchCustomInvalid") : t("general.searchCustomHint")}
        >
          {(id) => (
            <Input
              id={id}
              value={search.customUrl}
              placeholder="https://example.com/search?q=%s"
              spellCheck={false}
              onChange={(e) => {
                const customUrl = e.target.value;
                update((s) => ({ ...s, searchEngine: { ...s.searchEngine, customUrl } }));
              }}
            />
          )}
        </Field>
      </Reveal>
      <Toggle
        checked={autostart === true}
        disabled={autostart === null}
        onChange={toggleAutostart}
        label={t("general.autostart")}
        hint={
          autostartError ? (
            <span className="text-destructive">{autostartError}</span>
          ) : autostart === null ? (
            t("general.autostartUnavailable")
          ) : (
            t("general.autostartHint")
          )
        }
      />
    </div>
  );
}
