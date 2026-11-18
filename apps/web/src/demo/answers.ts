import type { Lang } from "@/i18n";

export type ActionId = "explain" | "translate" | "copy" | "search";
export type PromptActionId = "explain" | "translate";

/**
 * The hero's sample passage. Kept as data so the canned answers below and the "what the model
 * receives" figure quote exactly the same words. `demo` marks the phrases the scripted demo selects.
 */
export const PASSAGE = [
  [
    { text: "When a measure becomes a target, it " },
    { text: "ceases to be", demo: "ceases" },
    { text: " a good measure. Economists call this " },
    { text: "Goodhart's law", demo: "goodhart" },
    { text: ", and it shows up wherever people are rewarded for hitting a number." },
  ],
  [
    { text: "Hospitals discharge patients early to shorten waiting lists. Engineering teams split tickets to " },
    { text: "inflate", demo: "inflate" },
    { text: " their " },
    { text: "velocity", demo: "velocity" },
    { text: ". The number goes up; the thing it was supposed to track does not." },
  ],
] as const;

export const PASSAGE_TITLE = "On Measuring Things";

type Answers = Record<Lang, string> & { translate: string };

interface Entry {
  /** Whether a normalized selection is this entry's text. */
  test: (s: string) => boolean;
  answers: Answers;
}

const has =
  (...parts: string[]) =>
  (s: string) =>
    parts.every((p) => s.includes(p));

/** Most specific first: a whole paragraph wins over a word inside it. */
const ENTRIES: Entry[] = [
  {
    test: has("measure becomes", "hospitals"),
    answers: {
      zh: "这段在讲**古德哈特定律**：指标一旦变成考核目标，就会被“刷”到失真。\n\n- 医院按候诊名单考核 → 提前让病人出院\n- 研发团队按迭代速率考核 → 把任务拆碎\n\n数字变好看了，真正想要的结果并没有改善。",
      en: "This is **Goodhart's law**: once a number becomes a target, people game it until it stops meaning anything.\n\n- Hospitals judged on waiting lists send patients home early.\n- Teams judged on velocity split their tickets.\n\nThe metric improves; the outcome it stood for doesn't.",
      translate:
        "当一个指标变成目标，它就不再是一个好指标。经济学家把这叫作古德哈特定律：只要人们因为达到某个数字而受到奖励，它就会出现。\n\n医院为了缩短候诊名单，让病人提前出院；工程团队把任务拆细，来抬高迭代速率。数字上去了，它本该反映的东西却没有。",
    },
  },
  {
    test: has("measure becomes", "hitting a number"),
    answers: {
      zh: "这是**古德哈特定律**的原话和出处：一个数字一旦被拿来奖惩，人们就会去优化这个数字本身，而不是它背后的东西。",
      en: "The law and where it comes from: as soon as a number is tied to rewards, people optimize the number itself rather than what it was meant to show.",
      translate:
        "当一个指标变成目标，它就不再是一个好指标。经济学家把这叫作古德哈特定律：只要人们因为达到某个数字而受到奖励，它就会出现。",
    },
  },
  {
    test: has("hospitals", "does not"),
    answers: {
      zh: "两个例子：\n\n- 医院按候诊名单考核 → 提前让病人出院\n- 研发团队按迭代速率考核 → 把任务拆碎\n\n数字变好看了，真正想要的结果并没有改善。",
      en: "Two examples:\n\n- Hospitals judged on waiting lists send patients home early.\n- Teams judged on velocity split their tickets.\n\nThe metric improves; the outcome it stood for doesn't.",
      translate:
        "医院为了缩短候诊名单，让病人提前出院；工程团队把任务拆细，来抬高迭代速率。数字上去了，它本该反映的东西却没有。",
    },
  },
  {
    test: has("measure becomes a target"),
    answers: {
      zh: "这句话就是古德哈特定律本身：一旦大家为了某个数字而努力，这个数字就会被“优化”到失真。",
      en: "This sentence is Goodhart's law itself: once people work toward a number, they optimize it until it no longer reflects reality.",
      translate: "当一个指标变成目标，它就不再是一个好指标。",
    },
  },
  {
    test: has("hospitals discharge"),
    answers: {
      zh: "举个例子：如果医院按“候诊名单有多短”考核，最省事的办法就是让病人早点出院。名单短了，病人未必好了。",
      en: "An example of the law: if a hospital is judged by how short its waiting list is, the easy fix is to discharge people sooner, not to treat them better.",
      translate: "医院为了缩短候诊名单，让病人提前出院。",
    },
  },
  {
    test: has("goodhart"),
    answers: {
      zh: "**古德哈特定律**：一个指标一旦被当成考核目标，人们就会想办法“刷”这个数字，它也就不再能反映原本想衡量的东西。\n\n由英国经济学家 Charles Goodhart 在 1975 年提出，原本说的是货币政策，后来被用到各种 KPI 上。",
      en: "**Goodhart's law**: once a number is used as a target, people start optimizing the number itself, so it stops reflecting what it was meant to measure.\n\nNamed after the economist Charles Goodhart, who described it for monetary policy in 1975. It's now quoted about KPIs of every kind.",
      translate: "**古德哈特定律**\n名词，经济学术语\n这里：指标一旦成为目标，就不再是好指标",
    },
  },
  {
    test: has("velocity"),
    answers: {
      zh: "这里的 **velocity** 不是物理里的“速度”，而是敏捷开发里的**迭代速率**：一个团队每个迭代完成的故事点数。\n\n作者的意思是：把大任务拆成很多小单子，完成的点数看起来变多了，交付并没有变快。",
      en: "Here **velocity** isn't physics. It's the agile term for how many story points a team finishes per sprint.\n\nSplitting one ticket into several makes the count go up without any more work getting done.",
      translate:
        "**迭代速率**\n名词 /vəˈlɒsəti/：速度；速率；（资金）流通速度\n这里：敏捷开发中团队每个迭代完成的工作量",
    },
  },
  {
    test: has("ceases to be"),
    answers: {
      zh: "**cease to be** 就是“不再是”，比 *stop being* 更书面。这里说的是：指标不再是一个好的衡量标准。",
      en: "**cease to be** means *stop being*, a little more formal. Here: the number stops being a good measure.",
      translate: "**不再是**\n动词短语 /siːs/：停止；不再\n这里：（指标）不再是（好的衡量标准）",
    },
  },
  {
    test: has("inflate"),
    answers: {
      zh: "**inflate** 这里是“人为抬高（数字）”，不是“充气”。拆单子让完成的点数变多，就是在虚增速率。",
      en: "**inflate** here means pushing a number up artificially, not filling something with air.",
      translate: "**虚增；抬高**\n动词 /ɪnˈfleɪt/：使膨胀；夸大；抬高（价格、数字）\n这里：人为地把数字做大",
    },
  },
];

const FALLBACK: Record<Lang, string> = {
  zh: "这是网页上的演示，只为上面那段示例文章准备了回答。\n\n下载点拨、接上你自己的模型后，在任何应用里划词都会得到真实的回答。",
  en: "This is a demo on a web page, with answers prepared only for the sample passage above.\n\nDownload Pointer and connect your own model to get real answers anywhere you select text.",
};

export const FOLLOW_UP_REPLY: Record<Lang, string> = {
  zh: "演示里的追问只有这一句预先写好的回答。真正的点拨会带着原文、上下文和前面的回答继续说。",
  en: "Follow-ups in this demo only get this one prepared reply. The real Pointer keeps the selection, its context and the earlier answers in mind.",
};

export function normalize(selection: string): string {
  return selection.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The prepared answer for a selection, or a note that this is only a demo. */
export function answerFor(selection: string, action: PromptActionId, lang: Lang): string {
  const s = normalize(selection);
  const entry = ENTRIES.find((e) => e.test(s));
  if (!entry) return FALLBACK[lang];
  return action === "translate" ? entry.answers.translate : entry.answers[lang];
}
