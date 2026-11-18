import { createContext, useContext } from "react";

export type Lang = "zh" | "en";

const STORAGE_KEY = "pointer.lang";

/** A saved choice wins; otherwise Chinese browsers get Chinese and everyone else English. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // Storage can be blocked (private mode, sandboxed iframes); fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not saved; the toggle still works for this visit.
  }
}

const zh = {
  "meta.title": "点拨 · 在任何应用里划词问 AI",
  "meta.description":
    "在任何应用里选中一段文字，AI 就在旁边解释或翻译，答案原地展开。支持 macOS 和 Windows，接入你自己的模型。",
  brand: "点拨",
  "nav.how": "工作方式",
  "nav.models": "模型",
  "nav.privacy": "隐私",
  "nav.faq": "常见问题",
  "nav.download": "下载",
  "nav.lang": "EN",
  "nav.langLabel": "Switch to English",

  "hero.title1": "读到不懂的，",
  "hero.title2": "划一下就好。",
  "hero.lede": "在任何应用里选中一段文字，AI 就在旁边解释或翻译。不用复制，不用切窗口。",
  "hero.try": "试试在这篇文章里划一段文字，",
  "hero.watch": "或者看一遍演示",
  "hero.touch": "这里会自动演示一遍。在电脑上打开，可以亲手划词试试。",
  "hero.replay": "再看一遍",

  "download.mac": "下载 macOS 版",
  "download.windows": "下载 Windows 版",
  "download.macShort": "macOS 版",
  "download.windowsShort": "Windows 版",
  "download.note": "软件免费。需要一个模型服务的 API Key，也可以用本机模型。macOS 12+，Windows 10 / 11。",
  "download.desktopOnly": "点拨是桌面应用，请在 Mac 或 Windows 电脑上下载。",

  "how.title": "一个浮层，三种样子",
  "how.intro": "平时它只是选区旁的一个划词图标，鼠标停上去才展开，用完自己收起。",
  "how.step1": "先选中一段文字。",
  "how.step1Body": "松开鼠标，旁边就出现划词图标。",
  "how.step2": "再把鼠标停在图标上。",
  "how.step2Body": "它横向展开成一排按钮：解释、翻译、复制、搜索。",
  "how.step3": "然后点「解释」或「翻译」。",
  "how.step3Body": "操作栏原地变成面板，答案一个字一个字流出来。读完点一下别处，它就收起。",

  "margin.title": "读书人一直这样做",
  "margin.body1":
    "读到看不懂的地方，读书人一直是在旁边写上一句。中世纪的抄本把释义写在行间，明清的评点本把批语印在正文旁，还有人在要紧处画一只指路的小手，英文叫 manicule，也叫 pointer。",
  "margin.body2": "点拨做的是同一件事：在你卡住的地方点拨一句，答案写在原文旁边。",
  "margin.manicule": "1475 年纽伦堡印的拉丁文《圣经》，页边有读者手绘的指路小手",
  "margin.psalter": "雷布多夫诗篇集，行间和页边写满释义，12 世纪德国",
  "margin.beccadelli": "贝卡代利在自己的普鲁塔克译本页边写的批注，15 世纪",
  "margin.xixiang": "李贽批点本《西厢记》，明崇祯十三年（1640）刊",

  "context.title": "它按这里的意思解释",
  "context.body1":
    "同一个词，在代码编辑器里和在新闻里，意思可能完全不同。点拨把选区前后的文字，连同应用名、标签页标题和网址一起交给模型，所以它解释的是这里的意思。",
  "context.receives": "模型收到的内容",
  "context.row.selection": "选中的文字",
  "context.row.app": "应用",
  "context.row.around": "发送前后文",
  "context.row.window": "发送窗口标题和网址",
  "context.row.chars": "前后各取",
  "context.row.charsValue": "约 300 字",
  "context.row.lang": "解释所用语言",
  "context.row.langValue": "简体中文",
  "context.try": "在文章里试一下",
  "context.body2": "选中 velocity，它回答的是敏捷开发里的「迭代速率」，而不是物理课上的速度。这两个开关在设置里也有。",

  "features.title": "在哪儿读，就在哪儿问",
  "features.anywhere": "任何应用都能用",
  "features.anywhere1":
    "浏览器、PDF 阅读器、代码编辑器、聊天软件、笔记应用。点拨通过系统的辅助功能读取选中的文字，不用给每个应用装插件。",
  "features.anywhere2":
    "遇到读不到的地方，按 {shortcut} 直接唤出操作栏。在 macOS 上还能框选屏幕上的一块区域，用本机的文字识别读出图片里的字。",
  "features.translate": "翻译不用选语言",
  "features.translate1": "选中的是外语，就译成你的母语；是母语，就译成你的第二语言。",
  "features.translate2": "母语和第二语言都可以在设置里改，也可以在面板顶部临时换一种。",
  "features.followup": "答完还能接着问",
  "features.followup1":
    "答案下面有一个输入框，可以接着问「举个例子」「和 KPI 有什么关系」。模型能看到原文、上下文和前面的回答。",
  "features.followup2": "面板一关，对话就结束，不留记录。",
  "features.quiet": "不用时，它就不在",
  "features.quiet1": "不碰划词图标，它 3 秒后自己消失；开始打字、滚动页面，或者把鼠标移开，也会消失。",
  "features.quiet2": "也可以改成点击才展开，或者选完直接出操作栏。",

  "models.title": "用你自己的模型",
  "models.body1": "点拨不绑定任何一家模型。填上接口地址、API Key 和模型名就能用，下面这些服务商都有预设。",
  "models.cloud": "云端",
  "models.local": "在你的电脑上",
  "models.custom": "其他 OpenAI 兼容接口",
  "models.customValue": "自定义",
  "models.body2": "可以保存多个，选一个作为默认。想完全离线，就用 Ollama 或 LM Studio 跑本机模型。",

  "privacy.title": "你的文字只发给你的模型",
  "privacy.1": "不做任何统计和上报。",
  "privacy.2": "选中的文字和上下文，只发给你配置的那个模型服务。",
  "privacy.3": "API Key 存在系统钥匙串（Windows 上是凭据管理器）里，不写进配置文件。",
  "privacy.4": "诊断日志只存在本机，也不记录你选中的内容。",
  "privacy.excluded": "在下面这些应用里选中文字，默认不出现划词图标，也不读取文字：",
  "privacy.mac": "macOS",
  "privacy.win": "Windows",

  "faq.title": "常见问题",
  "faq.price.q": "要付费吗？",
  "faq.price.a": "点拨免费。调用模型的费用由你选的服务商按用量收取；用本机模型则不花钱。",
  "faq.os.q": "支持哪些系统？",
  "faq.os.a": "macOS 12 及以上（Apple 芯片和 Intel 都支持），Windows 10 和 11（x64）。暂不支持 Linux。",
  "faq.mac.q": "macOS 提示「无法验证开发者」怎么办？",
  "faq.mac.a":
    "点拨还没有经过 Apple 公证，第一次打开会被系统拦下。打开「系统设置 → 隐私与安全性」，在页面下方点「仍要打开」即可，之后不会再提示。",
  "faq.win.q": "Windows 弹出「Windows 已保护你的电脑」？",
  "faq.win.a": "安装包还没有代码签名。点「更多信息」，再点「仍要运行」。",
  "faq.perm.q": "需要哪些权限？",
  "faq.perm.a":
    "macOS 需要「辅助功能」权限来读取选中的文字，首次启动时会引导你打开。框选识字另外需要「屏幕录制」权限，不用这个功能可以不开。Windows 不需要额外授权，但读不到以管理员身份运行的程序里的文字。",
  "faq.miss.q": "有些应用里划词没反应？",
  "faq.miss.a":
    "少数应用不对外提供选中的文字。这时按 {shortcut} 手动唤出，点拨会模拟一次复制来读取，读完马上恢复你原来的剪贴板。",
  "faq.offline.q": "能离线用吗？",
  "faq.offline.a": "可以。用 Ollama 或 LM Studio 在本机跑模型，选中的文字就不会离开你的电脑。",
  "faq.history.q": "会保存我问过的内容吗？",
  "faq.history.a": "不会。面板关掉，对话就结束了；诊断日志也不记录你选中的文字。",
  "faq.trigger.q": "能不能只在我需要时才出现？",
  "faq.trigger.a": "可以。在设置里关掉「选中文字后显示划词图标」，之后只用 {shortcut} 唤出。",

  "cta.title": "下次读到不懂的地方，划一下。",
  "cta.unsigned": "安装包暂未签名，首次打开的方法见上面的常见问题。",

  "footer.what": "点拨，在任何应用里划词问 AI",
  "footer.releases": "所有版本",
  "footer.note": "不收集任何数据",
  "footer.pictures": "图片：",
  "footer.via": "来自 Wikimedia Commons",

  "action.explain": "解释",
  "action.translate": "翻译",
  "action.copy": "复制",
  "action.search": "搜索",
  "panel.copy": "复制",
  "panel.copied": "已复制",
  "panel.stop": "停止",
  "panel.regenerate": "重新生成",
  "panel.close": "关闭",
  "panel.followUp": "继续追问…",
  "panel.followUpLater": "回答完成后可以继续追问",
  "panel.send": "发送（Enter）",
  "panel.target": "简体中文",
  "chrome.url": "essays.example.com/goodhart",
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  "meta.title": "Pointer · Select text, ask AI, right where you read",
  "meta.description":
    "Select text in any app and AI explains or translates it right beside the words. For macOS and Windows, with the model of your choice.",
  brand: "Pointer",
  "nav.how": "How it works",
  "nav.models": "Models",
  "nav.privacy": "Privacy",
  "nav.faq": "FAQ",
  "nav.download": "Download",
  "nav.lang": "中文",
  "nav.langLabel": "切换到中文",

  "hero.title1": "Stuck on a word?",
  "hero.title2": "Select it.",
  "hero.lede": "Select text in any app and AI explains or translates it right there. No copying, no switching windows.",
  "hero.try": "Try selecting some text in this article,",
  "hero.watch": "or watch it once",
  "hero.touch": "This plays on its own here. Open the page on a computer to try selecting text yourself.",
  "hero.replay": "Play again",

  "download.mac": "Download for macOS",
  "download.windows": "Download for Windows",
  "download.macShort": "macOS",
  "download.windowsShort": "Windows",
  "download.note": "Free. You need an API key from a model provider, or a local model. macOS 12+, Windows 10 and 11.",
  "download.desktopOnly": "Pointer is a desktop app. Download it on a Mac or Windows PC.",

  "how.title": "One overlay, three shapes",
  "how.intro":
    "Most of the time it’s a small bubble beside your selection. Rest on it to open it; it puts itself away when you’re done.",
  "how.step1": "First, select a phrase.",
  "how.step1Body": "Let go of the mouse and a bubble appears beside it.",
  "how.step2": "Rest on the bubble.",
  "how.step2Body": "It stretches into a row of actions: Explain, Translate, Copy, Search.",
  "how.step3": "Click Explain or Translate.",
  "how.step3Body":
    "The bar turns into a panel and the answer streams in. Click anywhere else when you're done and it's gone.",

  "margin.title": "Readers have always done this",
  "margin.body1":
    "When a passage got hard, readers wrote the answer beside it. Medieval scribes glossed between the lines, Ming and Qing editions printed commentary next to the text, and readers drew a small pointing hand beside what mattered: a manicule, also called a pointer.",
  "margin.body2": "Pointer does the same: the answer sits next to the words, and you never leave the page.",
  "margin.manicule": "A pointing hand drawn by a reader in a Latin Bible printed in Nuremberg, 1475",
  "margin.psalter": "The Rebdorf Psalter, glossed between the lines and in the margins, Germany, 12th century",
  "margin.beccadelli": "Antonio Beccadelli’s notes in the margin of his Plutarch, 15th century",
  "margin.xixiang": "Li Zhi’s annotated edition of The West Chamber, printed in 1640",

  "context.title": "It reads the sentence around it",
  "context.body1":
    "The same word can mean one thing in a code editor and another in the news. Pointer sends the text around your selection, plus the app, tab title and URL, so the model explains what it means here.",
  "context.receives": "What the model receives",
  "context.row.selection": "Selection",
  "context.row.app": "App",
  "context.row.around": "Send the text around it",
  "context.row.window": "Send window title and URL",
  "context.row.chars": "Each side",
  "context.row.charsValue": "about 300 characters",
  "context.row.lang": "Explains in",
  "context.row.langValue": "English",
  "context.try": "Try it in the article",
  "context.body2":
    "Select “velocity” and it answers with the agile meaning, story points per sprint, not the one from physics class. Both switches are in settings too.",

  "features.title": "Ask wherever you read",
  "features.anywhere": "Works in any app",
  "features.anywhere1":
    "Browsers, PDF readers, code editors, chat apps, notes. Pointer reads the selection through the system’s accessibility APIs, so it works the same everywhere.",
  "features.anywhere2":
    "Where it can’t read the selection, press {shortcut} to open the action bar directly. On macOS you can also drag over any part of the screen and read the text in it with on-device text recognition.",
  "features.translate": "No language to pick",
  "features.translate1":
    "Select something in a foreign language and it comes back in your native one. Select your native language and it goes into your second.",
  "features.translate2": "Change either in settings, or pick another language at the top of the panel just this once.",
  "features.followup": "Then ask a follow-up",
  "features.followup1":
    "Under every answer there’s a box for the next question: “give me an example”, “how is this different from a KPI?” The model sees the selection, its context and the answers so far.",
  "features.followup2": "Close the panel and the conversation is gone, with nothing saved.",
  "features.quiet": "Gone when you’re done",
  "features.quiet1":
    "Leave the bubble alone and it fades after three seconds, or as soon as you type, scroll or move away.",
  "features.quiet2": "You can also make it open only on click, or go straight to the action bar.",

  "models.title": "Your model, your key",
  "models.body1":
    "Pointer isn’t tied to any provider. Enter an endpoint, an API key and a model name, or start from one of these presets.",
  "models.cloud": "In the cloud",
  "models.local": "On your computer",
  "models.custom": "Any other OpenAI-compatible endpoint",
  "models.customValue": "Custom",
  "models.body2": "Save as many as you like and pick one as the default. To stay offline, run a local model.",

  "privacy.title": "Your text goes only to your model",
  "privacy.1": "Nothing is collected or reported: no telemetry, no analytics.",
  "privacy.2": "Your selection and its context go only to the model provider you set up.",
  "privacy.3": "API keys live in the macOS Keychain or Windows Credential Manager, never in a config file.",
  "privacy.4": "Diagnostic logs stay on your machine and never include the text you selected.",
  "privacy.excluded": "Selecting text in these apps shows nothing and reads nothing, by default:",
  "privacy.mac": "macOS",
  "privacy.win": "Windows",

  "faq.title": "FAQ",
  "faq.price.q": "Does it cost anything?",
  "faq.price.a": "Pointer is free. Your model provider bills you for usage; local models cost nothing.",
  "faq.os.q": "Which systems does it run on?",
  "faq.os.a": "macOS 12 or later (Apple silicon and Intel) and Windows 10 or 11 (x64). Linux isn’t supported yet.",
  "faq.mac.q": "macOS says it can’t verify the developer?",
  "faq.mac.a":
    "Pointer isn’t notarized by Apple yet, so macOS blocks it the first time. Open System Settings → Privacy & Security and click Open Anyway near the bottom. You won’t be asked again.",
  "faq.win.q": "Windows says it protected your PC?",
  "faq.win.a": "The installer isn’t code-signed yet. Click More info, then Run anyway.",
  "faq.perm.q": "What permissions does it need?",
  "faq.perm.a":
    "On macOS, Accessibility, to read the selected text; the first launch walks you through it. Reading text from the screen also needs Screen Recording, which you can skip if you don’t use it. Windows needs no extra permission, but can’t read text in apps running as administrator.",
  "faq.miss.q": "Nothing happens in some apps?",
  "faq.miss.a":
    "A few apps don’t expose their selection. Press {shortcut} instead: Pointer copies the selection once, reads it, and puts your clipboard back the way it was.",
  "faq.offline.q": "Does it work offline?",
  "faq.offline.a": "Yes, with a local model in Ollama or LM Studio. Then your selection never leaves your computer.",
  "faq.history.q": "Does it keep what I asked?",
  "faq.history.a":
    "No. Closing the panel ends the conversation, and the diagnostics never include the text you selected.",
  "faq.trigger.q": "Can it appear only when I ask?",
  "faq.trigger.a": "Yes. Turn off “Show the bubble after selecting text” in settings and use {shortcut} instead.",

  "cta.title": "Next time you get stuck, select it.",
  "cta.unsigned": "The installers aren’t signed yet. See the questions above for how to open them the first time.",

  "footer.what": "Pointer, an AI overlay for selected text",
  "footer.releases": "All releases",
  "footer.note": "Collects no data",
  "footer.pictures": "Pictures:",
  "footer.via": "via Wikimedia Commons",

  "action.explain": "Explain",
  "action.translate": "Translate",
  "action.copy": "Copy",
  "action.search": "Search",
  "panel.copy": "Copy",
  "panel.copied": "Copied",
  "panel.stop": "Stop",
  "panel.regenerate": "Regenerate",
  "panel.close": "Close",
  "panel.followUp": "Ask a follow-up…",
  "panel.followUpLater": "You can ask a follow-up once the answer is done",
  "panel.send": "Send (Enter)",
  "panel.target": "简体中文",
  "chrome.url": "essays.example.com/goodhart",
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en };

export const LangContext = createContext<Lang>("zh");

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): (key: MessageKey, vars?: Record<string, string>) => string {
  const lang = useLang();
  return (key, vars) => {
    let text = MESSAGES[lang][key];
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, value);
    return text;
  };
}
