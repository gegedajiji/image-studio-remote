/**
 * 社交文案生成引擎（模板驱动）：
 * 从图像提示词中提取关键词，按平台（抖音/小红书）与语言（中/英/混合）
 * 生成标题、正文与标签。
 */

export type CopyPlatform = "douyin" | "xhs";
export type CopyLang = "zh" | "en" | "mixed";

export type GeneratedCopy = {
  title: string;
  body: string;
  tags: string[];
  platform: CopyPlatform;
  language: CopyLang;
};

const ZH_STOP = new Set([
  "的", "了", "和", "与", "在", "一个", "一种", "非常", "十分", "极其", "以及",
  "画面", "图片", "图像", "风格", "超高清", "高清", "细节", "质量", "大师", "杰作",
]);

const EN_STOP = new Set([
  "the", "a", "an", "and", "of", "in", "on", "with", "very", "highly", "ultra",
  "detailed", "quality", "style", "image", "picture", "photo", "masterpiece", "best",
]);

function extractKeywords(prompt: string, max = 5): string[] {
  const tokens = prompt
    .split(/[,，、。；;：:!！?？\n()（）\[\]【】"'"'""·|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (ZH_STOP.has(t) || EN_STOP.has(lower)) continue;
    if (t.length < 2 || t.length > 24) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
    if (out.length >= max) break;
  }
  return out.length ? out : ["AI 绘画"];
}

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const EMOJIS = ["✨", "🌌", "🎨", "💫", "🔮", "🌠", "🪐", "🎇"];

// ---------- 抖音 ----------
const DOUYIN_ZH = {
  titles: [
    (k: string[]) => `这也太美了吧！${k[0]}直接封神`,
    (k: string[]) => `AI 画的${k[0]}，我直接看呆了`,
    (k: string[]) => `一句话让 AI 画出${k[0]}，效果炸裂`,
    (k: string[]) => `${k[0]}｜这居然是用一句话生成的？`,
  ],
  bodies: [
    (k: string[]) =>
      `救命，这个画面我循环看了十遍。\n\n提示词就一句话：${k.slice(0, 3).join("，")}。\n\nAI 的想象力真的已经没有边界了，你们觉得怎么样？`,
    (k: string[]) =>
      `把脑海里的画面交给 AI，三秒之后我沉默了。\n\n${k[0]}的氛围感直接拉满，每一帧都能当壁纸。\n\n想要的提示词我放评论区了。`,
    (k: string[]) =>
      `不用画笔，只用文字，也能拥有这样的${k[0]}。\n\nAI 生图真的太上头了，细节、光影、构图全都在线。\n\n你输入一句话，它给你一个世界。`,
  ],
  tags: (k: string[]) => ["AI绘画", "AI生图", ...k.slice(0, 3), "壁纸", "视觉震撼", "数字艺术"],
};

const XHS_ZH = {
  titles: [
    (k: string[]) => `${pick(EMOJIS)} ${k[0]}｜把梦境画出来了`,
    (k: string[]) => `${pick(EMOJIS)} 被问爆的${k[0]}，附提示词`,
    (k: string[]) => `${pick(EMOJIS)} 一眼沦陷的${k[0]}，AI 太会了`,
    (k: string[]) => `${pick(EMOJIS)} ${k[0]}氛围感壁纸，美到失语`,
  ],
  bodies: [
    (k: string[]) =>
      `姐妹们快看我发现了什么！\n\n用一句话就生成了这张${k[0]}，质感细腻到不像话，随手一截都是壁纸级别。\n\n📝 提示词关键词：${k.slice(0, 4).join(" / ")}\n\n喜欢这种风格的快收藏，后续还会继续更新同系列～`,
    (k: string[]) =>
      `今日份的视觉暴击已送达 ${pick(EMOJIS)}\n\n${k[0]}的光影处理真的绝了，氛围感拿捏得死死的。\n\n🔑 关键词：${k.slice(0, 4).join("、")}\n\n建议保存原图当壁纸，清晰度完全够用！`,
    (k: string[]) =>
      `把想象交给 AI，它真的会还你一个惊喜。\n\n这次试了「${k.slice(0, 3).join("，")}」的组合，出来的效果比想象中惊艳太多。\n\n同款教程在路上了，先码住这篇！`,
  ],
  tags: (k: string[]) => ["AI绘画", "prompt分享", ...k.slice(0, 3), "手机壁纸", "氛围感", "审美积累"],
};

const DOUYIN_EN = {
  titles: [
    (k: string[]) => `This ${k[0]} broke my brain 🤯`,
    (k: string[]) => `One prompt. This ${k[0]}. Unreal.`,
    (k: string[]) => `AI turned my words into ${k[0]}`,
    (k: string[]) => `POV: AI paints ${k[0]} for you`,
  ],
  bodies: [
    (k: string[]) =>
      `I typed one sentence and got THIS.\n\nPrompt vibes: ${k.slice(0, 3).join(", ")}.\n\nAI imagination has no limits anymore. Rate it 1-10 👇`,
    (k: string[]) =>
      `Gave AI my daydream, got back a masterpiece.\n\nThe ${k[0]} atmosphere is unreal — every frame is wallpaper material.\n\nPrompt in the comments!`,
    (k: string[]) =>
      `No brush, just words — and this ${k[0]} appeared.\n\nDetails, lighting, composition — all on point.\n\nYou type a sentence, it builds a world.`,
  ],
  tags: (k: string[]) => ["AIart", "AIgenerated", ...k.slice(0, 3).map((t) => t.replace(/\s+/g, "")), "wallpaper", "digitalart"],
};

const XHS_EN = {
  titles: [
    (k: string[]) => `${pick(EMOJIS)} ${k[0]} — straight out of a dream`,
    (k: string[]) => `${pick(EMOJIS)} Everyone asked about this ${k[0]} (prompt inside)`,
    (k: string[]) => `${pick(EMOJIS)} Falling for this ${k[0]}, AI is magic`,
    (k: string[]) => `${pick(EMOJIS)} ${k[0]} vibes, wallpaper of the day`,
  ],
  bodies: [
    (k: string[]) =>
      `Look what I just made with ONE sentence!\n\nThis ${k[0]} is so detailed it's basically a wallpaper factory.\n\n📝 Prompt keywords: ${k.slice(0, 4).join(" / ")}\n\nSave it if you love this style — a full series is coming!`,
    (k: string[]) =>
      `Daily dose of visual magic ${pick(EMOJIS)}\n\nThe lighting on this ${k[0]} is unreal, pure atmosphere.\n\n🔑 Keywords: ${k.slice(0, 4).join(", ")}\n\nSave the HD original, it's phone-wallpaper ready!`,
    (k: string[]) =>
      `Hand your imagination to AI, it hands back a surprise.\n\nTried 「${k.slice(0, 3).join(" + ")}」 and the result blew me away.\n\nTutorial dropping soon — bookmark this one!`,
  ],
  tags: (k: string[]) => ["AIart", "promptshare", ...k.slice(0, 3).map((t) => t.replace(/\s+/g, "")), "wallpaper", "aesthetic"],
};

export function generateCopy(prompt: string, platform: CopyPlatform, language: CopyLang): GeneratedCopy {
  const keywords = extractKeywords(prompt);

  const zhPack = platform === "douyin" ? DOUYIN_ZH : XHS_ZH;
  const enPack = platform === "douyin" ? DOUYIN_EN : XHS_EN;

  if (language === "zh") {
    return {
      title: pick(zhPack.titles)(keywords),
      body: pick(zhPack.bodies)(keywords),
      tags: zhPack.tags(keywords).map((t) => `#${t}`),
      platform,
      language,
    };
  }
  if (language === "en") {
    return {
      title: pick(enPack.titles)(keywords),
      body: pick(enPack.bodies)(keywords),
      tags: enPack.tags(keywords).map((t) => `#${t}`),
      platform,
      language,
    };
  }
  // 中英混合：中文标题正文 + 英文标签 + 英文金句
  return {
    title: pick(zhPack.titles)(keywords),
    body: `${pick(zhPack.bodies)(keywords)}\n\n${pick(enPack.titles)(keywords)}`,
    tags: [
      ...zhPack.tags(keywords).slice(0, 3).map((t) => `#${t}`),
      ...enPack.tags(keywords).slice(0, 3).map((t) => `${t}`),
    ],
    platform,
    language,
  };
}
