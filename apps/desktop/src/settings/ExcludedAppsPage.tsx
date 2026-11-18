import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { DeleteIcon, PlusIcon } from "@/components/animated-icons";
import { CollapseItem, REVEAL, Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isImeKey } from "@/lib/ime";
import { isTauri } from "@/shared/runtime";
import { DEFAULT_SETTINGS, type ExcludedApp, type Settings } from "@/shared/settings";
import { Field, IconButton, type Update } from "./controls";
import { recentApps, type RecentApp } from "./native";
import { recentAppsEmptyHint } from "./recentAppsHint";
import { platform } from "./shortcut";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function ExcludedAppsPage({ settings, update }: { settings: Settings; update: Update }) {
  const t = useT();
  const here = platform() === "macos" ? "macos" : "windows";
  const [recent, setRecent] = useState<RecentApp[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const refresh = () => void recentApps().then(setRecent, () => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const excluded = settings.excludedApps;
  const isExcluded = (id: string) => excluded.some((a) => same(a.id, id));
  const shown = excluded.filter((a) => !a.platform || a.platform === here);
  const suggestions = recent.filter((a): a is RecentApp & { id: string } => !!a.id && !isExcluded(a.id));
  const missingDefaults = DEFAULT_SETTINGS.excludedApps.filter((a) => a.platform === here && !isExcluded(a.id));

  // Rows added after the first render flash once; a batch (restore defaults) staggers in.
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    if (!fresh.length) return;
    const timer = setTimeout(() => setFresh([]), 1400);
    return () => clearTimeout(timer);
  }, [fresh]);

  const add = (app: ExcludedApp) => {
    if (isExcluded(app.id)) return;
    setFresh([app.id]);
    update((s) => ({ ...s, excludedApps: [...s.excludedApps, app] }));
  };
  const remove = (id: string) => update((s) => ({ ...s, excludedApps: s.excludedApps.filter((a) => !same(a.id, id)) }));
  const addDraft = () => {
    const id = draft.trim();
    if (!id) return;
    add({ id, name: id });
    setDraft("");
  };

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("exclude.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("exclude.intro")}</p>
      </div>

      <ul className="divide-y rounded-md border">
        <AnimatePresence initial={false}>
          {shown.map((a) => (
            <CollapseItem as="li" key={a.id} delay={Math.max(0, fresh.indexOf(a.id)) * 0.04}>
              <div className={cn("flex items-center gap-3 px-3 py-1.5", fresh.includes(a.id) && "just-added")}>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.name}</div>
                  {a.name !== a.id && <div className="truncate font-mono text-xs text-muted-foreground">{a.id}</div>}
                </div>
                <IconButton
                  icon={DeleteIcon}
                  variant="ghost"
                  size="icon-sm"
                  title={t("exclude.remove")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(a.id)}
                />
              </div>
            </CollapseItem>
          ))}
          {shown.length === 0 && (
            <CollapseItem as="li" key="empty">
              <div className="px-3 py-3 text-muted-foreground">{t("exclude.empty")}</div>
            </CollapseItem>
          )}
        </AnimatePresence>
      </ul>

      {isTauri() && (
        <Field label={t("exclude.recent")} hint={recentAppsEmptyHint(recent, t("exclude.recentHint"))}>
          {(id) => (
            <div id={id} className="-mr-2 flex flex-wrap gap-y-2">
              <AnimatePresence initial={false}>
                {suggestions.map((a) => (
                  <motion.span
                    key={a.id}
                    className="inline-flex overflow-hidden"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "auto", opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={REVEAL}
                  >
                    <IconButton
                      icon={PlusIcon}
                      variant="outline"
                      size="sm"
                      className="mr-2"
                      title={a.id}
                      onClick={() => add({ id: a.id, name: a.name ?? a.id })}
                    >
                      {a.name ?? a.id}
                    </IconButton>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Field>
      )}

      <Field
        label={t("exclude.manual")}
        hint={here === "macos" ? t("exclude.manualHintMac") : t("exclude.manualHintWindows")}
      >
        {(id) => (
          <div className="flex gap-2">
            <Input
              id={id}
              value={draft}
              spellCheck={false}
              placeholder={here === "macos" ? "com.example.app" : "example.exe"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isImeKey(e) && addDraft()}
            />
            <Button variant="outline" disabled={!draft.trim() || isExcluded(draft.trim())} onClick={addDraft}>
              {t("exclude.add")}
            </Button>
          </div>
        )}
      </Field>

      <Reveal show={missingDefaults.length > 0}>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => {
            setFresh(missingDefaults.map((a) => a.id));
            update((s) => ({ ...s, excludedApps: [...s.excludedApps, ...missingDefaults] }));
          }}
        >
          {t("exclude.restore", { count: missingDefaults.length })}
        </Button>
      </Reveal>
    </div>
  );
}
