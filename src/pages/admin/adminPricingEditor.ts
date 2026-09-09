export const ADMIN_DEFAULT_MODEL = "gpt-image-2.5-sunburst";
export const IMAGE_2_MODEL = "gpt-image-2";

const IMAGE_2_5_MODELS = new Set([
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
]);

const KNOWN_MODEL_LABELS: Record<string, string> = {
  "gpt-image-2": "GPT Image 2",
  "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
  "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
};

const KNOWN_MODEL_ORDER = new Map([
  ["gpt-image-2.5-sunburst", 0],
  ["gpt-image-2.5-flare", 1],
  ["gpt-image-2", 2],
]);

const KNOWN_RESOLUTIONS = new Map([
  ["1024x1024", { order: 0, shortLabel: "1K", label: "1K 1024×1024" }],
  ["2048x2048", { order: 1, shortLabel: "2K", label: "2K 2048×2048" }],
  ["1024x1536", { order: 2, shortLabel: "竖版", label: "竖版 1024×1536" }],
  ["4096x4096", { order: 3, shortLabel: "4K", label: "4K 4096×4096" }],
]);

export type AdminPricingRow = {
  id: number;
  model: string;
  label: string;
  width: number;
  height: number;
  price: number;
  enabled: boolean;
};

export type AdminModelOption = {
  model: string;
  label: string;
  enabled: boolean;
};

export type AdminResolutionOption = {
  key: string;
  width: number;
  height: number;
  label: string;
  shortLabel: string;
  enabled: boolean;
  conflict: boolean;
  sourceRowIds: number[];
};

export type AdminPricingTarget =
  | { status: "ready"; row: AdminPricingRow }
  | { status: "missing"; message: string }
  | { status: "conflict"; message: string; rowIds: number[] };

export function isAdminImage25Model(model: string) {
  return IMAGE_2_5_MODELS.has(model);
}

export function getAdminModelLabel(model: string, fallbackLabel?: string) {
  const known = KNOWN_MODEL_LABELS[model];
  if (known) return known;
  const separator = fallbackLabel?.indexOf(" · ") ?? -1;
  const parsed =
    separator >= 0 ? fallbackLabel?.slice(0, separator) : fallbackLabel;
  return parsed?.trim() || model;
}

export function buildAdminModelOptions(
  rows: readonly AdminPricingRow[]
): AdminModelOption[] {
  const byModel = new Map<string, AdminModelOption>();
  for (const row of rows) {
    const existing = byModel.get(row.model);
    if (existing) {
      existing.enabled ||= row.enabled;
      continue;
    }
    byModel.set(row.model, {
      model: row.model,
      label: getAdminModelLabel(row.model, row.label),
      enabled: row.enabled,
    });
  }

  return [...byModel.values()].sort((a, b) => {
    const aOrder = KNOWN_MODEL_ORDER.get(a.model) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = KNOWN_MODEL_ORDER.get(b.model) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.label.localeCompare(b.label, "zh-CN");
  });
}

function resolutionLabels(row: AdminPricingRow) {
  const key = `${row.width}x${row.height}`;
  const known = KNOWN_RESOLUTIONS.get(key);
  if (known) return known;

  const detail = row.label.split(" · ").slice(1).join(" · ").trim();
  return {
    order: Number.MAX_SAFE_INTEGER,
    shortLabel: detail || `${row.width}×${row.height}`,
    label: detail || `${row.width}×${row.height}`,
  };
}

export function buildAdminResolutionOptions(
  rows: readonly AdminPricingRow[],
  model: string
): AdminResolutionOption[] {
  const sourceModel = isAdminImage25Model(model) ? IMAGE_2_MODEL : model;
  const grouped = new Map<string, AdminResolutionOption>();

  for (const row of rows) {
    if (row.model !== sourceModel) continue;
    const key = `${row.width}x${row.height}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.enabled ||= row.enabled;
      existing.conflict = true;
      existing.sourceRowIds.push(row.id);
      continue;
    }
    const labels = resolutionLabels(row);
    grouped.set(key, {
      key,
      width: row.width,
      height: row.height,
      label: labels.label,
      shortLabel: labels.shortLabel,
      enabled: row.enabled,
      conflict: false,
      sourceRowIds: [row.id],
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const aOrder =
      KNOWN_RESOLUTIONS.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder =
      KNOWN_RESOLUTIONS.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER;
    return (
      aOrder - bOrder ||
      a.width * a.height - b.width * b.height ||
      a.width - b.width ||
      a.height - b.height
    );
  });
}

export function resolveAdminPricingTarget(
  rows: readonly AdminPricingRow[],
  model: string,
  width: number,
  height: number
): AdminPricingTarget {
  const candidates = rows.filter(row =>
    isAdminImage25Model(model)
      ? row.model === model
      : row.model === model && row.width === width && row.height === height
  );

  if (candidates.length === 0) {
    return {
      status: "missing",
      message: isAdminImage25Model(model)
        ? "该模型尚未创建统一价格项"
        : "该模型与分辨率尚未创建价格项",
    };
  }
  if (candidates.length > 1) {
    return {
      status: "conflict",
      message: isAdminImage25Model(model)
        ? "该 Image 2.5 模型存在多条价格项，请在高级管理中处理"
        : "该模型与分辨率存在重复价格项，请在高级管理中处理",
      rowIds: candidates.map(row => row.id),
    };
  }
  return { status: "ready", row: candidates[0] };
}

export function parseAdminPriceDraft(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isSafeInteger(price) ? price : null;
}
