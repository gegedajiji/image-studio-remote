import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { SiteLayout } from "@/components/SiteLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Heart,
  Copy,
  Images,
  Loader2,
  X,
  Download,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CommunityItem = {
  id: number;
  prompt: string;
  model: string;
  width: number;
  height: number;
  imageUrl: string | null;
  createdAt: Date;
  authorName: string | null;
  authorAvatar: string | null;
  likeCount: number;
};

export default function Community() {
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [lightbox, setLightbox] = useState<CommunityItem | null>(null);

  const listQuery = trpc.community.list.useQuery({ limit: 48 });
  const myLikesQuery = trpc.community.myLikes.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const likedSet = new Set(myLikesQuery.data ?? []);

  const toggleLike = trpc.community.toggleLike.useMutation({
    onSuccess: () => {
      utils.community.list.invalidate();
      utils.community.myLikes.invalidate();
    },
    onError: () => toast.error(t("common.opFailed")),
  });

  const handleLike = (id: number) => {
    if (!isAuthenticated) {
      toast.info(t("community.loginToLike"));
      navigate("/login");
      return;
    }
    toggleLike.mutate({ generationId: id });
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt).then(() => toast.success(t("community.promptCopied")));
  };

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-900">
              <Images className="h-8 w-8 text-sky-500" />
              {t("community.title")}
            </h1>
            <p className="mt-2 text-slate-500">
              {t("community.subtitle")}
            </p>
          </div>
          <Button
            className="bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-white border-0 shrink-0"
            onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {t("community.publish")}
          </Button>
        </div>

        {listQuery.isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
          </div>
        ) : listQuery.data && listQuery.data.length > 0 ? (
          <div className="masonry">
            {listQuery.data.map((item) => (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/70 hover:border-violet-400/50 transition-colors"
              >
                <img
                  src={item.imageUrl ?? ""}
                  alt={item.prompt}
                  loading="lazy"
                  className="w-full cursor-zoom-in object-cover"
                  onClick={() => setLightbox(item)}
                />
                {/* hover 信息层 */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 via-white/75 to-transparent p-4 pt-10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-slate-600 line-clamp-2 mb-3">{item.prompt}</p>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={item.authorAvatar ?? undefined} />
                      <AvatarFallback className="bg-violet-500 text-[10px] text-white">
                        {(item.authorName ?? "U").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-slate-500 truncate flex-1">
                      {item.authorName ?? t("community.anon")}
                    </span>
                    <button
                      onClick={() => copyPrompt(item.prompt)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      title={t("community.copyPrompt")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleLike(item.id)}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                        likedSet.has(item.id)
                          ? "text-pink-500"
                          : "text-slate-500 hover:text-pink-500",
                      )}
                    >
                      <Heart
                        className={cn("h-3.5 w-3.5", likedSet.has(item.id) && "fill-pink-500")}
                      />
                      {item.likeCount}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card rounded-2xl py-24 text-center">
            <Images className="mx-auto h-12 w-12 text-slate-300 mb-4" />
            <p className="text-slate-500">{t("community.empty")}</p>
            <Button
              className="mt-6 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-white border-0"
              onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {t("community.goCreate")}
            </Button>
          </div>
        )}
      </div>

      {/* 灯箱 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/95 backdrop-blur-sm p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-5 right-5 rounded-full bg-slate-100 p-2 text-slate-600 hover:text-slate-900 z-10">
            <X className="h-5 w-5" />
          </button>
          <div
            className="max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-hidden bg-white flex items-center justify-center">
              <img
                src={lightbox.imageUrl ?? ""}
                alt={lightbox.prompt}
                className="max-h-[65vh] w-full object-contain"
              />
            </div>
            <div className="p-5 border-t border-slate-200">
              <p className="text-sm text-slate-700">{lightbox.prompt}</p>
              <div className="mt-3 flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={lightbox.authorAvatar ?? undefined} />
                  <AvatarFallback className="bg-violet-500 text-xs text-white">
                    {(lightbox.authorName ?? "U").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700">
                    {lightbox.authorName ?? t("community.anon")}
                  </div>
                  <div className="text-xs text-slate-500">
                    {lightbox.model} · {lightbox.width}×{lightbox.height}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-300 text-slate-600"
                  onClick={() => copyPrompt(lightbox.prompt)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {t("community.prompt")}
                </Button>
                <a href={lightbox.imageUrl ?? "#"} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="border-slate-300 text-slate-600">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {t("community.original")}
                  </Button>
                </a>
                <Button
                  size="sm"
                  onClick={() => handleLike(lightbox.id)}
                  className={cn(
                    "border-0",
                    likedSet.has(lightbox.id)
                      ? "bg-pink-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-pink-500/60",
                  )}
                >
                  <Heart
                    className={cn("mr-1.5 h-3.5 w-3.5", likedSet.has(lightbox.id) && "fill-white")}
                  />
                  {lightbox.likeCount}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SiteLayout>
  );
}
