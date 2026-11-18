import { ChevronDown } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BanIcon,
  BotIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  DeleteIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  KeyboardIcon,
  PlusIcon,
  RefreshCWIcon,
  ScanTextIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  useIconAnimation,
  ZapIcon,
  type AnimatedIcon,
} from "@/components/animated-icons";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { resolveLocale, setLocale, useT, type MessageKey } from "@/i18n";
import { listModels, testConnection, type ModelTarget } from "@/llm/client";
import { normalizeEndpoint, type ApiKind } from "@/llm/endpoint";
import { defaultSecondLanguage, languageByPrompt, LANGUAGES, nativeLanguage } from "@/llm/language";
import { userLanguage } from "@/llm/prepare";
import { isPresetName, PRESETS, presetById, presetApi, presetName } from "@/llm/presets";
import { cn } from "@/lib/utils";
import { isTauri, providerFetch } from "@/shared/runtime";
import { deleteApiKey, getApiKey, setApiKey } from "@/shared/secrets";
import { loadSettings, newProviderId, saveSettings, type ProviderConfig, type Settings } from "@/shared/settings";
import {
  ActionButton,
  BADGE_POP,
  CollapseItem,
  ContentSwap,
  Crossfade,
  FADE,
  GlidePillGroup,
  GlidePillItem,
  Reveal,
} from "@/components/motion";
import { Field, IconButton, Toggle, type Update } from "./controls";
import { ExcludedAppsPage } from "./ExcludedAppsPage";
import { formatExtraBody, formatHeaders, parseExtraBody, parseHeaders } from "./fields";
import { GeneralPage } from "./GeneralPage";
import { ScreenTextPage } from "./ScreenTextPage";
import { TriggerPage } from "./TriggerPage";
import { appVersion, openLogs } from "./native";
import { applyTheme, subscribeSystemTheme } from "./theme";
import "./settings.css";

type Page = "general" | "models" | "trigger" | "screen" | "exclude" | "context" | "about";

const PAGES: { id: Page; labelKey: MessageKey; icon: AnimatedIcon }[] = [
  { id: "general", labelKey: "page.general", icon: SlidersHorizontalIcon },
  { id: "models", labelKey: "page.models", icon: BotIcon },
  { id: "trigger", labelKey: "page.trigger", icon: KeyboardIcon },
  { id: "screen", labelKey: "page.screen", icon: ScanTextIcon },
  { id: "exclude", labelKey: "page.exclude", icon: BanIcon },
  { id: "context", labelKey: "page.context", icon: FileTextIcon },
  { id: "about", labelKey: "page.about", icon: CircleHelpIcon },
];

const SAVE_DELAY_MS = 300;

function pageFromUrl(): Page {
  try {
    const q = new URLSearchParams(location.search).get("page");
    if (q && PAGES.some((p) => p.id === q)) return q as Page;
    const hash = location.hash.match(/[?&]page=([\w-]+)/);
    if (hash && PAGES.some((p) => p.id === hash[1])) return hash[1] as Page;
  } catch {
    /* ignore */
  }
  return "models";
}

export function SettingsApp() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<{ timer?: number; value?: Settings }>({});

  const selectPage = useCallback((id: Page) => {
    setPage(id);
    if (!isTauri()) {
      const next = `#settings?page=${id}`;
      if (location.hash !== next) history.replaceState(null, "", next);
    }
  }, []);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    const onPage = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (PAGES.some((p) => p.id === id)) selectPage(id as Page);
    };
    window.addEventListener("pointer-settings-page", onPage);
    return () => window.removeEventListener("pointer-settings-page", onPage);
  }, [selectPage]);

  // Browser: keep the hash in sync with the sidebar, and react when the hash changes.
  useEffect(() => {
    if (isTauri()) return;
    const syncFromHash = () => setPage(pageFromUrl());
    window.addEventListener("hashchange", syncFromHash);
    const cur = pageFromUrl();
    const next = `#settings?page=${cur}`;
    if (location.hash !== next) history.replaceState(null, "", next);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const uiLanguage = settings?.uiLanguage;
  useEffect(() => {
    if (!uiLanguage) return;
    setLocale(resolveLocale(uiLanguage));
    document.title = t("settings.title");
  }, [uiLanguage, t]);

  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== "system") return;
    return subscribeSystemTheme(() => applyTheme("system"));
  }, [theme]);

  const flush = useCallback(() => {
    const { timer, value } = pending.current;
    clearTimeout(timer);
    pending.current = {};
    if (!value) return;
    void saveSettings(value)
      .then(() => setSaveError(null))
      .catch((e) => {
        console.error("[pointer] save settings failed", e);
        setSaveError(String(e));
      });
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (fn: (s: Settings) => Settings) => {
      setSettings((s) => {
        if (!s) return s;
        const next = fn(s);
        clearTimeout(pending.current.timer);
        // Overlay awaits loadSettings on each show; discrete trigger prefs must hit disk before
        // the next selection or expandMode looks unchanged.
        const urgent =
          next.expandMode !== s.expandMode ||
          next.autoTrigger !== s.autoTrigger ||
          next.clipboardFallback !== s.clipboardFallback;
        pending.current = { value: next, timer: window.setTimeout(flush, urgent ? 0 : SAVE_DELAY_MS) };
        return next;
      });
    },
    [flush],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full select-none">
        <nav className="flex w-48 shrink-0 flex-col border-r bg-sidebar p-3" aria-label={t("settings.title")}>
          <GlidePillGroup
            activeId={page}
            leaveMode="fade"
            pillClassName="bg-foreground/6 dark:bg-foreground/10"
            className="flex flex-col gap-0.5"
          >
            {PAGES.map((p) => (
              <NavItem
                key={p.id}
                id={p.id}
                label={t(p.labelKey)}
                icon={p.icon}
                active={page === p.id}
                onSelect={() => selectPage(p.id)}
              />
            ))}
          </GlidePillGroup>
        </nav>
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          {saveError && (
            <div
              className="sticky top-0 z-10 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
              role="alert"
            >
              {t("settings.saveFailed", { error: saveError })}
            </div>
          )}
          {!settings ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {t("settings.loading")}
            </div>
          ) : (
            <Crossfade swapKey={page} className="h-full">
              {page === "general" && <GeneralPage settings={settings} update={update} />}
              {page === "models" && <ModelsPage settings={settings} update={update} />}
              {page === "trigger" && <TriggerPage settings={settings} update={update} />}
              {page === "screen" && <ScreenTextPage settings={settings} update={update} />}
              {page === "exclude" && <ExcludedAppsPage settings={settings} update={update} />}
              {page === "context" && <ContextPage settings={settings} update={update} />}
              {page === "about" && <AboutPage />}
            </Crossfade>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}

function NavItem(props: { id: string; label: string; icon: AnimatedIcon; active: boolean; onSelect: () => void }) {
  const { ref, hover } = useIconAnimation(props.active);
  const Icon = props.icon;
  return (
    <GlidePillItem
      id={props.id}
      active={props.active}
      activeClassName="bg-background dark:bg-secondary font-medium text-foreground shadow-sm ring-1 ring-border/50"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onSelect}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onFocus={hover.onFocus}
      onBlur={hover.onBlur}
      className={cn(
        "h-8 gap-2 px-2.5 text-left text-sm",
        props.active ? "font-medium" : "text-foreground/65 hover:text-foreground",
      )}
    >
      <Icon ref={ref} size={16} />
      <span className="min-w-0 truncate">{props.label}</span>
    </GlidePillItem>
  );
}

function ModelsPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(
    settings.defaultProviderId ?? settings.providers[0]?.id ?? null,
  );
  const provider = settings.providers.find((p) => p.id === selected) ?? null;

  const add = () => {
    const preset = PRESETS[0];
    const p: ProviderConfig = {
      id: newProviderId(),
      name: presetName(preset),
      preset: preset.id,
      baseUrl: preset.baseUrl,
      api: presetApi(preset),
      model: "",
      headers: {},
      extraBody: null,
      compat: preset.compat,
    };
    update((s) => ({ ...s, providers: [...s.providers, p], defaultProviderId: s.defaultProviderId ?? p.id }));
    setSelected(p.id);
  };

  const change = (id: string, patch: Partial<ProviderConfig>) =>
    update((s) => ({ ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const remove = (id: string) => {
    void deleteApiKey(id).catch(() => {});
    update((s) => {
      const providers = s.providers.filter((p) => p.id !== id);
      return {
        ...s,
        providers,
        defaultProviderId: s.defaultProviderId === id ? (providers[0]?.id ?? null) : s.defaultProviderId,
      };
    });
    setSelected(settings.providers.find((p) => p.id !== id)?.id ?? null);
  };

  return (
    // Each column scrolls on its own; the page itself is exactly the window height.
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r">
        <div className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto p-2">
          <GlidePillGroup activeId={selected} leaveMode="fade" className="flex flex-col">
            <AnimatePresence initial={false}>
              {settings.providers.map((p) => (
                <CollapseItem key={p.id} className="shrink-0">
                  <GlidePillItem
                    id={p.id}
                    active={p.id === selected}
                    activeClassName="bg-accent"
                    onClick={() => setSelected(p.id)}
                    className="relative mb-0.5 flex-col items-start px-2.5 py-1.5 pr-5 text-left text-sm"
                  >
                    <span className="w-full truncate">{p.name || t("models.unnamed")}</span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {p.model || t("models.noModel")}
                    </span>
                    <AnimatePresence initial={false}>
                      {p.id === settings.defaultProviderId && (
                        <motion.span
                          key="dot"
                          className="absolute top-2 right-2 size-1.5 rounded-full bg-success"
                          title={t("models.default")}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={BADGE_POP}
                        />
                      )}
                    </AnimatePresence>
                  </GlidePillItem>
                </CollapseItem>
              ))}
            </AnimatePresence>
          </GlidePillGroup>
        </div>
        {/* Outside the scroller, so it is always reachable. */}
        <div className="shrink-0 p-2 pt-1">
          <IconButton icon={PlusIcon} variant="ghost" size="sm" className="w-full justify-start" onClick={add}>
            {t("models.add")}
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        {provider ? (
          <ProviderEditor
            key={provider.id}
            provider={provider}
            isDefault={provider.id === settings.defaultProviderId}
            onChange={(patch) => change(provider.id, patch)}
            onMakeDefault={() => update((s) => ({ ...s, defaultProviderId: provider.id }))}
            onDelete={() => remove(provider.id)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-start gap-3 p-6 text-muted-foreground">
            <p>{t("models.empty")}</p>
            <IconButton icon={PlusIcon} onClick={add}>
              {t("models.add")}
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

type Status =
  { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string; detail?: string };

function ProviderEditor(props: {
  provider: ProviderConfig;
  isDefault: boolean;
  onChange: (patch: Partial<ProviderConfig>) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { provider: p, onChange } = props;
  const preset = presetById(p.preset);
  const [url, setUrl] = useState(p.baseUrl);
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [headers, setHeaders] = useState(formatHeaders(p.headers));
  const [extra, setExtra] = useState(formatExtraBody(p.extraBody));
  const [models, setModels] = useState<string[]>([]);
  const [modelsStatus, setModelsStatus] = useState<Status>({ kind: "idle" });
  const [test, setTest] = useState<Status>({ kind: "idle" });
  const [advanced, setAdvanced] = useState(false);
  const { ref: advancedIconRef, hover: advancedIconHover } = useIconAnimation(advanced);

  useEffect(() => {
    void getApiKey(p.id)
      .then((k) => {
        setKey(k ?? "");
        setKeySaved(k ?? "");
      })
      .catch(() => {});
  }, [p.id]);

  const endpoint = normalizeEndpoint(url, p.api, p.model);
  const headersParsed = parseHeaders(headers);
  const extraParsed = parseExtraBody(extra);

  const setUrlDraft = (v: string) => {
    setUrl(v);
    setTest({ kind: "idle" });
    setModelsStatus({ kind: "idle" });
    const r = normalizeEndpoint(v, p.api);
    if (r.ok) onChange({ baseUrl: r.endpoint.baseUrl, api: r.endpoint.api });
  };

  const choosePreset = (id: string) => {
    const next = presetById(id);
    const keepName = p.name.trim() && !isPresetName(preset, p.name);
    const baseUrl = next.baseUrl || p.baseUrl;
    // Picking a vendor with its own protocol switches to it; picking an OpenAI-compatible one
    // leaves a hand-chosen Responses alone.
    const api = next.api ?? (p.api === "openai-responses" ? p.api : "openai-completions");
    onChange({ preset: next.id, name: keepName ? p.name : presetName(next), baseUrl, api, compat: next.compat });
    setUrl(baseUrl);
  };

  const saveKey = () => {
    if (key.trim() === keySaved) return;
    void setApiKey(p.id, key)
      .then(() => setKeySaved(key.trim()))
      .catch((e) => setTest({ kind: "error", text: t("provider.keyNotSaved"), detail: String(e) }));
  };

  const target = (): ModelTarget => ({
    baseUrl: p.baseUrl,
    api: p.api,
    model: p.model.trim(),
    apiKey: key.trim() || null,
    headers: p.headers,
    extraBody: p.extraBody,
    compat: p.compat,
  });

  const fetchModels = async () => {
    setModelsStatus({ kind: "busy" });
    const r = await listModels({ ...target(), api: p.api }, await providerFetch());
    if (r.status === "ok") {
      setModels(r.ids);
      setModelsStatus({ kind: "ok", text: t("provider.modelsFound", { count: r.ids.length }) });
    } else if (r.status === "empty") {
      setModels([]);
      setModelsStatus({ kind: "error", text: t("provider.modelsNone") });
    } else {
      setModelsStatus({
        kind: "error",
        text: r.error.message,
        detail: usefulErrorDetail(r.error.message, r.error.detail),
      });
    }
  };

  const runTest = async () => {
    if (!p.model.trim()) {
      setTest({ kind: "error", text: t("provider.needModel") });
      throw new Error("no model");
    }
    setTest({ kind: "busy" });
    saveKey();
    const r = await testConnection(target(), await providerFetch());
    setTest(
      r.ok
        ? { kind: "ok", text: t("provider.connected", { ms: r.firstTokenMs }) }
        : {
            kind: "error",
            text: r.error.message,
            detail: usefulErrorDetail(r.error.message, r.error.detail),
          },
    );
    if (!r.ok) throw new Error(r.error.message);
  };

  return (
    <div className="h-fit max-w-2xl min-w-0 flex-1 space-y-4 p-6">
      <Field label={t("provider.preset")}>
        {(id) => (
          <Select
            value={p.preset}
            onValueChange={(value) => {
              if (value != null) choosePreset(value);
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {presetName(x)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label={t("provider.name")}>
        {(id) => (
          <Input
            id={id}
            value={p.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={presetName(preset)}
          />
        )}
      </Field>
      <Field
        label={t("provider.baseUrl")}
        hint={endpoint.ok ? t("provider.requestGoesTo", { url: endpoint.endpoint.requestUrl }) : endpoint.reason}
        error={!endpoint.ok}
      >
        {(id) => (
          <Input
            id={id}
            value={url}
            spellCheck={false}
            aria-invalid={!endpoint.ok}
            placeholder={
              p.api === "anthropic-messages" || p.api === "google-generative-ai"
                ? preset.baseUrl || "https://api.example.com"
                : "https://api.example.com/v1"
            }
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => endpoint.ok && setUrl(endpoint.endpoint.baseUrl)}
          />
        )}
      </Field>
      <Field label={preset.needsKey ? t("provider.key") : t("provider.keyOptional")} hint={t("provider.keyHint")}>
        {(id) => (
          <div className="flex gap-2">
            <Input
              id={id}
              type={showKey ? "text" : "password"}
              value={key}
              spellCheck={false}
              autoComplete="off"
              placeholder={
                preset.needsKey
                  ? p.api === "google-generative-ai"
                    ? "AIza…"
                    : p.api === "anthropic-messages"
                      ? "sk-ant-…"
                      : "sk-…"
                  : t("provider.keyLocal")
              }
              onChange={(e) => setKey(e.target.value)}
              onBlur={saveKey}
            />
            <IconButton
              icon={showKey ? EyeOffIcon : EyeIcon}
              variant="outline"
              size="icon"
              title={showKey ? t("provider.hideKey") : t("provider.showKey")}
              onClick={() => setShowKey((v) => !v)}
            />
          </div>
        )}
      </Field>
      <Field label={t("provider.model")} hint={<StatusLine status={modelsStatus} />}>
        {(id) => (
          <div className="flex flex-wrap gap-2">
            <Combobox
              id={id}
              value={p.model}
              options={models}
              placeholder={preset.modelHint ?? t("provider.modelPlaceholder")}
              onChange={(model) => onChange({ model })}
              className="min-w-0 flex-[1_1_12rem]"
            />
            <IconButton
              icon={RefreshCWIcon}
              variant="outline"
              disabled={!endpoint.ok || modelsStatus.kind === "busy"}
              onClick={() => void fetchModels()}
            >
              {t("provider.fetchModels")}
            </IconButton>
          </div>
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <ActionButton
          icon={ZapIcon}
          disabled={!endpoint.ok}
          label={t("provider.test")}
          pendingLabel={t("provider.testing")}
          doneLabel={t("provider.testOk")}
          errorLabel={t("provider.testFailed")}
          onAction={runTest}
        />
        <DefaultButton isDefault={props.isDefault} onMakeDefault={props.onMakeDefault} />
        <span className="flex-1" />
        <IconButton
          icon={DeleteIcon}
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={props.onDelete}
        >
          {t("common.delete")}
        </IconButton>
      </div>
      <StatusLine status={test} after={16} />

      <Separator />
      <div>
        <Button
          variant="ghost"
          aria-expanded={advanced}
          aria-controls="provider-advanced"
          onClick={() => setAdvanced((v) => !v)}
          size="sm"
          className="-ml-2 text-muted-foreground"
          {...advancedIconHover}
        >
          <SettingsIcon ref={advancedIconRef} size={16} />
          {t("provider.advanced")}
          <ChevronDown className={cn("transition-transform duration-200", advanced && "rotate-180")} />
        </Button>
        <Reveal show={advanced} id="provider-advanced" before={16}>
          <div className="space-y-4">
            <Field label={t("provider.api")}>
              {(id) => (
                <Select value={p.api} onValueChange={(v) => onChange({ api: v as ApiKind })}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-completions">{t("provider.apiCompletions")}</SelectItem>
                    <SelectItem value="openai-responses">{t("provider.apiResponses")}</SelectItem>
                    <SelectItem value="anthropic-messages">{t("provider.apiAnthropic")}</SelectItem>
                    <SelectItem value="google-generative-ai">{t("provider.apiGemini")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field
              label={t("provider.headers")}
              hint={headersParsed.ok ? t("provider.headersHint") : headersParsed.reason}
              error={!headersParsed.ok}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  spellCheck={false}
                  className="font-mono text-xs"
                  aria-invalid={!headersParsed.ok}
                  value={headers}
                  onChange={(e) => {
                    setHeaders(e.target.value);
                    const r = parseHeaders(e.target.value);
                    if (r.ok) onChange({ headers: r.value });
                  }}
                />
              )}
            </Field>
            <Field
              label={t("provider.extraBody")}
              hint={extraParsed.ok ? t("provider.extraBodyHint") : extraParsed.reason}
              error={!extraParsed.ok}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  spellCheck={false}
                  className="font-mono text-xs"
                  aria-invalid={!extraParsed.ok}
                  value={extra}
                  onChange={(e) => {
                    setExtra(e.target.value);
                    const r = parseExtraBody(e.target.value);
                    if (r.ok) onChange({ extraBody: r.value });
                  }}
                />
              )}
            </Field>
          </div>
        </Reveal>
      </div>
      {!isTauri() && <p className="text-xs text-muted-foreground">{t("provider.browserDemo")}</p>}
    </div>
  );
}

const SYSTEM = "system";
const AUTO = "auto";

function ContextPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  const system = nativeLanguage();
  const native = userLanguage(settings);
  // A language no longer offered (or equal to the native one) shows as the default it falls back to.
  const chosen = (v: string | null) => languageByPrompt(v)?.prompt ?? null;
  const second = settings.secondLanguage !== native.prompt ? chosen(settings.secondLanguage) : null;
  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-base font-semibold">{t("context.title")}</h2>
      <Field label={t("context.native")} hint={t("context.nativeHint")}>
        {(id) => (
          <Select
            value={chosen(settings.nativeLanguage) ?? SYSTEM}
            onValueChange={(v) => update((s) => ({ ...s, nativeLanguage: v === SYSTEM ? null : v }))}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM}>{t("context.followSystem", { language: system.label })}</SelectItem>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.prompt} value={l.prompt}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label={t("context.second")} hint={t("context.secondHint")}>
        {(id) => (
          <Select
            value={second ?? AUTO}
            onValueChange={(v) => update((s) => ({ ...s, secondLanguage: v === AUTO ? null : v }))}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>
                {t("context.secondDefault", { language: defaultSecondLanguage(native).label })}
              </SelectItem>
              {LANGUAGES.filter((l) => l.prompt !== native.prompt).map((l) => (
                <SelectItem key={l.prompt} value={l.prompt}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Toggle
        checked={settings.sendContext}
        onChange={(v) => update((s) => ({ ...s, sendContext: v }))}
        label={t("context.sendContext")}
        hint={t("context.sendContextHint")}
      />
      <Toggle
        checked={settings.sendContext && settings.sendWindowInfo}
        disabled={!settings.sendContext}
        onChange={(v) => update((s) => ({ ...s, sendWindowInfo: v }))}
        label={t("context.sendWindowInfo")}
        hint={t("context.sendWindowInfoHint")}
      />
    </div>
  );
}

function AboutPage() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion("—"));
  }, []);
  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h2 className="text-base font-semibold">{t("about.title")}</h2>
      <p>{t("about.summary")}</p>
      <p className="text-muted-foreground">{t("about.privacy")}</p>
      <p className="text-sm text-foreground">{t("about.version", { version: version ?? "…" })}</p>
      <div className="space-y-1.5">
        <Button
          variant="outline"
          onClick={() => {
            setLogsError(null);
            void openLogs().catch((e) => {
              const msg = e instanceof Error ? e.message : String(e);
              setLogsError(msg === "unavailable" || !msg ? t("about.logsUnavailable") : msg);
            });
          }}
        >
          {t("about.logs")}
        </Button>
        <p className="text-xs text-muted-foreground">{logsError ?? t("about.logsHint")}</p>
      </div>
    </div>
  );
}

/**
 * "Make default" and "Default service" are one control: the fill fades from outline to
 * secondary, the label crossfades while the width springs, and the green dot pops in.
 */
function DefaultButton(props: { isDefault: boolean; onMakeDefault: () => void }) {
  const t = useT();
  const { ref, hover } = useIconAnimation();
  const on = props.isDefault;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={on || undefined}
      onClick={on ? undefined : props.onMakeDefault}
      {...(on ? {} : hover)}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium whitespace-nowrap outline-none",
        "transition-[background-color,border-color,color,box-shadow] duration-300 ease-out",
        "focus-visible:ring-[3px] focus-visible:ring-ring/80",
        on
          ? "border-transparent bg-secondary font-normal text-secondary-foreground"
          : "border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        <motion.span
          className="absolute inline-flex"
          initial={false}
          animate={{ opacity: on ? 0 : 1, scale: on ? 0.5 : 1 }}
          transition={FADE}
        >
          <CircleCheckIcon ref={ref} size={16} />
        </motion.span>
        <motion.span
          className="absolute size-2 rounded-full bg-success"
          initial={false}
          animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.9 }}
          transition={on ? { ...BADGE_POP, delay: 0.08 } : FADE}
        />
      </span>
      <ContentSwap swapKey={on}>{on ? t("provider.isDefault") : t("provider.makeDefault")}</ContentSwap>
    </button>
  );
}

/** Drop raw English noise like "Connection error." when the localized line already covers it. */
function usefulErrorDetail(message: string, detail?: string): string | undefined {
  if (!detail) return undefined;
  const d = detail.trim();
  if (!d || d === message) return undefined;
  if (/^connection error\.?$/i.test(d) || /^failed to fetch$/i.test(d) || /^networkerror.*$/i.test(d)) {
    return undefined;
  }
  return detail;
}

function StatusLine({ status, after }: { status: Status; after?: number }) {
  const shown = status.kind === "ok" || status.kind === "error" ? status : null;
  return (
    <Reveal show={!!shown} after={after}>
      {shown && (
        <div className={cn("text-xs", shown.kind === "ok" ? "text-success" : "text-destructive")}>
          {shown.text}
          {shown.kind === "error" && shown.detail && (
            <div className="mt-0.5 line-clamp-3 font-mono text-[11px] break-all text-muted-foreground">
              {shown.detail}
            </div>
          )}
        </div>
      )}
    </Reveal>
  );
}
