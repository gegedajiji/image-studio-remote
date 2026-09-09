import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ModelPricing } from "@contracts/types";
import { cn } from "@/lib/utils";
import {
  ADMIN_DEFAULT_MODEL,
  buildAdminModelOptions,
  buildAdminResolutionOptions,
  getAdminModelLabel,
  isAdminImage25Model,
  parseAdminPriceDraft,
  resolveAdminPricingTarget,
} from "./adminPricingEditor";

type FormState = {
  id?: number;
  model: string;
  label: string;
  width: string;
  height: string;
  price: string;
  enabled: boolean;
};

const EMPTY: FormState = {
  model: "dream-v1",
  label: "",
  width: "1024",
  height: "1024",
  price: "10",
  enabled: true,
};

function parseDimension(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const dimension = Number(normalized);
  return Number.isInteger(dimension) && dimension >= 64 && dimension <= 4096
    ? dimension
    : null;
}

function advancedSizeLabel(pricing: ModelPricing) {
  if (isAdminImage25Model(pricing.model)) {
    return (
      <div>
        <div className="font-medium text-slate-600">1K / 2K / 竖版 / 4K</div>
        <div className="mt-0.5 text-xs text-sky-600">全尺寸统一价</div>
      </div>
    );
  }
  return (
    <span className="tabular-nums text-slate-500">
      {pricing.width}×{pricing.height}
    </span>
  );
}

export default function AdminPricing() {
  const utils = trpc.useUtils();
  const listQuery = trpc.admin.pricing.list.useQuery();
  const [editorModel, setEditorModel] = useState(ADMIN_DEFAULT_MODEL);
  const [editorResolutionKey, setEditorResolutionKey] = useState("1024x1024");
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<ModelPricing | null>(null);

  const rows = listQuery.data ?? [];
  const modelOptions = useMemo(
    () => buildAdminModelOptions(listQuery.data ?? []),
    [listQuery.data]
  );
  const activeEditorModel = modelOptions.some(
    option => option.model === editorModel
  )
    ? editorModel
    : (modelOptions[0]?.model ?? editorModel);
  const resolutionOptions = useMemo(
    () => buildAdminResolutionOptions(listQuery.data ?? [], activeEditorModel),
    [activeEditorModel, listQuery.data]
  );

  const selectedModel = modelOptions.find(
    option => option.model === activeEditorModel
  );
  const selectedResolution =
    resolutionOptions.find(option => option.key === editorResolutionKey) ??
    resolutionOptions[0];
  const resolvedPricingTarget = selectedResolution
    ? resolveAdminPricingTarget(
        rows,
        activeEditorModel,
        selectedResolution.width,
        selectedResolution.height
      )
    : null;
  const pricingTarget = selectedResolution?.conflict
    ? {
        status: "conflict" as const,
        message: isAdminImage25Model(activeEditorModel)
          ? "该共享分辨率存在重复价格项，请在高级管理中处理"
          : "该模型与分辨率存在重复价格项，请在高级管理中处理",
        rowIds: selectedResolution.sourceRowIds,
      }
    : resolvedPricingTarget;
  const priceDraft =
    pricingTarget?.status === "ready"
      ? (priceDrafts[pricingTarget.row.id] ?? String(pricingTarget.row.price))
      : "";

  const invalidate = () => {
    void utils.admin.pricing.list.invalidate();
    void utils.generation.pricing.invalidate();
  };

  const createMutation = trpc.admin.pricing.create.useMutation({
    onSuccess: () => {
      toast.success("价格项已创建");
      setDialogOpen(false);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const fullUpdateMutation = trpc.admin.pricing.update.useMutation({
    onSuccess: (_data, variables) => {
      setPriceDrafts(current => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      toast.success("价格项已保存");
      setDialogOpen(false);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const priceMutation = trpc.admin.pricing.updatePrice.useMutation({
    onSuccess: (_data, variables) => {
      setPriceDrafts(current => {
        if (current[variables.id] !== String(variables.price)) return current;
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      toast.success("对应价格已保存");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const enabledMutation = trpc.admin.pricing.updateEnabled.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.enabled ? "价格项已启用" : "价格项已停用");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const removeMutation = trpc.admin.pricing.remove.useMutation({
    onSuccess: (_data, variables) => {
      setPriceDrafts(current => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      toast.success("已删除");
      setDeleteTarget(null);
      invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const handleModelChange = (model: string) => {
    setEditorModel(model);
    const nextResolutions = buildAdminResolutionOptions(rows, model);
    const currentResolutionKey = selectedResolution?.key ?? editorResolutionKey;
    const matchingResolution = nextResolutions.find(
      option => option.key === currentResolutionKey
    );
    setEditorResolutionKey(
      matchingResolution?.key ?? nextResolutions[0]?.key ?? ""
    );
  };

  const saveSelectedPrice = () => {
    if (pricingTarget?.status !== "ready") return;
    const price = parseAdminPriceDraft(priceDraft);
    if (price === null) {
      toast.error("价格须为非负整数");
      return;
    }
    priceMutation.mutate({ id: pricingTarget.row.id, price });
  };

  const openEdit = (pricing: ModelPricing) => {
    const image25 = isAdminImage25Model(pricing.model);
    setForm({
      id: pricing.id,
      model: pricing.model,
      label: pricing.label,
      width: String(image25 ? 1536 : pricing.width),
      height: String(image25 ? 1024 : pricing.height),
      price: String(pricing.price),
      enabled: pricing.enabled,
    });
    setDialogOpen(true);
  };

  const submitAdvancedForm = () => {
    const model = form.model.trim();
    const label = form.label.trim();
    const image25 = isAdminImage25Model(model);
    const width = image25 ? 1536 : parseDimension(form.width);
    const height = image25 ? 1024 : parseDimension(form.height);
    const price = parseAdminPriceDraft(form.price);
    if (!model || !label) {
      toast.error("请填写模型与显示名称");
      return;
    }
    if (width === null || height === null) {
      toast.error("宽高须为 64 到 4096 的整数");
      return;
    }
    if (price === null) {
      toast.error("价格须为非负整数");
      return;
    }
    if (form.id) {
      fullUpdateMutation.mutate({
        id: form.id,
        label,
        width,
        height,
        price,
        enabled: form.enabled,
      });
    } else {
      createMutation.mutate({ model, label, width, height, price });
    }
  };

  const advancedSaving =
    createMutation.isPending || fullUpdateMutation.isPending;
  const isImage25 = isAdminImage25Model(activeEditorModel);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">生图价格</h2>
        <p className="text-sm text-slate-500">
          选择工作台中的模型和分辨率，再修改它对应的生成积分
        </p>
      </div>

      <section className="glass-card relative overflow-hidden rounded-2xl border border-sky-200/80 p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/70 to-transparent" />
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-600 shadow-sm">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">工作台价格配置器</h3>
              <p className="text-xs text-slate-500">
                所见选项与用户创作工作台保持同步
              </p>
            </div>
          </div>
          {pricingTarget?.status === "ready" && (
            <Badge className="w-fit border-amber-300/80 bg-amber-50 px-3 py-1 text-amber-700 shadow-none">
              当前 {pricingTarget.row.price} 积分 / 张
            </Badge>
          )}
        </div>

        {listQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-sky-500" />
            正在读取价格配置
          </div>
        ) : modelOptions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center text-sm text-slate-500">
            暂无价格配置，请在高级价格项管理中新增。
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(180px,0.72fr)]">
              <div className="min-w-0">
                <Label className="mb-2 block text-xs font-medium uppercase tracking-widest text-sky-600">
                  选择模型
                </Label>
                <Select
                  value={activeEditorModel}
                  onValueChange={handleModelChange}
                >
                  <SelectTrigger
                    aria-label="选择模型"
                    className="workspace-select-trigger holo-input"
                  >
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent className="workspace-select-content holo-panel z-[70]">
                    {modelOptions.map(option => (
                      <SelectItem
                        key={option.model}
                        value={option.model}
                        className="workspace-select-item"
                      >
                        <span>{option.label}</span>
                        {!option.enabled && (
                          <span className="ml-2 text-xs text-slate-400">
                            已停用
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label className="mb-2 block text-xs font-medium uppercase tracking-widest text-sky-600">
                  选择分辨率
                </Label>
                <Select
                  value={selectedResolution?.key}
                  onValueChange={setEditorResolutionKey}
                  disabled={resolutionOptions.length === 0}
                >
                  <SelectTrigger
                    aria-label="选择分辨率"
                    className="workspace-select-trigger holo-input tabular-nums"
                  >
                    <SelectValue placeholder="选择分辨率" />
                  </SelectTrigger>
                  <SelectContent className="workspace-select-content holo-panel z-[70]">
                    {resolutionOptions.map(option => (
                      <SelectItem
                        key={option.key}
                        value={option.key}
                        className="workspace-select-item tabular-nums"
                      >
                        <span>{option.label}</span>
                        {!option.enabled && (
                          <span className="ml-2 text-xs text-slate-400">
                            已停用
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <Label
                  htmlFor="selected-price"
                  className="mb-2 block text-xs font-medium uppercase tracking-widest text-sky-600"
                >
                  对应价格
                </Label>
                <div className="relative">
                  <Input
                    id="selected-price"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={priceDraft}
                    onChange={event => {
                      if (pricingTarget?.status !== "ready") return;
                      const value = event.target.value;
                      setPriceDrafts(current => ({
                        ...current,
                        [pricingTarget.row.id]: value,
                      }));
                    }}
                    disabled={
                      pricingTarget?.status !== "ready" ||
                      priceMutation.isPending
                    }
                    className="h-12 rounded-xl border-sky-300 bg-white/85 pr-14 font-semibold tabular-nums text-sky-700 shadow-sm focus-visible:border-sky-500 focus-visible:ring-sky-200"
                    aria-label="对应价格（积分）"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-medium text-slate-400">
                    积分
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50/80 via-white/70 to-cyan-50/70 px-4 py-3">
              {pricingTarget?.status === "ready" ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5 text-sm text-slate-600">
                    {isImage25 && selectedResolution?.enabled === false ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    <div>
                      <p className="font-medium text-slate-700">
                        {selectedModel?.label} · {selectedResolution?.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        {isImage25
                          ? "Image 2.5 按模型统一计价，四档分辨率共用这里设置的价格。"
                          : "本次只修改当前模型与当前分辨率组合的价格。"}
                      </p>
                      {isImage25 && selectedResolution?.enabled === false && (
                        <p className="mt-1 text-xs leading-relaxed text-amber-600">
                          这档共享分辨率当前已停用；右侧可恢复，并会同步到 Image
                          2、Flare 和 Sunburst。
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:w-auto sm:flex-col sm:items-end">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-[420px]:justify-end">
                      {isImage25 && (
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <Switch
                            checked={pricingTarget.row.enabled}
                            disabled={enabledMutation.isPending}
                            onCheckedChange={enabled =>
                              enabledMutation.mutate({
                                id: pricingTarget.row.id,
                                enabled,
                              })
                            }
                          />
                          启用此模型
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <Switch
                          checked={
                            isImage25
                              ? (selectedResolution?.enabled ?? false)
                              : pricingTarget.row.enabled
                          }
                          disabled={
                            enabledMutation.isPending ||
                            (isImage25 &&
                              selectedResolution?.sourceRowIds.length !== 1)
                          }
                          onCheckedChange={enabled =>
                            enabledMutation.mutate({
                              id: isImage25
                                ? selectedResolution!.sourceRowIds[0]
                                : pricingTarget.row.id,
                              enabled,
                            })
                          }
                        />
                        {isImage25 ? "启用此共享分辨率" : "启用此分辨率"}
                      </label>
                    </div>
                    <Button
                      onClick={saveSelectedPrice}
                      disabled={
                        priceMutation.isPending ||
                        parseAdminPriceDraft(priceDraft) === null
                      }
                      className="w-full border-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white shadow-md shadow-sky-200/60 min-[420px]:w-auto"
                    >
                      {priceMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      保存价格
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 text-sm text-amber-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      {pricingTarget?.message ?? "该模型暂无可选择的分辨率"}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-600">
                      请展开下方高级价格项管理补充或清理配置。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/60 shadow-sm backdrop-blur-xl">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/70"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen(open => !open)}
        >
          <div>
            <h3 className="font-semibold text-slate-700">高级价格项管理</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              管理原始价格记录、显示名称和自定义模型
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-slate-400 transition-transform",
              advancedOpen && "rotate-180"
            )}
          />
        </button>

        {advancedOpen && (
          <div className="border-t border-slate-200/80">
            <div className="flex items-center justify-end bg-white/40 px-4 py-3">
              <Button
                size="sm"
                className="border-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white"
                onClick={() => {
                  setForm(EMPTY);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                新增自定义价格项
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-white/70 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">显示名称</th>
                    <th className="px-4 py-3 font-medium">模型</th>
                    <th className="px-4 py-3 font-medium">分辨率</th>
                    <th className="px-4 py-3 font-medium">价格</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(pricing => (
                    <tr
                      key={pricing.id}
                      className="border-b border-slate-200/60 last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {isAdminImage25Model(pricing.model)
                          ? getAdminModelLabel(pricing.model, pricing.label)
                          : pricing.label}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {pricing.model}
                      </td>
                      <td className="px-4 py-3">
                        {advancedSizeLabel(pricing)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="border-amber-300/80 bg-amber-50 text-amber-700 shadow-none">
                          {pricing.price} 积分
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={pricing.enabled}
                          disabled={enabledMutation.isPending}
                          onCheckedChange={enabled =>
                            enabledMutation.mutate({ id: pricing.id, enabled })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            aria-label={`编辑 ${pricing.label}`}
                            onClick={() => openEdit(pricing)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`删除 ${pricing.label}`}
                            onClick={() => setDeleteTarget(pricing)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-12 text-center text-slate-400"
                      >
                        暂无价格配置
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-slate-200 bg-white text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "编辑价格项" : "新增价格项"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!form.id && (
              <div className="grid gap-2">
                <Label htmlFor="pricing-model">模型标识</Label>
                <Input
                  id="pricing-model"
                  value={form.model}
                  onChange={event => {
                    const model = event.target.value;
                    setForm(current => ({
                      ...current,
                      model,
                      ...(isAdminImage25Model(model.trim())
                        ? { width: "1536", height: "1024" }
                        : {}),
                    }));
                  }}
                  placeholder="与上游配置的模型一致"
                  className="border-slate-300 bg-white font-mono"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="pricing-label">显示名称</Label>
              <Input
                id="pricing-label"
                value={form.label}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="例如：自定义模型 · 1K 1024×1024"
                className="border-slate-300 bg-white"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="pricing-width">宽</Label>
                <Input
                  id="pricing-width"
                  type="text"
                  inputMode="numeric"
                  value={form.width}
                  disabled={isAdminImage25Model(form.model.trim())}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      width: event.target.value,
                    }))
                  }
                  className="border-slate-300 bg-white tabular-nums"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pricing-height">高</Label>
                <Input
                  id="pricing-height"
                  type="text"
                  inputMode="numeric"
                  value={form.height}
                  disabled={isAdminImage25Model(form.model.trim())}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      height: event.target.value,
                    }))
                  }
                  className="border-slate-300 bg-white tabular-nums"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pricing-price">价格</Label>
                <Input
                  id="pricing-price"
                  type="text"
                  inputMode="numeric"
                  value={form.price}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      price: event.target.value,
                    }))
                  }
                  className="border-slate-300 bg-white tabular-nums"
                />
              </div>
            </div>
            {form.id && (
              <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-600">
                启用此价格项
                <Switch
                  checked={form.enabled}
                  onCheckedChange={enabled =>
                    setForm(current => ({ ...current, enabled }))
                  }
                />
              </label>
            )}
            {isAdminImage25Model(form.model.trim()) && (
              <div className="flex gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-700">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                Image 2.5 使用模型统一价；1536×1024
                仅作为内部价格基准，用户仍可选择四档分辨率。
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-300"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="border-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-fuchsia-600 text-white"
              disabled={advancedSaving}
              onClick={submitAdvancedForm}
            >
              {advancedSaving && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <DialogContent className="border-slate-200 bg-white text-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除价格项</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            确定删除「{deleteTarget?.label}
            」吗？用户将不能再选择该配置生成图片。
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-300"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-500"
              disabled={removeMutation.isPending}
              onClick={() =>
                deleteTarget && removeMutation.mutate({ id: deleteTarget.id })
              }
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
