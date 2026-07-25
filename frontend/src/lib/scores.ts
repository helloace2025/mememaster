import type { Analysis, Token } from "./types";

export type ScoreItem = {
  id: string;
  label: string;
  score: number; // 0-10
  note: string;
  icon?: string;
};

export type ActionItem = {
  priority: "高" | "中" | "低";
  action: string;
};

/** Build actionable checklist for new-token design from benchmark analysis */
export function buildActionChecklist(
  token: { symbol: string },
  analysis: Analysis | null,
  scores: ScoreItem[]
): ActionItem[] {
  const items: ActionItem[] = [];
  const byId = Object.fromEntries(scores.map((s) => [s.id, s]));

  if ((byId.desire?.score ?? 0) < 7) {
    items.push({
      priority: "高",
      action: `3 秒锤不够尖：重写口令/主视觉，对标 ${token.symbol} 的情绪钩但换原创角色`,
    });
  } else {
    items.push({
      priority: "中",
      action: `保留「欲」的强度，换皮不换结构：拆解 ${token.symbol} 的身份句式再原创`,
    });
  }

  if ((byId.game?.score ?? 0) < 5) {
    items.push({
      priority: "高",
      action: "补一个真动作（墙/打卡/赛季/分润），避免只有 buy & hold",
    });
  }

  if ((byId.trust?.score ?? 0) < 6 || (byId.structure?.score ?? 0) < 6) {
    items.push({
      priority: "高",
      action: "信任三件套：锁仓规则 / dev 说明 / 干净发射，对标里风险项要避开",
    });
  }

  if ((byId.social?.score ?? 0) >= 6) {
    items.push({
      priority: "中",
      action: "抄其预热节奏：独立 X + ≥5 帖再 CA，内容日历先排 48h",
    });
  } else {
    items.push({
      priority: "中",
      action: "门面偏弱：先建独立 X 与单页站，再谈发射",
    });
  }

  if (analysis?.lesson_for_builder) {
    items.push({
      priority: "低",
      action: `可学结构：${analysis.lesson_for_builder.slice(0, 80)}${analysis.lesson_for_builder.length > 80 ? "…" : ""}`,
    });
  } else {
    items.push({
      priority: "低",
      action: "写一版 48h 内容日历（预热 3 帖 + 发射日口令 + 次日复盘）",
    });
  }

  return items.slice(0, 5);
}

/** Derive structure scores from on-chain fields + narrative analysis */
export function buildBenchmarkScores(
  token: Token,
  analysis: Analysis | null
): ScoreItem[] {
  const top10 = token.top_10_holder_rate;
  const rug = token.rug_ratio;
  const sm = Number(token.smart_degen_count || 0);
  const kol = Number(token.renowned_count || 0);
  const holders = Number(token.holder_count || 0);
  const creator = token.creator_token_status || "";

  // 持仓结构 0-10
  let structure = 6;
  const notes: string[] = [];
  if (top10 != null) {
    if (top10 < 0.2) structure += 2;
    else if (top10 < 0.35) structure += 1;
    else if (top10 > 0.5) structure -= 3;
    else if (top10 > 0.4) structure -= 1;
    notes.push(`Top10 ${(top10 * 100).toFixed(0)}%`);
  }
  if (rug != null) {
    if (rug > 0.3) structure -= 3;
    else if (rug > 0.15) structure -= 1;
    notes.push(`rug ${rug.toFixed(2)}`);
  }
  if (creator === "creator_close") structure += 1;
  if (creator === "creator_hold") structure -= 1;
  if (holders >= 500) structure += 1;
  else if (holders > 0 && holders < 50) structure -= 1;
  structure = clamp(structure, 0, 10);

  // 聪明钱 / 喊单热度（用 SM+KOL 代理「市场关注」，非投资建议）
  let attention = 3;
  if (sm >= 5) attention = 8;
  else if (sm >= 3) attention = 7;
  else if (sm >= 1) attention = 5;
  if (kol >= 3) attention = Math.min(10, attention + 2);
  else if (kol >= 1) attention = Math.min(10, attention + 1);
  const attNote = `SM ${sm} · KOL ${kol}`;

  // 叙事欲/局/信
  const desire = analysis?.desire?.score ?? 5;
  const game = analysis?.game?.score ?? 3;
  const trust = analysis?.trust?.score ?? structure;

  // 社媒门面
  let social = 3;
  if (token.twitter_status === "dead" || token.skip_research) {
    social = 1; // 已注销/乱码 ID：几乎无门面价值
  } else if (token.twitter_username) {
    social += 3;
  }
  if (token.website) social += 2;
  if (token.telegram) social += 1;
  social = clamp(social, 0, 10);

  // 综合可学性（新盘对标价值）
  const learn =
    Math.round(
      (Number(desire) * 0.3 +
        Number(game) * 0.15 +
        Number(trust) * 0.2 +
        structure * 0.2 +
        social * 0.15) *
        10
    ) / 10;

  const desireN = Number(desire) || 0;
  const gameN = Number(game) || 0;
  const trustN = Number(trust) || 0;

  return [
    {
      id: "structure",
      label: "持仓健康度",
      score: structure,
      note:
        (notes.join(" · ") || "数据不足") +
        " · 前十大是否过集中、有没有跑路观感",
      icon: "pie",
    },
    {
      id: "attention",
      label: "市场关注度",
      score: attention,
      note: attNote + " · 聪明钱/KOL 地址数（仅参考热度，不是喊单）",
      icon: "users",
    },
    {
      id: "desire",
      label: "吸引力",
      score: desireN,
      note:
        analysis?.desire?.note ||
        plainLevel(desireN, "想转发/当身份") ||
        analysis?.one_liner ||
        "—",
      icon: "spark",
    },
    {
      id: "game",
      label: "参与感",
      score: gameN,
      note:
        analysis?.game?.note ||
        plainLevel(gameN, "除了买入还有事可做") ||
        "—",
      icon: "play",
    },
    {
      id: "trust",
      label: "靠谱度",
      score: trustN,
      note:
        analysis?.trust?.note ||
        plainLevel(trustN, "像正规项目还是像跑路盘") ||
        "—",
      icon: "shield",
    },
    {
      id: "social",
      label: "社媒门面",
      score: social,
      note: [
        token.twitter_status === "dead"
          ? "X 已失效"
          : token.twitter_username
            ? `X @${token.twitter_username}`
            : "无 X",
        token.website ? "有官网" : "无官网",
      ].join(" · "),
      icon: "globe",
    },
    {
      id: "learn",
      label: "可学价值",
      score: clamp(learn, 0, 10),
      note: analysis?.verdict || "综合吸引力/参与感/靠谱度/持仓/门面",
      icon: "star",
    },
  ];
}

/** 0-10 → 通俗档位说明 */
function plainLevel(score: number, topic: string): string {
  if (score >= 7) return `强（${score}/10）：${topic}，值得学结构`;
  if (score >= 4) return `中（${score}/10）：${topic}，一般，需补强`;
  return `弱（${score}/10）：${topic}，结构不足`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
