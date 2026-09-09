import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE25_MODELS,
  buildModelOptions,
  getResolutionOptions,
  isImage25Model,
  resolvePricingForModelAndSize,
  type PricingOption,
} from "./workspacePricing";

const pricingRows: PricingOption[] = [
  {
    id: 4,
    model: "gpt-image-2",
    label: "GPT Image 2 · 4K 4096×4096",
    width: 4096,
    height: 4096,
    price: 20,
    enabled: true,
  },
  {
    id: 5,
    model: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare · 自适应画幅（请求基准） 1536×1024",
    width: 1536,
    height: 1024,
    price: 15,
    enabled: true,
  },
  {
    id: 2,
    model: "gpt-image-2",
    label: "GPT Image 2 · 2K 2048×2048",
    width: 2048,
    height: 2048,
    price: 10,
    enabled: true,
  },
  {
    id: 6,
    model: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst · 自适应画幅（请求基准） 1536×1024",
    width: 1536,
    height: 1024,
    price: 20,
    enabled: true,
  },
  {
    id: 3,
    model: "gpt-image-2",
    label: "GPT Image 2 · 竖版 1024×1536",
    width: 1024,
    height: 1536,
    price: 10,
    enabled: true,
  },
  {
    id: 1,
    model: "gpt-image-2",
    label: "GPT Image 2 · 1K 1024×1024",
    width: 1024,
    height: 1024,
    price: 10,
    enabled: true,
  },
];

describe("workspace pricing helpers", () => {
  it("uses the exact Sunburst model as the default and recognizes only Image 2.5 IDs", () => {
    expect(DEFAULT_IMAGE_MODEL).toBe("gpt-image-2.5-sunburst");
    expect(IMAGE25_MODELS).toEqual([
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
    ]);
    expect(isImage25Model("gpt-image-2.5-flare")).toBe(true);
    expect(isImage25Model("gpt-image-2.5-sunburst")).toBe(true);
    expect(isImage25Model("gpt-image-2")).toBe(false);
    expect(isImage25Model("gpt-image-2.5-sunburst-preview")).toBe(false);
  });

  it("deduplicates models and places Sunburst first", () => {
    const options = buildModelOptions(pricingRows);

    expect(options[0]).toEqual({
      model: "gpt-image-2.5-sunburst",
      label: "GPT Image 2.5 Sunburst",
    });
    expect(options.map(option => option.model)).toHaveLength(3);
    expect(new Set(options.map(option => option.model))).toEqual(
      new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
    );
  });

  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "reuses Image 2 resolutions for %s in stable display order",
    model => {
      expect(
        getResolutionOptions(pricingRows, model).map(row => [
          row.width,
          row.height,
        ])
      ).toEqual([
        [1024, 1024],
        [2048, 2048],
        [1024, 1536],
        [4096, 4096],
      ]);
    }
  );

  it("uses a non-Image-2.5 model's own resolutions", () => {
    const unknownRows: PricingOption[] = [
      {
        id: 8,
        model: "custom-image",
        label: "Custom Image · Large",
        width: 1600,
        height: 900,
        price: 8,
      },
      {
        id: 7,
        model: "custom-image",
        label: "Custom Image · Small",
        width: 800,
        height: 600,
        price: 5,
      },
    ];

    expect(
      getResolutionOptions(unknownRows, "custom-image").map(row => row.id)
    ).toEqual([7, 8]);
    expect(buildModelOptions(unknownRows)).toEqual([
      { model: "custom-image", label: "Custom Image" },
    ]);
  });

  it("omits disabled and duplicate source resolutions", () => {
    const rows: PricingOption[] = [
      ...pricingRows,
      { ...pricingRows[5], id: 10 },
      {
        id: 11,
        model: "gpt-image-2",
        label: "GPT Image 2 · Disabled 800×600",
        width: 800,
        height: 600,
        price: 10,
        enabled: false,
      },
    ];

    expect(
      getResolutionOptions(rows, "gpt-image-2.5-sunburst").map(
        row => `${row.width}x${row.height}`
      )
    ).toEqual(["1024x1024", "2048x2048", "1024x1536", "4096x4096"]);
  });

  it.each([
    ["gpt-image-2.5-flare", 15, 5],
    ["gpt-image-2.5-sunburst", 20, 6],
  ] as const)(
    "keeps %s at its fixed base price for every shared resolution",
    (model, price, pricingId) => {
      for (const resolution of getResolutionOptions(pricingRows, model)) {
        expect(
          resolvePricingForModelAndSize(
            pricingRows,
            model,
            resolution.width,
            resolution.height
          )
        ).toMatchObject({ id: pricingId, model, price });
      }
    }
  );

  it("resolves each legacy Image 2 size to its own price row", () => {
    expect(
      getResolutionOptions(pricingRows, "gpt-image-2").map(resolution => {
        const pricing = resolvePricingForModelAndSize(
          pricingRows,
          "gpt-image-2",
          resolution.width,
          resolution.height
        );
        return [
          resolution.width,
          resolution.height,
          pricing?.id,
          pricing?.price,
        ];
      })
    ).toEqual([
      [1024, 1024, 1, 10],
      [2048, 2048, 2, 10],
      [1024, 1536, 3, 10],
      [4096, 4096, 4, 20],
    ]);
  });

  it("does not borrow a fallback price for unsupported or unknown combinations", () => {
    expect(
      resolvePricingForModelAndSize(
        pricingRows,
        "gpt-image-2.5-sunburst",
        800,
        600
      )
    ).toBeUndefined();
    expect(
      resolvePricingForModelAndSize(pricingRows, "gpt-image-2", 1536, 1024)
    ).toBeUndefined();
    expect(
      resolvePricingForModelAndSize(
        pricingRows,
        "unknown-image-model",
        1024,
        1024
      )
    ).toBeUndefined();
  });

  it("returns empty results when no pricing data is available", () => {
    expect(buildModelOptions([])).toEqual([]);
    expect(getResolutionOptions([], DEFAULT_IMAGE_MODEL)).toEqual([]);
    expect(
      resolvePricingForModelAndSize([], DEFAULT_IMAGE_MODEL, 1024, 1024)
    ).toBeUndefined();
  });
});
