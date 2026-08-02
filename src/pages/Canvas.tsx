import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { useI18n } from "@/i18n";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Type,
  ImagePlus,
  ZoomIn,
  ZoomOut,
  Maximize,
  Link2,
  Trash2,
  Sparkles,
  Copy,
  X,
  Loader2,
  Hand,
  MousePointer2,
  Move,
  Music2,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LOGIN_PATH } from "@/const";
import type { CanvasNode, CanvasEdge } from "@contracts/types";

type View = { x: number; y: number; scale: number };

type CopyContent = {
  title: string;
  body: string;
  tags: string[];
  platform: "douyin" | "xhs";
  language: string;
};

const NODE_W = { image: 300, prompt: 280, copy: 330 };

export default function Canvas() {
  const { user, isLoading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const stateQuery = trpc.canvas.state.useQuery(undefined, { enabled: !!user });
  const historyQuery = trpc.generation.myHistory.useQuery(
    { limit: 60 },
    { enabled: !!user },
  );

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [images, setImages] = useState<Record<string, { imageUrl: string | null; prompt: string; model: string }>>({});
  const [view, setView] = useState<View>({ x: 60, y: 40, scale: 1 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [copyPanelNode, setCopyPanelNode] = useState<number | null>(null);
  const [promptDialog, setPromptDialog] = useState(false);
  const [imageDialog, setImageDialog] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [platform, setPlatform] = useState<"douyin" | "xhs">("douyin");
  const [copyLang, setCopyLang] = useState<"zh" | "en" | "mixed">("zh");
  const [editingNode, setEditingNode] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<number, HTMLDivElement>());
  const [heights, setHeights] = useState<Record<number, number>>({});
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);

  // 同步服务器状态
  useEffect(() => {
    if (stateQuery.data) {
      setNodes(stateQuery.data.nodes);
      setEdges(stateQuery.data.edges);
      setImages(stateQuery.data.images as typeof images);
    }
  }, [stateQuery.data]);

  // 测量节点高度用于连线锚点
  useEffect(() => {
    const h: Record<number, number> = {};
    nodeRefs.current.forEach((el, id) => {
      h[id] = el.offsetHeight;
    });
    setHeights(h);
  }, [nodes, editingNode]);

  const addNodeMut = trpc.canvas.addNode.useMutation({
    onSuccess: () => utils.canvas.state.invalidate(),
  });
  const updateNodeMut = trpc.canvas.updateNode.useMutation();
  const removeNodeMut = trpc.canvas.removeNode.useMutation({
    onSuccess: () => utils.canvas.state.invalidate(),
  });
  const addEdgeMut = trpc.canvas.addEdge.useMutation({
    onSuccess: () => utils.canvas.state.invalidate(),
  });
  const removeEdgeMut = trpc.canvas.removeEdge.useMutation({
    onSuccess: () => utils.canvas.state.invalidate(),
  });
  const genCopyMut = trpc.canvas.generateCopy.useMutation({
    onSuccess: (res) => {
      toast.success(t("canvas.copyOk"));
      setCopyPanelNode(null);
      utils.canvas.state.invalidate();
      setSelectedId(res.node.id);
    },
    onError: (e) => toast.error(e.message),
  });

  // ===== 坐标换算 =====
  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    [view],
  );

  // ===== 平移 =====
  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y };
    setSelectedId(null);
    setConnectFrom(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({ ...v, x: p.vx + (e.clientX - p.startX), y: p.vy + (e.clientY - p.startY) }));
    }
    if (dragRef.current) {
      const d = dragRef.current;
      const c = toCanvas(e.clientX, e.clientY);
      const nx = c.x - d.dx;
      const ny = c.y - d.dy;
      setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)));
    }
  };
  const onPointerUp = () => {
    if (dragRef.current) {
      const d = dragRef.current;
      const node = nodes.find((n) => n.id === d.id);
      if (node) updateNodeMut.mutate({ id: d.id, x: node.x, y: node.y });
    }
    panRef.current = null;
    dragRef.current = null;
  };

  // ===== 缩放 =====
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = viewportRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0012);
        const scale = Math.min(2.2, Math.max(0.25, v.scale * factor));
        const k = scale / v.scale;
        return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    },
    [],
  );

  const zoomBy = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const scale = Math.min(2.2, Math.max(0.25, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // ===== 节点操作 =====
  const viewCenter = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return toCanvas(
      (rect?.left ?? 0) + (rect?.width ?? 600) / 2,
      (rect?.top ?? 0) + (rect?.height ?? 400) / 2,
    );
  };

  const addPromptNode = () => {
    if (!promptText.trim()) return;
    const c = viewCenter();
    addNodeMut.mutate({
      type: "prompt",
      content: promptText.trim(),
      x: c.x - 140 + (Math.random() - 0.5) * 80,
      y: c.y - 80 + (Math.random() - 0.5) * 60,
      w: NODE_W.prompt,
      z: nodes.length,
    });
    setPromptText("");
    setPromptDialog(false);
  };

  const addImageNode = (genId: number) => {
    const c = viewCenter();
    addNodeMut.mutate({
      type: "image",
      refId: genId,
      x: c.x - 150 + (Math.random() - 0.5) * 100,
      y: c.y - 140 + (Math.random() - 0.5) * 80,
      w: NODE_W.image,
      z: nodes.length,
    });
    setImageDialog(false);
  };

  const onNodePointerDown = (e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const c = toCanvas(e.clientX, e.clientY);
    dragRef.current = { id: node.id, dx: c.x - node.x, dy: c.y - node.y };
    setSelectedId(node.id);
    // 置顶
    const maxZ = Math.max(0, ...nodes.map((n) => n.z));
    if (node.z < maxZ) {
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, z: maxZ + 1 } : n)));
      updateNodeMut.mutate({ id: node.id, z: maxZ + 1 });
    }
    // 连接模式
    if (connectFrom !== null && connectFrom !== node.id) {
      addEdgeMut.mutate({ fromId: connectFrom, toId: node.id });
      setConnectFrom(null);
    }
  };

  const deleteNode = (id: number) => {
    removeNodeMut.mutate({ id });
    setSelectedId(null);
    setCopyPanelNode(null);
  };

  const parseCopy = (node: CanvasNode): CopyContent | null => {
    if (!node.content) return null;
    try {
      return JSON.parse(node.content) as CopyContent;
    } catch {
      return null;
    }
  };

  const copyAll = (node: CanvasNode) => {
    const c = parseCopy(node);
    if (!c) return;
    const text = `${c.title}\n\n${c.body}\n\n${c.tags.join(" ")}`;
    navigator.clipboard.writeText(text).then(() => toast.success(t("canvas.copied")));
  };

  const nodeCenter = (n: CanvasNode) => ({
    x: n.x + n.w / 2,
    y: n.y + (heights[n.id] ?? 160) / 2,
  });

  if (isLoading || !user) {
    return (
      <SiteLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="relative" style={{ height: "calc(100vh - 4rem)" }}>
        {/* 画布视口 */}
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onBgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {/* 点阵平面 */}
            <div className="canvas-dots absolute -left-[4000px] -top-[4000px] h-[8000px] w-[8000px]" />

            {/* 能量连线 */}
            <svg className="absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1 }}>
              <defs>
                <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f0b75a" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
              {edges.map((e) => {
                const from = nodes.find((n) => n.id === e.fromId);
                const to = nodes.find((n) => n.id === e.toId);
                if (!from || !to) return null;
                const a = nodeCenter(from);
                const b = nodeCenter(to);
                const dx = Math.max(60, Math.abs(b.x - a.x) * 0.4);
                const path = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
                return (
                  <g key={e.id} className="cursor-pointer" onClick={() => removeEdgeMut.mutate({ id: e.id })}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth={14 / view.scale} />
                    <path
                      d={path}
                      fill="none"
                      stroke="url(#edgeGrad)"
                      strokeWidth={5}
                      strokeLinecap="round"
                      opacity={0.18}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke="url(#edgeGrad)"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      className="edge-flow"
                    />
                  </g>
                );
              })}
            </svg>

            {/* 节点 */}
            {nodes.map((node) => {
              const isSelected = selectedId === node.id;
              const isConnectSrc = connectFrom === node.id;
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(node.id, el);
                    else nodeRefs.current.delete(node.id);
                  }}
                  className={cn(
                    "absolute select-none rounded-2xl border backdrop-blur-md transition-shadow",
                    isSelected
                      ? "border-sky-400/70 shadow-[0_0_24px_rgba(56,189,248,0.35)]"
                      : "border-slate-300/70 shadow-[0_4px_20px_rgba(100,116,180,0.12)]",
                    isConnectSrc && "ring-2 ring-amber-400/70",
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    zIndex: 10 + node.z,
                    background: "rgba(255,255,255,0.82)",
                  }}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                >
                  {/* 节点头部 */}
                  <div className="flex items-center gap-2 border-b border-slate-200/80 px-3.5 py-2 cursor-move">
                    <span
                      className={cn(
                        "flex h-5.5 w-5.5 h-6 w-6 items-center justify-center rounded-md text-white text-[10px]",
                        node.type === "image" && "bg-gradient-to-br from-sky-400 to-indigo-400",
                        node.type === "prompt" && "bg-gradient-to-br from-amber-400 to-orange-400",
                        node.type === "copy" && "bg-gradient-to-br from-emerald-400 to-teal-400",
                      )}
                    >
                      {node.type === "image" ? <ImagePlus className="h-3 w-3" /> : node.type === "prompt" ? <Type className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate text-xs font-semibold text-slate-600">
                      {node.type === "image" ? t("canvas.imageNode") : node.type === "prompt" ? t("canvas.promptNode") : t("canvas.copyNode")}
                      {" · #"}{node.id}
                    </span>
                    {node.type === "image" && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setCopyPanelNode(node.id)}
                        className="rounded-md p-1 text-amber-500 hover:bg-amber-50"
                        title={t("canvas.genCopy")}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setConnectFrom(isConnectSrc ? null : node.id)}
                      className={cn(
                        "rounded-md p-1",
                        isConnectSrc ? "bg-amber-100 text-amber-600" : "text-slate-400 hover:bg-slate-100 hover:text-sky-500",
                      )}
                      title={t("canvas.connect")}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => deleteNode(node.id)}
                      className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      title={t("canvas.deleteNode")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* 节点内容 */}
                  {node.type === "image" && (
                    <div className="p-2.5">
                      {images[String(node.refId)]?.imageUrl ? (
                        <img
                          src={images[String(node.refId)].imageUrl!}
                          alt=""
                          draggable={false}
                          className="w-full rounded-xl border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-32 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
                          #{node.refId}
                        </div>
                      )}
                      <p className="mt-2 line-clamp-2 px-1 text-xs text-slate-500">
                        {images[String(node.refId)]?.prompt ?? ""}
                      </p>
                    </div>
                  )}

                  {node.type === "prompt" && (
                    <div className="p-3.5" onDoubleClick={() => { setEditingNode(node.id); setEditText(node.content ?? ""); }}>
                      {editingNode === node.id ? (
                        <div onPointerDown={(e) => e.stopPropagation()}>
                          <Textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="min-h-[80px] bg-white border-slate-300 text-sm"
                            autoFocus
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditingNode(null)}>{t("common.cancel")}</Button>
                            <Button
                              size="sm"
                              className="bg-sky-500 hover:bg-sky-400 text-white"
                              onClick={() => {
                                updateNodeMut.mutate({ id: node.id, content: editText });
                                setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, content: editText } : n)));
                                setEditingNode(null);
                              }}
                            >
                              {t("common.save")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                          {node.content}
                        </p>
                      )}
                    </div>
                  )}

                  {node.type === "copy" && (() => {
                    const c = parseCopy(node);
                    if (!c) return null;
                    return (
                      <div className="p-3.5 space-y-2.5">
                        <div className="flex items-center gap-1.5">
                          <Badge className={cn(
                            "border text-[10px]",
                            c.platform === "douyin"
                              ? "bg-slate-800 text-white border-slate-800"
                              : "bg-red-50 text-red-500 border-red-200",
                          )}>
                            {c.platform === "douyin" ? <Music2 className="mr-1 h-2.5 w-2.5" /> : <BookOpen className="mr-1 h-2.5 w-2.5" />}
                            {c.platform === "douyin" ? t("canvas.douyin") : t("canvas.xhs")}
                          </Badge>
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => copyAll(node)}
                            className="ml-auto flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-100"
                          >
                            <Copy className="h-3 w-3" />
                            {t("canvas.copyAll")}
                          </button>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("canvas.copyTitle")}</div>
                          <p className="mt-0.5 text-sm font-semibold text-slate-700">{c.title}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("canvas.copyBody")}</div>
                          <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{c.body}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("canvas.copyTags")}</div>
                          <p className="mt-0.5 text-xs leading-relaxed text-sky-600">{c.tags.join(" ")}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {nodes.length === 0 && !stateQuery.isLoading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="holo-panel rounded-2xl px-10 py-8 text-center">
                <Move className="mx-auto h-8 w-8 text-sky-400 mb-3" />
                <p className="text-lg font-bold text-slate-700">{t("canvas.emptyTitle")}</p>
                <p className="mt-1 text-sm text-slate-500">{t("canvas.emptySub")}</p>
              </div>
            </div>
          )}
        </div>

        {/* 顶部工具栏 */}
        <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-300/70 bg-white/80 px-2 py-1.5 shadow-[0_4px_24px_rgba(100,116,180,0.15)] backdrop-blur-md">
          <button
            onClick={() => setPromptDialog(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-amber-50 hover:text-amber-600 transition-colors"
          >
            <Type className="h-4 w-4" />
            {t("canvas.addPrompt")}
          </button>
          <button
            onClick={() => setImageDialog(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-sky-50 hover:text-sky-600 transition-colors"
          >
            <ImagePlus className="h-4 w-4" />
            {t("canvas.addImage")}
          </button>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => zoomBy(1 / 1.2)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" title={t("canvas.zoomOut")}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs font-mono text-slate-500">{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoomBy(1.2)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" title={t("canvas.zoomIn")}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView({ x: 60, y: 40, scale: 1 })}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
            title={t("canvas.resetView")}
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>

        {/* 操作提示 */}
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full border border-slate-300/60 bg-white/75 px-5 py-2 text-[11px] text-slate-500 backdrop-blur-md">
          <span className="flex items-center gap-1"><Hand className="h-3 w-3" />{t("canvas.helpPan")}</span>
          <span className="flex items-center gap-1"><MousePointer2 className="h-3 w-3" />{t("canvas.helpZoom")}</span>
          <span className="flex items-center gap-1"><Move className="h-3 w-3" />{t("canvas.helpDrag")}</span>
          <span className="hidden sm:flex items-center gap-1"><Type className="h-3 w-3" />{t("canvas.editHint")}</span>
        </div>

        {/* 连接提示 */}
        {connectFrom !== null && (
          <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full border border-amber-300 bg-amber-50/90 px-4 py-1.5 text-xs font-medium text-amber-600 backdrop-blur-sm">
            {t("canvas.connectHint")}
          </div>
        )}

        {/* 文案生成面板 */}
        {copyPanelNode !== null && (
          <div className="holo-panel absolute right-4 top-4 z-30 w-72 rounded-2xl p-5">
            <span className="holo-corner holo-corner-tl" />
            <span className="holo-corner holo-corner-tr" />
            <span className="holo-corner holo-corner-bl" />
            <span className="holo-corner holo-corner-br" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Sparkles className="h-4 w-4 text-amber-500" />
                {t("canvas.copyPanel")}
              </h3>
              <button onClick={() => setCopyPanelNode(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="text-xs font-medium text-slate-500">{t("canvas.platform")}</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["douyin", "xhs"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
                    platform === p
                      ? "border-sky-400/70 bg-sky-50 text-sky-600"
                      : "border-slate-300 text-slate-500 hover:border-slate-400",
                  )}
                >
                  {p === "douyin" ? <Music2 className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {p === "douyin" ? t("canvas.douyin") : t("canvas.xhs")}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-medium text-slate-500">{t("canvas.language")}</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(["zh", "en", "mixed"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setCopyLang(l)}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-xs font-medium transition-all",
                    copyLang === l
                      ? "border-emerald-400/70 bg-emerald-50 text-emerald-600"
                      : "border-slate-300 text-slate-500 hover:border-slate-400",
                  )}
                >
                  {l === "zh" ? t("canvas.langZh") : l === "en" ? t("canvas.langEn") : t("canvas.langMixed")}
                </button>
              ))}
            </div>
            <Button
              className="mt-5 w-full bg-gradient-to-r from-amber-400 to-emerald-400 text-white border-0 hover:opacity-90"
              disabled={genCopyMut.isPending}
              onClick={() => genCopyMut.mutate({ imageNodeId: copyPanelNode, platform, language: copyLang })}
            >
              {genCopyMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("canvas.generating")}</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" />{t("canvas.generate")}</>
              )}
            </Button>
          </div>
        )}

        {/* 添加提示词节点 */}
        <Dialog open={promptDialog} onOpenChange={setPromptDialog}>
          <DialogContent className="bg-white border-slate-200 text-slate-700 sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("canvas.addPrompt")}</DialogTitle>
            </DialogHeader>
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={t("workspace.promptPlaceholder")}
              className="min-h-[120px] bg-slate-50 border-slate-300"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="border-slate-300" onClick={() => setPromptDialog(false)}>
                {t("common.cancel")}
              </Button>
              <Button className="bg-sky-500 hover:bg-sky-400 text-white" onClick={addPromptNode} disabled={addNodeMut.isPending}>
                {t("common.confirm")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 选择图像节点 */}
        <Dialog open={imageDialog} onOpenChange={setImageDialog}>
          <DialogContent className="bg-white border-slate-200 text-slate-700 sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("canvas.pickImage")}</DialogTitle>
            </DialogHeader>
            <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto p-1">
              {(historyQuery.data ?? [])
                .filter((g) => g.status === "success" && g.imageUrl)
                .map((g) => (
                  <button
                    key={g.id}
                    onClick={() => addImageNode(g.id)}
                    className="group relative overflow-hidden rounded-xl border border-slate-200 hover:border-sky-400/60 transition-colors"
                  >
                    <img src={g.imageUrl!} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-slate-600 line-clamp-1">{g.prompt}</p>
                    </div>
                  </button>
                ))}
            </div>
            {historyQuery.data?.filter((g) => g.status === "success").length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">{t("workspace.noHistory")}</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SiteLayout>
  );
}
