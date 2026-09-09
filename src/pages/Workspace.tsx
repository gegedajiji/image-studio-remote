import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { SiteLayout } from "@/components/SiteLayout";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTypingSparks } from "@/components/effects/useTypingSparks";
import { ConvergingStars } from "@/components/effects/ConvergingStars";
import { burst, burstAtElement } from "@/lib/fx";
import {
  Wand2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Share2,
  Trash2,
  Loader2,
  ImageOff,
  Sparkles,
  Globe,
  Lock,
  X,
  AlertCircle,
  Terminal,
  ScanLine,
  Shapes,
  ImagePlus,
  Upload,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LOGIN_PATH } from "@/const";
import type { Generation } from "@contracts/types";
import {
  DEFAULT_IMAGE_MODEL,
  buildModelOptions,
  getResolutionOptions,
  resolvePricingForModelAndSize,
} from "./workspacePricing";

const REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const REFERENCE_IMAGE_COMPRESS_BYTES = 4 * 1024 * 1024;
const REFERENCE_IMAGE_MAX_EDGE = 2048;
const REFERENCE_IMAGE_MIN_EDGE = 64;
const REUSE_PROMPT_STORAGE_KEY = "mirage-reuse-prompt";
const REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const HISTORY_PAGE_SIZE = 12;

type ReferenceImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  size: number;
};

type WorkspaceNavigationState = {
  prompt?: unknown;
  model?: unknown;
  width?: unknown;
  height?: unknown;
};

function readStoredWorkspaceState(): WorkspaceNavigationState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(REUSE_PROMPT_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return parsed as WorkspaceNavigationState;
      }
    } catch {
      // Support the prompt-only value written by older builds.
      return { prompt: stored };
    }
  } catch {
    // Ignore storage restrictions and keep the console empty.
  }
  return null;
}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Invalid image data"));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error("Could not encode image")),
      "image/webp",
      0.9
    );
  });
}

function formatImageSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HoloCorners() {
  return (
    <>
      <span className="holo-corner holo-corner-tl" />
      <span className="holo-corner holo-corner-tr" />
      <span className="holo-corner holo-corner-bl" />
      <span className="holo-corner holo-corner-br" />
    </>
  );
}

export default function Workspace() {
  const { user, isLoading, isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const navigationState = location.state as WorkspaceNavigationState | null;
  const [storedWorkspaceState] = useState<WorkspaceNavigationState | null>(
    readStoredWorkspaceState
  );

  const [prompt, setPrompt] = useState(() => {
    const navigationPrompt =
      typeof navigationState?.prompt === "string" &&
      navigationState.prompt.trim()
        ? navigationState.prompt
        : null;
    if (navigationPrompt) return navigationPrompt;
    return typeof storedWorkspaceState?.prompt === "string"
      ? storedWorkspaceState.prompt
      : "";
  });
  const [negativePrompt, setNegativePrompt] = useState("");
  const [pricingId, setPricingId] = useState<number | null>(null);
  const [selectedResolutionKey, setSelectedResolutionKey] = useState<
    string | null
  >(null);
  const [preview, setPreview] = useState<Generation | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(
    null
  );
  const [referenceImageBusy, setReferenceImageBusy] = useState(false);
  const [isDraggingReference, setIsDraggingReference] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyCursors, setHistoryCursors] = useState<Array<number | null>>([
    null,
  ]);

  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const negativeRef = useRef<HTMLTextAreaElement | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const referenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [historyScrollState, setHistoryScrollState] = useState({
    canScrollPrev: false,
    canScrollNext: false,
  });

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("mirage-reuse-prompt");
    } catch {
      // Ignore storage restrictions after reading the pending prompt.
    }
  }, []);

  // 打字粒子火花
  useTypingSparks(promptRef);
  useTypingSparks(negativeRef);

  const pricingQuery = trpc.generation.pricing.useQuery();
  const historyCursor = historyCursors[historyPage] ?? null;
  const historyQuery = trpc.generation.myHistory.useQuery(
    { limit: HISTORY_PAGE_SIZE + 1, cursor: historyCursor },
    {
      enabled: isAuthenticated,
      placeholderData: previousData => previousData,
    }
  );
  const profileQuery = trpc.user.profile.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const navigationModel = navigationState?.model ?? storedWorkspaceState?.model;
  const navigationWidth = navigationState?.width ?? storedWorkspaceState?.width;
  const navigationHeight =
    navigationState?.height ?? storedWorkspaceState?.height;
  const navigationPricing =
    pricingQuery.data?.find(
      pricing =>
        typeof navigationModel === "string" &&
        pricing.model === navigationModel &&
        pricing.width === navigationWidth &&
        pricing.height === navigationHeight
    ) ??
    pricingQuery.data?.find(
      pricing =>
        typeof navigationModel === "string" && pricing.model === navigationModel
    );
  const defaultPricing =
    pricingQuery.data?.find(pricing => pricing.model === DEFAULT_IMAGE_MODEL) ??
    pricingQuery.data?.[0];
  const selected =
    pricingQuery.data?.find(p => p.id === pricingId) ??
    navigationPricing ??
    defaultPricing;
  const modelOptions = buildModelOptions(pricingQuery.data ?? []);
  const selectedModelLabel =
    modelOptions.find(option => option.model === selected?.model)?.label ??
    selected?.model;
  const resolutionOptions = getResolutionOptions(
    pricingQuery.data ?? [],
    selected?.model ?? ""
  );
  const navigationResolution = resolutionOptions.find(
    resolution =>
      resolution.width === navigationWidth &&
      resolution.height === navigationHeight
  );
  const selectedResolution =
    resolutionOptions.find(
      resolution =>
        `${resolution.width}x${resolution.height}` === selectedResolutionKey
    ) ??
    navigationResolution ??
    resolutionOptions[0];
  const historyRows = historyQuery.data?.slice(0, HISTORY_PAGE_SIZE) ?? [];
  const historyItems = historyRows.filter(
    generation =>
      generation.status === "success" && Boolean(generation.imageUrl)
  );
  const hasNextHistoryPage =
    historyQuery.data?.length === HISTORY_PAGE_SIZE + 1;
  const hasPreviousHistoryPage = historyPage > 0;
  const firstHistoryRowId = historyRows[0]?.id;

  useEffect(() => {
    const element = historyScrollRef.current;
    if (!element) {
      setHistoryScrollState({ canScrollPrev: false, canScrollNext: false });
      return;
    }

    const updateScrollState = () => {
      const firstCard = element.querySelector<HTMLElement>(
        "[data-history-card]"
      );
      const grid = firstCard?.parentElement;
      const rowGap = grid
        ? Number.parseFloat(getComputedStyle(grid).rowGap) || 12
        : 12;
      if (firstCard) {
        const cardHeight = Math.max(
          96,
          Math.ceil((element.clientHeight - rowGap * 3) / 3)
        );
        element.style.setProperty("--history-card-height", `${cardHeight}px`);
      }
      const maxScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight
      );
      const nextState = {
        canScrollPrev: element.scrollTop > 1,
        canScrollNext: element.scrollTop < maxScrollTop - 1,
      };
      setHistoryScrollState(current =>
        current.canScrollPrev === nextState.canScrollPrev &&
        current.canScrollNext === nextState.canScrollNext
          ? current
          : nextState
      );
    };

    element.scrollTop = 0;
    updateScrollState();
    element.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);
    return () => {
      element.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [historyItems.length, historyPage, firstHistoryRowId]);

  const scrollHistory = (direction: -1 | 1) => {
    const element = historyScrollRef.current;
    if (!element) return;
    const firstCard = element.querySelector<HTMLElement>("[data-history-card]");
    const rowGap = firstCard?.parentElement
      ? Number.parseFloat(getComputedStyle(firstCard.parentElement).rowGap) ||
        12
      : 12;
    const step = firstCard
      ? firstCard.offsetHeight + rowGap
      : Math.max(180, Math.round(element.clientHeight * 0.72));
    element.scrollBy({
      top: direction * step,
      behavior: "smooth",
    });
  };

  const resetHistoryPagination = () => {
    setHistoryPage(0);
    setHistoryCursors([null]);
    utils.generation.myHistory.invalidate();
  };

  const goToNextHistoryPage = () => {
    if (!hasNextHistoryPage || historyQuery.isFetching) return;
    const lastItem = historyRows[historyRows.length - 1];
    if (!lastItem) return;
    setHistoryCursors(cursors => [
      ...cursors.slice(0, historyPage + 1),
      lastItem.id,
    ]);
    setHistoryPage(page => page + 1);
  };

  const goToPreviousHistoryPage = () => {
    if (!hasPreviousHistoryPage || historyQuery.isFetching) return;
    setHistoryPage(page => Math.max(0, page - 1));
  };

  const generateMutation = trpc.generation.generate.useMutation({
    onSuccess: record => {
      toast.success(t("workspace.materialized"));
      setPreview(record);
      resetHistoryPagination();
      utils.user.profile.invalidate();
      // 出图爆发
      setTimeout(() => {
        burstAtElement(previewAreaRef.current, {
          count: 42,
          power: 5,
          life: 70,
          size: 2.4,
        });
      }, 350);
    },
    onError: err => {
      toast.error(err.message);
      utils.generation.myHistory.invalidate();
      utils.user.profile.invalidate();
    },
  });
  const hasRenderedPreview =
    Boolean(preview?.imageUrl) && !generateMutation.isPending;

  const togglePublicMutation = trpc.generation.togglePublic.useMutation({
    onSuccess: (_, vars) => {
      toast.success(
        vars.isPublic ? t("workspace.publishOk") : t("workspace.unpublishOk")
      );
      utils.generation.myHistory.invalidate();
    },
  });

  const removeMutation = trpc.generation.remove.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.deleted"));
      resetHistoryPagination();
      setPreview(null);
    },
  });

  const sendToCanvasMutation = trpc.canvas.addNode.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.sentToCanvas"));
    },
    onError: err => toast.error(err.message),
  });

  const sendToCanvas = (g: Generation) => {
    sendToCanvasMutation.mutate({
      type: "image",
      refId: g.id,
      title: g.prompt.slice(0, 60),
      x: 160 + Math.round(Math.random() * 360),
      y: 140 + Math.round(Math.random() * 260),
      w: 300,
    });
  };

  if (isLoading || !user) {
    return (
      <SiteLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      </SiteLayout>
    );
  }

  const quota = profileQuery.data?.quota ?? user.quota;

  const chooseReferenceImage = () => {
    if (generateMutation.isPending || referenceImageBusy) return;
    referenceImageInputRef.current?.click();
  };

  const prepareReferenceImage = async (file: File | undefined) => {
    if (!file || generateMutation.isPending || referenceImageBusy) return;
    if (!REFERENCE_IMAGE_TYPES.has(file.type)) {
      toast.error(t("workspace.invalidReferenceType"));
      return;
    }
    if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
      toast.error(t("workspace.referenceTooLarge"));
      return;
    }

    setReferenceImageBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        if (
          bitmap.width < REFERENCE_IMAGE_MIN_EDGE ||
          bitmap.height < REFERENCE_IMAGE_MIN_EDGE
        ) {
          toast.error(t("workspace.referenceTooSmall"));
          return;
        }

        let imageBlob: Blob = file;
        let width = bitmap.width;
        let height = bitmap.height;
        if (
          file.size > REFERENCE_IMAGE_COMPRESS_BYTES ||
          Math.max(bitmap.width, bitmap.height) > REFERENCE_IMAGE_MAX_EDGE
        ) {
          const scale = Math.min(
            1,
            REFERENCE_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height)
          );
          width = Math.max(1, Math.round(bitmap.width * scale));
          height = Math.max(1, Math.round(bitmap.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create image canvas");
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, width, height);
          imageBlob = await canvasToBlob(canvas);
        }

        setReferenceImage({
          dataUrl: await readAsDataUrl(imageBlob),
          name: file.name,
          width,
          height,
          size: imageBlob.size,
        });
      } finally {
        bitmap.close();
      }
    } catch {
      toast.error(t("workspace.referenceReadFailed"));
    } finally {
      setReferenceImageBusy(false);
      setIsDraggingReference(false);
    }
  };

  const handleGenerate = (e?: React.MouseEvent) => {
    if (!prompt.trim()) {
      toast.error(t("workspace.needPrompt"));
      return;
    }
    if (!selected || !selectedResolution) {
      toast.error(t("workspace.noConfig"));
      return;
    }
    if (e) burst({ x: e.clientX, y: e.clientY, count: 24, power: 4 });
    generateMutation.mutate({
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      pricingId: selected.id,
      width: selectedResolution.width,
      height: selectedResolution.height,
      referenceImageDataUrl: referenceImage?.dataUrl,
    });
  };

  const handleModelChange = (model: string) => {
    const nextResolutions = getResolutionOptions(
      pricingQuery.data ?? [],
      model
    );
    const nextResolution =
      nextResolutions.find(
        resolution =>
          resolution.width === selectedResolution?.width &&
          resolution.height === selectedResolution?.height
      ) ?? nextResolutions[0];
    if (!nextResolution) return;

    const nextPricing = resolvePricingForModelAndSize(
      pricingQuery.data ?? [],
      model,
      nextResolution.width,
      nextResolution.height
    );
    if (!nextPricing) return;

    setPricingId(nextPricing.id);
    setSelectedResolutionKey(
      `${nextResolution.width}x${nextResolution.height}`
    );
  };

  const handleResolutionChange = (sizeKey: string) => {
    if (!selected) return;
    const nextResolution = resolutionOptions.find(
      resolution => `${resolution.width}x${resolution.height}` === sizeKey
    );
    if (!nextResolution) return;

    const nextPricing = resolvePricingForModelAndSize(
      pricingQuery.data ?? [],
      selected.model,
      nextResolution.width,
      nextResolution.height
    );
    if (!nextPricing) return;

    setPricingId(nextPricing.id);
    setSelectedResolutionKey(sizeKey);
  };

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 lg:py-2">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* 左侧：全息控制台 */}
          <div className="w-full lg:w-[400px] shrink-0">
            <div className="lg:sticky lg:top-[72px]">
              <div className="holo-panel rounded-2xl p-5 lg:flex lg:h-[calc(100vh-80px)] lg:max-h-[calc(100vh-80px)] lg:flex-col lg:overflow-hidden">
                <HoloCorners />
                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 holo-scroll">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-slate-900">
                      <Terminal className="h-5 w-5 text-sky-500" />
                      {t("workspace.console")}
                    </h2>
                    <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/40 hover:bg-amber-500/15">
                      <Coins className="mr-1 h-3.5 w-3.5" />
                      {quota} {t("workspace.credits")}
                    </Badge>
                  </div>

                  <label className="text-xs font-medium text-sky-600 tracking-widest uppercase flex items-center gap-1.5">
                    <ScanLine className="h-3.5 w-3.5" />
                    {t("workspace.prompt")}
                  </label>
                  <div className="holo-input mt-2 rounded-lg border border-slate-300 bg-white/75">
                    <Textarea
                      ref={promptRef}
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder={t("workspace.promptPlaceholder")}
                      className="min-h-[96px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none text-slate-800 placeholder:text-slate-400"
                      maxLength={2000}
                    />
                  </div>
                  <div className="mt-1 text-right text-xs text-slate-400 font-mono">
                    {prompt.length}/2000
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-sky-600 tracking-widest uppercase flex items-center gap-1.5">
                      <ImagePlus className="h-3.5 w-3.5" />
                      {t("workspace.referenceImage")}
                    </label>
                    <span className="text-[11px] text-slate-400">
                      {t("workspace.referenceOptional")}
                    </span>
                  </div>
                  <input
                    ref={referenceImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={generateMutation.isPending || referenceImageBusy}
                    onChange={event => {
                      void prepareReferenceImage(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  {referenceImage ? (
                    <div className="holo-input mt-2 flex min-h-[84px] items-center gap-3 rounded-lg border border-sky-300/80 bg-white/75 p-2.5">
                      <img
                        src={referenceImage.dataUrl}
                        alt={t("workspace.referencePreview")}
                        className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover shadow-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-700">
                          {referenceImage.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 font-mono">
                          {referenceImage.width}×{referenceImage.height}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatImageSize(referenceImage.size)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={chooseReferenceImage}
                          disabled={
                            generateMutation.isPending || referenceImageBusy
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-slate-500 transition-colors hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                          title={t("workspace.replaceReference")}
                          aria-label={t("workspace.replaceReference")}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setReferenceImage(null)}
                          disabled={
                            generateMutation.isPending || referenceImageBusy
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-slate-500 transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                          title={t("workspace.removeReference")}
                          aria-label={t("workspace.removeReference")}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={
                        generateMutation.isPending || referenceImageBusy
                          ? -1
                          : 0
                      }
                      aria-disabled={
                        generateMutation.isPending || referenceImageBusy
                      }
                      onClick={chooseReferenceImage}
                      onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          chooseReferenceImage();
                        }
                      }}
                      onDragEnter={event => {
                        event.preventDefault();
                        if (
                          !generateMutation.isPending &&
                          !referenceImageBusy
                        ) {
                          setIsDraggingReference(true);
                        }
                      }}
                      onDragOver={event => event.preventDefault()}
                      onDragLeave={() => setIsDraggingReference(false)}
                      onDrop={event => {
                        event.preventDefault();
                        setIsDraggingReference(false);
                        void prepareReferenceImage(
                          event.dataTransfer.files?.[0]
                        );
                      }}
                      className={cn(
                        "holo-input mt-2 flex min-h-[84px] items-center justify-center rounded-lg border border-dashed bg-white/75 px-4 text-center transition-colors",
                        generateMutation.isPending || referenceImageBusy
                          ? "cursor-not-allowed border-slate-200 opacity-60"
                          : "cursor-pointer border-slate-300 hover:border-sky-400/70 hover:bg-sky-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
                        isDraggingReference &&
                          "border-sky-400 bg-sky-50/80 shadow-[0_0_20px_rgba(56,189,248,0.16)]"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {referenceImageBusy ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-500" />
                        ) : (
                          <Upload className="h-5 w-5 shrink-0 text-sky-500" />
                        )}
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-600">
                            {referenceImageBusy
                              ? t("workspace.processingReference")
                              : t("workspace.dropReference")}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {t("workspace.referenceFormats")}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <label className="mt-3 block text-xs font-medium text-sky-600 tracking-widest uppercase">
                    {t("workspace.negative")}
                  </label>
                  <div className="holo-input mt-2 rounded-lg border border-slate-300 bg-white/75">
                    <Textarea
                      ref={negativeRef}
                      value={negativePrompt}
                      onChange={e => setNegativePrompt(e.target.value)}
                      placeholder={t("workspace.negativePlaceholder")}
                      className="min-h-[52px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none text-slate-800 placeholder:text-slate-400"
                      maxLength={2000}
                    />
                  </div>

                  <label className="mt-3 block text-xs font-medium text-sky-600 tracking-widest uppercase">
                    {t("workspace.model")}
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                    <div className="min-w-0">
                      <span className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-sky-600">
                        {t("workspace.modelChoice")}
                      </span>
                      <Select
                        value={selected?.model}
                        onValueChange={handleModelChange}
                      >
                        <SelectTrigger
                          aria-label={t("workspace.modelChoice")}
                          title={selectedModelLabel}
                          className="workspace-select-trigger holo-input"
                        >
                          <SelectValue
                            placeholder={t("workspace.modelChoice")}
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {selectedModelLabel?.replace(
                              /^GPT\s+Image\s+/i,
                              ""
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="workspace-select-content holo-panel z-[70]">
                          {modelOptions.map(option => (
                            <SelectItem
                              key={option.model}
                              value={option.model}
                              className="workspace-select-item"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="min-w-0">
                      <span className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-sky-600">
                        {t("workspace.resolutionChoice")}
                      </span>
                      <Select
                        value={
                          selectedResolution
                            ? `${selectedResolution.width}x${selectedResolution.height}`
                            : undefined
                        }
                        onValueChange={handleResolutionChange}
                      >
                        <SelectTrigger
                          aria-label={t("workspace.resolutionChoice")}
                          title={
                            selectedResolution
                              ? `${selectedResolution.width}×${selectedResolution.height}`
                              : undefined
                          }
                          className="workspace-select-trigger holo-input tabular-nums"
                        >
                          <SelectValue
                            placeholder={t("workspace.resolutionChoice")}
                            className="min-w-0 flex-1 truncate text-left"
                          />
                        </SelectTrigger>
                        <SelectContent className="workspace-select-content holo-panel z-[70]">
                          {resolutionOptions.map(resolution => {
                            const label = resolution.label.includes(" · ")
                              ? resolution.label
                                  .split(" · ")
                                  .slice(1)
                                  .join(" · ")
                              : `${resolution.width}×${resolution.height}`;
                            return (
                              <SelectItem
                                key={`${resolution.width}x${resolution.height}`}
                                value={`${resolution.width}x${resolution.height}`}
                                className="workspace-select-item tabular-nums"
                              >
                                {label}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* 能量核心生成按钮 */}
                <div className="mt-5 flex shrink-0 justify-center lg:mt-4">
                  <button
                    className="energy-core-btn relative inline-flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-base font-bold tracking-wide text-white transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-70 disabled:hover:scale-100"
                    disabled={generateMutation.isPending || referenceImageBusy}
                    onMouseEnter={e =>
                      !generateMutation.isPending &&
                      !referenceImageBusy &&
                      burstAtElement(e.currentTarget, { count: 12, power: 2.4 })
                    }
                    onClick={e => handleGenerate(e)}
                  >
                    {generateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {t("workspace.generating")}
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-5 w-5" />
                        {t("workspace.generate")}
                        {selected
                          ? ` · ${selected.price} ${t("workspace.credits")}`
                          : ""}
                      </>
                    )}
                  </button>
                </div>
                {quota < (selected?.price ?? 0) && (
                  <button
                    onClick={() => navigate("/settings")}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 hover:bg-amber-500/20 transition-colors"
                  >
                    <AlertCircle className="h-4 w-4" />
                    {t("workspace.lowQuota")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：左边预览，右边竖向历史 */}
          <div className="min-w-0 flex-1 xl:grid xl:min-h-[calc(100vh-80px)] xl:grid-cols-[minmax(0,1fr)_clamp(220px,24vw,300px)] xl:items-stretch xl:gap-6">
            <div className="flex min-h-0 min-w-0 flex-col">
              {/* 当前预览 */}
              <div
                ref={previewAreaRef}
                className={cn(
                  "holo-panel relative overflow-hidden rounded-2xl",
                  hasRenderedPreview
                    ? "energy-frame w-fit max-w-full shrink-0 self-start"
                    : "flex min-h-[260px] w-full flex-1 xl:min-h-0"
                )}
              >
                <HoloCorners />
                {generateMutation.isPending ? (
                  <div className="relative flex min-h-0 flex-1 w-full overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(219,234,254,0.5),rgba(255,255,255,0.94)_78%)]">
                    <ConvergingStars className="absolute inset-0 h-full w-full" />
                    <div className="absolute inset-x-0 bottom-7 z-10 text-center">
                      <p className="text-sm text-sky-600 font-mono tracking-[0.3em]">
                        {t("workspace.converging")}
                      </p>
                      <p className="text-xs text-slate-500 mt-1.5">
                        {t("workspace.convergingSub")}
                      </p>
                    </div>
                  </div>
                ) : preview?.imageUrl ? (
                  <div className="group relative w-fit max-w-full">
                    <div className="w-fit max-w-full overflow-hidden rounded-t-2xl bg-transparent">
                      <img
                        key={preview.id}
                        src={preview.imageUrl}
                        alt={preview.prompt}
                        onClick={() => setLightboxOpen(true)}
                        className="animate-materialize block h-auto w-auto max-h-[calc(100vh-180px)] max-w-full cursor-zoom-in object-contain"
                      />
                    </div>
                    <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <a
                        href={preview.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-white/90 p-2 text-slate-600 hover:text-sky-600 shadow-sm"
                        title={t("workspace.downloadTip")}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => sendToCanvas(preview)}
                        className="rounded-lg bg-white/90 p-2 text-slate-600 hover:text-amber-600 shadow-sm"
                        title={t("workspace.toCanvas")}
                      >
                        <Shapes className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() =>
                          togglePublicMutation.mutate({
                            id: preview.id,
                            isPublic: !preview.isPublic,
                          })
                        }
                        className="rounded-lg bg-white/90 p-2 text-slate-600 hover:text-emerald-600 shadow-sm"
                        title={
                          preview.isPublic
                            ? t("workspace.unpublishTip")
                            : t("workspace.publishTip")
                        }
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="w-full border-t border-sky-500/10 px-5 py-4">
                      <p className="break-words text-sm text-slate-600 line-clamp-2">
                        {preview.prompt}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                        <span>{preview.model}</span>
                        <span>·</span>
                        <span>
                          {preview.width}×{preview.height}
                        </span>
                        <span>·</span>
                        <span>
                          {preview.cost} {t("workspace.credits")}
                        </span>
                        {preview.isPublic ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/40 ml-auto">
                            <Globe className="mr-1 h-3 w-3" />{" "}
                            {t("workspace.published")}
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 border-slate-300 ml-auto">
                            <Lock className="mr-1 h-3 w-3" />{" "}
                            {t("workspace.private")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-white/50 text-slate-400">
                    <div className="relative">
                      <ImageOff className="h-12 w-12" />
                      <div className="absolute -inset-4 rounded-full border border-dashed border-sky-400/30 animate-spin-slow" />
                    </div>
                    <p className="text-sm">{t("workspace.emptyPreview")}</p>
                  </div>
                )}
              </div>

              {/* 能量分隔线 */}
              {hasRenderedPreview && (
                <div className="my-8 xl:my-6">
                  <div className="energy-beam" />
                </div>
              )}
            </div>

            {/* 历史记录 */}
            <aside className="holo-panel relative mt-6 flex h-[520px] min-h-0 min-w-0 flex-col rounded-2xl p-4 xl:mt-0 xl:h-[calc(100vh-80px)] xl:min-h-0">
              <HoloCorners />
              <h3 className="mb-3 flex shrink-0 items-center gap-2 text-lg font-bold text-slate-900">
                <Wand2 className="h-5 w-5 text-amber-500" />
                {t("workspace.history")}
              </h3>
              {historyItems.length > 0 ? (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <button
                    type="button"
                    onClick={() => scrollHistory(-1)}
                    disabled={
                      !historyScrollState.canScrollPrev ||
                      historyQuery.isFetching
                    }
                    className="mx-auto my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-md transition-colors hover:border-sky-300 hover:text-sky-600 disabled:pointer-events-none disabled:opacity-35"
                    aria-label={t("workspace.historyScrollUp")}
                    title={t("workspace.historyScrollUp")}
                  >
                    <ChevronUp className="h-5 w-5" />
                  </button>
                  <div
                    ref={historyScrollRef}
                    className="history-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth px-1"
                  >
                    <div className="grid grid-cols-1 gap-3">
                      {historyItems.map(g => (
                        <div
                          key={g.id}
                          data-history-card
                          style={{
                            height: "var(--history-card-height, 132px)",
                          }}
                          className="group relative w-full shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white/65 transition-all duration-300 hover:border-sky-400/60 hover:shadow-[0_0_20px_rgba(56,189,248,0.18)]"
                          onClick={() => setPreview(g)}
                        >
                          <img
                            src={g.imageUrl ?? ""}
                            alt={g.prompt}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                            <p className="line-clamp-2 text-xs text-slate-600">
                              {g.prompt}
                            </p>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              {g.isPublic && (
                                <Badge className="border-emerald-500/40 bg-emerald-500/20 px-1.5 py-0 text-[10px] text-emerald-600">
                                  {t("workspace.published")}
                                </Badge>
                              )}
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  sendToCanvas(g);
                                }}
                                className="ml-auto rounded-md bg-white/90 p-1.5 text-slate-500 hover:text-amber-600"
                                title={t("workspace.toCanvas")}
                              >
                                <Shapes className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  removeMutation.mutate({ id: g.id });
                                }}
                                className="rounded-md bg-white/90 p-1.5 text-slate-500 hover:text-red-500"
                                title={t("common.delete")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => scrollHistory(1)}
                    disabled={
                      !historyScrollState.canScrollNext ||
                      historyQuery.isFetching
                    }
                    className="mx-auto my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-md transition-colors hover:border-sky-300 hover:text-sky-600 disabled:pointer-events-none disabled:opacity-35"
                    aria-label={t("workspace.historyScrollDown")}
                    title={t("workspace.historyScrollDown")}
                  >
                    <ChevronDown className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div className="holo-panel min-h-[202px] flex-1 rounded-2xl py-16 text-center text-slate-400">
                  <HoloCorners />
                  <ImageOff className="mx-auto h-10 w-10 mb-3" />
                  <p className="text-sm">{t("workspace.noHistory")}</p>
                </div>
              )}
              {(hasPreviousHistoryPage || hasNextHistoryPage) && (
                <div className="mt-3 flex w-full shrink-0 flex-wrap items-center justify-center gap-2 pb-1 text-sm text-slate-500">
                  <button
                    type="button"
                    onClick={goToPreviousHistoryPage}
                    disabled={
                      !hasPreviousHistoryPage || historyQuery.isFetching
                    }
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white/75 px-2.5 transition-colors hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("workspace.historyPrev")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("workspace.historyPrev")}
                  </button>
                  <span className="min-w-[4.5rem] text-center text-xs font-medium text-slate-500">
                    {t("workspace.historyPage")} {historyPage + 1}{" "}
                    {t("workspace.historyPageSuffix")}
                  </span>
                  <button
                    type="button"
                    onClick={goToNextHistoryPage}
                    disabled={!hasNextHistoryPage || historyQuery.isFetching}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white/75 px-2.5 transition-colors hover:border-sky-300 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("workspace.historyNext")}
                  >
                    {t("workspace.historyNext")}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>

      {/* 大图预览弹层 */}
      {lightboxOpen && preview && preview.imageUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/92 backdrop-blur-sm p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button className="absolute top-5 right-5 rounded-full bg-slate-100 p-2 text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
          <img
            src={preview.imageUrl}
            alt={preview.prompt}
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </SiteLayout>
  );
}
