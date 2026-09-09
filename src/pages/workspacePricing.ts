export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst";

export const IMAGE25_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;

const IMAGE2_SIZE_SOURCE_MODEL = "gpt-image-2";
const IMAGE25_BASELINE_WIDTH = 1536;
const IMAGE25_BASELINE_HEIGHT = 1024;

export type PricingOption = {
  id: number;
  model: string;
  label: string;
  width: number;
  height: number;
  price: number;
  enabled?: boolean;
};

export type ModelOption = {
  model: string;
  label: string;
};

export function isImage25Model(
  model: string
): model is (typeof IMAGE25_MODELS)[number] {
  return (IMAGE25_MODELS as readonly string[]).includes(model);
}

function isEnabled(row: PricingOption) {
  return row.enabled !== false;
}

function modelLabel(row: PricingOption) {
  const separator = row.label.indexOf(" · ");
  const label = separator >= 0 ? row.label.slice(0, separator) : row.label;
  return label.trim() || row.model;
}

export function buildModelOptions(
  rows: readonly PricingOption[]
): ModelOption[] {
  const byModel = new Map<string, ModelOption>();

  for (const row of rows) {
    if (!isEnabled(row) || byModel.has(row.model)) continue;
    byModel.set(row.model, { model: row.model, label: modelLabel(row) });
  }

  const options = [...byModel.values()];
  const preferredIndex = options.findIndex(
    option => option.model === DEFAULT_IMAGE_MODEL
  );
  if (preferredIndex > 0) {
    const [preferred] = options.splice(preferredIndex, 1);
    options.unshift(preferred);
  }
  return options;
}

const KNOWN_RESOLUTION_ORDER = new Map([
  ["1024x1024", 0],
  ["2048x2048", 1],
  ["1024x1536", 2],
  ["4096x4096", 3],
]);

function compareResolution(a: PricingOption, b: PricingOption) {
  const aKey = `${a.width}x${a.height}`;
  const bKey = `${b.width}x${b.height}`;
  const aRank = KNOWN_RESOLUTION_ORDER.get(aKey) ?? Number.MAX_SAFE_INTEGER;
  const bRank = KNOWN_RESOLUTION_ORDER.get(bKey) ?? Number.MAX_SAFE_INTEGER;

  return (
    aRank - bRank ||
    a.width * a.height - b.width * b.height ||
    a.width - b.width ||
    a.height - b.height ||
    a.id - b.id
  );
}

export function getResolutionOptions(
  rows: readonly PricingOption[],
  model: string
): PricingOption[] {
  const sourceModel = isImage25Model(model) ? IMAGE2_SIZE_SOURCE_MODEL : model;

  const ordered = rows
    .filter(row => isEnabled(row) && row.model === sourceModel)
    .slice()
    .sort(compareResolution);
  const unique = new Map<string, PricingOption>();
  for (const row of ordered) {
    const key = `${row.width}x${row.height}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

export function resolvePricingForModelAndSize(
  rows: readonly PricingOption[],
  model: string,
  width: number,
  height: number
): PricingOption | undefined {
  const modelRows = rows
    .filter(row => isEnabled(row) && row.model === model)
    .slice()
    .sort((a, b) => a.id - b.id);
  const exact = modelRows.find(
    row => row.width === width && row.height === height
  );
  if (exact) return exact;
  if (!isImage25Model(model)) return undefined;

  const sizeIsAvailable = getResolutionOptions(rows, model).some(
    row => row.width === width && row.height === height
  );
  if (!sizeIsAvailable) return undefined;

  return (
    modelRows.find(
      row =>
        row.width === IMAGE25_BASELINE_WIDTH &&
        row.height === IMAGE25_BASELINE_HEIGHT
    ) ?? modelRows[0]
  );
}
