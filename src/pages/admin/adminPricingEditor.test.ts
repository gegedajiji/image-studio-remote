import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_MODEL,
  buildAdminModelOptions,
  buildAdminResolutionOptions,
  parseAdminPriceDraft,
  resolveAdminPricingTarget,
  type AdminPricingRow,
} from "./adminPricingEditor";

const rows: AdminPricingRow[] = [
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
    enabled: false,
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
    enabled: false,
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
  {
    id: 9,
    model: "disabled-custom",
    label: "Disabled Custom · 800×600",
    width: 800,
    height: 600,
    price: 8,
    enabled: false,
  },
];

describe("admin pricing editor helpers", () => {
  it("keeps disabled models visible and puts Sunburst first", () => {
    const options = buildAdminModelOptions(rows);
    expect(options[0].model).toBe(ADMIN_DEFAULT_MODEL);
    expect(
      options.find(option => option.model === "gpt-image-2.5-flare")
    ).toEqual({
      model: "gpt-image-2.5-flare",
      label: "GPT Image 2.5 Flare",
      enabled: false,
    });
    expect(
      options.find(option => option.model === "disabled-custom")?.enabled
    ).toBe(false);
  });

  it("marks a model enabled when any one of its rows is enabled", () => {
    const duplicateModelRows = [
      ...rows,
      {
        id: 10,
        model: "disabled-custom",
        label: "Disabled Custom · 1600×900",
        width: 1600,
        height: 900,
        price: 9,
        enabled: true,
      },
    ];

    expect(
      buildAdminModelOptions(duplicateModelRows).find(
        option => option.model === "disabled-custom"
      )
    ).toMatchObject({ enabled: true });
  });

  it("uses all Image 2 sizes for Image 2.5, including disabled sizes", () => {
    expect(
      buildAdminResolutionOptions(rows, ADMIN_DEFAULT_MODEL).map(option => ({
        key: option.key,
        enabled: option.enabled,
      }))
    ).toEqual([
      { key: "1024x1024", enabled: true },
      { key: "2048x2048", enabled: true },
      { key: "1024x1536", enabled: false },
      { key: "4096x4096", enabled: true },
    ]);
  });

  it.each([
    ["gpt-image-2.5-flare", 5, 15],
    ["gpt-image-2.5-sunburst", 6, 20],
  ] as const)(
    "maps every shared resolution for %s to one model price row",
    (model, id, price) => {
      for (const resolution of buildAdminResolutionOptions(rows, model)) {
        expect(
          resolveAdminPricingTarget(
            rows,
            model,
            resolution.width,
            resolution.height
          )
        ).toEqual({
          status: "ready",
          row: expect.objectContaining({ id, model, price }),
        });
      }
    }
  );

  it("keeps disabled price and resolution rows selectable for re-enabling", () => {
    expect(
      resolveAdminPricingTarget(rows, "gpt-image-2.5-flare", 1024, 1024)
    ).toEqual({
      status: "ready",
      row: expect.objectContaining({ id: 5, enabled: false }),
    });
    expect(resolveAdminPricingTarget(rows, "gpt-image-2", 1024, 1536)).toEqual({
      status: "ready",
      row: expect.objectContaining({ id: 3, enabled: false }),
    });
  });

  it("maps Image 2 dimensions to their exact independent rows", () => {
    expect(
      buildAdminResolutionOptions(rows, "gpt-image-2").map(option => {
        const target = resolveAdminPricingTarget(
          rows,
          "gpt-image-2",
          option.width,
          option.height
        );
        return [
          option.key,
          target.status === "ready" ? target.row.id : null,
          target.status === "ready" ? target.row.price : null,
        ];
      })
    ).toEqual([
      ["1024x1024", 1, 10],
      ["2048x2048", 2, 10],
      ["1024x1536", 3, 10],
      ["4096x4096", 4, 20],
    ]);
  });

  it("reports duplicate configurations instead of silently picking one", () => {
    const duplicateSize = { ...rows[5], id: 10, enabled: false };
    expect(
      buildAdminResolutionOptions([...rows, duplicateSize], "gpt-image-2").find(
        option => option.key === "1024x1024"
      )
    ).toMatchObject({
      enabled: true,
      conflict: true,
      sourceRowIds: [1, 10],
    });
    expect(
      resolveAdminPricingTarget(
        [...rows, duplicateSize],
        "gpt-image-2",
        1024,
        1024
      )
    ).toMatchObject({ status: "conflict", rowIds: [1, 10] });

    const duplicateModel = { ...rows[3], id: 11, width: 1024, height: 1024 };
    expect(
      resolveAdminPricingTarget(
        [...rows, duplicateModel],
        ADMIN_DEFAULT_MODEL,
        2048,
        2048
      )
    ).toMatchObject({ status: "conflict", rowIds: [6, 11] });
  });

  it("reports missing model-size and model-level price targets", () => {
    expect(
      resolveAdminPricingTarget(rows, "gpt-image-2", 800, 600)
    ).toMatchObject({ status: "missing" });
    expect(
      resolveAdminPricingTarget(
        rows.filter(row => row.model !== "gpt-image-2.5-sunburst"),
        ADMIN_DEFAULT_MODEL,
        1024,
        1024
      )
    ).toMatchObject({ status: "missing" });
  });

  it.each([
    ["20", 20],
    [" 0 ", 0],
    ["00015", 15],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ] as const)(
    "accepts the whole non-negative price draft %j",
    (draft, price) => {
      expect(parseAdminPriceDraft(draft)).toBe(price);
    }
  );

  it.each(["", "   ", "-1", "+1", "2.5", "1e3", "NaN", "Infinity"])(
    "rejects the invalid price draft %j",
    draft => {
      expect(parseAdminPriceDraft(draft)).toBeNull();
    }
  );

  it("rejects integers outside JavaScript's safe range", () => {
    expect(parseAdminPriceDraft("99999999999999999999")).toBeNull();
    expect(
      parseAdminPriceDraft(String(Number.MAX_SAFE_INTEGER + 1))
    ).toBeNull();
  });
});
