import { describe, expect, it } from "vitest";
import {
  IMAGE_2_5_MODELS,
  isImage25Model,
  resolveGenerationDimensions,
} from "./generationSize";

const enabledImage2Sizes = [
  { width: 1024, height: 1024 },
  { width: 2048, height: 2048 },
  { width: 1024, height: 1536 },
  { width: 4096, height: 4096 },
] as const;

const sunburstPricing = {
  id: 42,
  model: "gpt-image-2.5-sunburst",
  label: "GPT Image 2.5 Sunburst",
  width: 1536,
  height: 1024,
  price: 20,
  enabled: true,
} as const;

describe("Image 2.5 model matching", () => {
  it.each(IMAGE_2_5_MODELS)("accepts the exact %s model", model => {
    expect(isImage25Model(model)).toBe(true);
  });

  it.each([
    "gpt-image-2.5",
    "gpt-image-2",
    "gpt-image-2.5-flare-preview",
    "gpt-image-2.5-sunburst-extra",
    " gpt-image-2.5-sunburst",
    "GPT-IMAGE-2.5-SUNBURST",
    null,
    undefined,
  ])("rejects a non-exact model identifier: %s", model => {
    expect(isImage25Model(model)).toBe(false);
  });
});

describe("generation dimension resolution", () => {
  it("uses the pricing dimensions when no override is supplied", () => {
    expect(
      resolveGenerationDimensions(sunburstPricing, {}, enabledImage2Sizes)
    ).toEqual({ width: 1536, height: 1024 });
  });

  it("allows a complete override equal to the pricing size for any model", () => {
    const pricing = {
      model: "gpt-image-2",
      width: 1024,
      height: 1024,
      price: 10,
    } as const;

    expect(
      resolveGenerationDimensions(
        pricing,
        { width: 1024, height: 1024 },
        enabledImage2Sizes
      )
    ).toEqual({ width: 1024, height: 1024 });
  });

  it.each(IMAGE_2_5_MODELS)(
    "allows all enabled Image 2 sizes for %s",
    model => {
      for (const size of enabledImage2Sizes) {
        expect(
          resolveGenerationDimensions(
            { ...sunburstPricing, model },
            size,
            enabledImage2Sizes
          )
        ).toEqual(size);
      }
    }
  );

  it("does not mutate the pricing, override, or enabled-size inputs", () => {
    const pricing = Object.freeze({ ...sunburstPricing });
    const override = Object.freeze({ width: 2048, height: 2048 });
    const sizes = Object.freeze(
      enabledImage2Sizes.map(size => Object.freeze({ ...size }))
    );
    const before = {
      pricing: { ...pricing },
      override: { ...override },
      sizes: sizes.map(size => ({ ...size })),
    };

    expect(resolveGenerationDimensions(pricing, override, sizes)).toEqual({
      width: 2048,
      height: 2048,
    });
    expect({
      pricing: { ...pricing },
      override: { ...override },
      sizes: sizes.map(size => ({ ...size })),
    }).toEqual(before);
    expect(pricing.model).toBe("gpt-image-2.5-sunburst");
    expect(pricing.price).toBe(20);
  });

  it.each([
    "gpt-image-2",
    "gpt-image-2.5",
    "gpt-image-2.5-flare-preview",
    "gpt-image-2.5-sunburst-extra",
  ])("rejects size overrides for other models: %s", model => {
    expect(() =>
      resolveGenerationDimensions(
        { ...sunburstPricing, model },
        { width: 2048, height: 2048 },
        enabledImage2Sizes
      )
    ).toThrow("所选尺寸不可用");
  });

  it.each([
    [{ width: 1024 }, "width only"],
    [{ height: 1024 }, "height only"],
    [{ width: 1024.5, height: 1024 }, "fractional width"],
    [{ width: 1024, height: 1024.5 }, "fractional height"],
    [{ width: 0, height: 1024 }, "zero"],
    [{ width: 63, height: 1024 }, "below minimum"],
    [{ width: -1, height: 1024 }, "negative"],
    [{ width: 4097, height: 1024 }, "oversized width"],
    [{ width: 1024, height: 4097 }, "oversized height"],
    [{ width: "1024", height: 1024 }, "numeric string"],
    [{ width: "1024x1024", height: 1024 }, "concatenated string"],
    [{ width: Number.NaN, height: 1024 }, "NaN"],
    [{ width: Number.POSITIVE_INFINITY, height: 1024 }, "infinity"],
  ] as const)("rejects an invalid override: %s", (override, _description) => {
    void _description;
    expect(() =>
      resolveGenerationDimensions(sunburstPricing, override, enabledImage2Sizes)
    ).toThrow("所选尺寸不可用");
  });

  it("requires width and height to match the same enabled size pair", () => {
    expect(() =>
      resolveGenerationDimensions(
        sunburstPricing,
        { width: 2048, height: 1536 },
        enabledImage2Sizes
      )
    ).toThrow("所选尺寸不可用");
  });

  it("rejects a valid but disabled Image 2 size", () => {
    expect(() =>
      resolveGenerationDimensions(
        sunburstPricing,
        { width: 1280, height: 720 },
        enabledImage2Sizes
      )
    ).toThrow("所选尺寸不可用");
  });
});
