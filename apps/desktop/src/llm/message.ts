/** Where the selection was read. Same fields as the native `Environment` payload. */
export interface MessageEnvironment {
  appName?: string | null;
  windowTitle?: string | null;
  url?: string | null;
  documentName?: string | null;
}

export interface FirstMessageInput {
  environment: MessageEnvironment | null;
  date: Date;
  contextBefore: string | null;
  selection: string;
  contextAfter: string | null;
}

/** CONTEXT.md 上下文 and the 发送窗口标题和网址 switch. */
export interface Disclosure {
  sendContext: boolean;
  sendWindowInfo: boolean;
}

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** docs/prompts.md — 第一条用户消息. Lines with no value are omitted. */
export function firstUserMessage(
  input: FirstMessageInput,
  disclosure: Disclosure = { sendContext: true, sendWindowInfo: true },
): string {
  const env = input.environment ?? {};
  const full = disclosure.sendContext && disclosure.sendWindowInfo;
  const tag = (name: string, value: string | null | undefined) => (value ? [`<${name}>${value}</${name}>`] : []);
  return [
    "<environment>",
    ...tag("app", env.appName),
    ...(full ? tag("window_title", env.windowTitle) : []),
    ...(full ? tag("url", env.url) : []),
    ...(full ? tag("document", env.documentName) : []),
    ...tag("date", formatDate(input.date)),
    "</environment>",
    ...(disclosure.sendContext ? tag("context_before", input.contextBefore) : []),
    ...tag("selection", input.selection),
    ...(disclosure.sendContext ? tag("context_after", input.contextAfter) : []),
  ].join("\n");
}
