export const IMAGE_2_5_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;

export const IMAGE_2_SIZE_SOURCE_MODEL = "gpt-image-2";

export type Image25Model = (typeof IMAGE_2_5_MODELS)[number];

type PricingDimensions = Readonly<{
  model: string;
  width: number;
  height: number;
}>;

type DimensionOverride = Readonly<{
  width?: unknown;
  height?: unknown;
}>;

type ImageDimensions = Readonly<{
  width: number;
  height: number;
}>;

export function isImage25Model(model: unknown): model is Image25Model {
  return model === "gpt-image-2.5-flare" || model === "gpt-image-2.5-sunburst";
}

function isValidDimension(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 64 && Number(value) <= 4096
  );
}

/**
 * Resolve the size sent to an image upstream without changing the pricing row.
 * Only the two exact Image 2.5 models may override their pricing baseline, and
 * only with a complete width/height pair exposed by an enabled Image 2 price.
 */
export function resolveGenerationDimensions(
  pricing: PricingDimensions,
  override: DimensionOverride,
  enabledImage2Sizes: readonly ImageDimensions[]
): ImageDimensions {
  const hasWidth = override.width !== undefined;
  const hasHeight = override.height !== undefined;

  if (!hasWidth && !hasHeight) {
    return { width: pricing.width, height: pricing.height };
  }

  if (
    !hasWidth ||
    !hasHeight ||
    !isValidDimension(override.width) ||
    !isValidDimension(override.height)
  ) {
    throw new Error("所选尺寸不可用");
  }

  const width = override.width;
  const height = override.height;
  if (width === pricing.width && height === pricing.height) {
    return { width, height };
  }

  if (!isImage25Model(pricing.model)) {
    throw new Error("所选尺寸不可用");
  }

  const isEnabledImage2Size = enabledImage2Sizes.some(
    size => size.width === width && size.height === height
  );
  if (!isEnabledImage2Size) {
    throw new Error("所选尺寸不可用");
  }

  return { width, height };
}
