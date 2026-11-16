export const SHARED_IMAGE_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
] as const;

export const IMAGE_2_SIZE_SOURCE_MODEL = "gpt-image-2";

export type SharedImageModel = (typeof SHARED_IMAGE_MODELS)[number];

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

export function isSharedImageModel(model: unknown): model is SharedImageModel {
  return (SHARED_IMAGE_MODELS as readonly unknown[]).includes(model);
}

function isValidDimension(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 64 && Number(value) <= 4096
  );
}

/**
 * Resolve the size sent to an image upstream without changing the pricing row.
 * Shared image models may override their pricing baseline only with a complete
 * width/height pair exposed by an enabled Image 2 price.
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

  if (!isSharedImageModel(pricing.model)) {
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
