import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { SiteLayout } from "@/components/SiteLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  Images,
  Loader2,
  Maximize2,
  MessageCircle,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const COMMUNITY_PAGE_SIZE = 12;
const COMMENT_MAX_LENGTH = 1000;
const REUSE_PROMPT_STORAGE_KEY = "mirage-reuse-prompt";

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
  commentCount: number;
};

type CommunityComment = {
  id: number;
  generationId: number;
  userId: number;
  body: string;
  createdAt: Date;
  authorName: string | null;
  authorAvatar: string | null;
};

export default function Community() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<number | null>>([null]);
  const [lightbox, setLightbox] = useState<CommunityItem | null>(null);
  const [lightboxImageRatio, setLightboxImageRatio] = useState<number | null>(
    null
  );
  const [commentText, setCommentText] = useState("");

  const cursor = pageCursors[page] ?? null;
  const listQuery = trpc.community.list.useQuery(
    { limit: COMMUNITY_PAGE_SIZE, cursor },
    { placeholderData: previousData => previousData },
  );
  const items = listQuery.data?.items ?? [];
  const nextCursor = listQuery.data?.nextCursor ?? null;
  const hasNextPage = nextCursor !== null;
  const hasPreviousPage = page > 0;

  const myLikesQuery = trpc.community.myLikes.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const likedSet = new Set(myLikesQuery.data ?? []);

  const commentsQuery = trpc.community.comments.useQuery(
    { generationId: lightbox?.id ?? 0, limit: 50 },
    {
      enabled: lightbox !== null,
    },
  );

  const toggleLike = trpc.community.toggleLike.useMutation({
    onSuccess: () => {
      utils.community.list.invalidate();
      utils.community.myLikes.invalidate();
    },
    onError: () => toast.error(t("common.opFailed")),
  });

  const createComment = trpc.community.createComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      utils.community.comments.invalidate();
      utils.community.list.invalidate();
      toast.success(t("community.commentPosted"));
    },
    onError: error => toast.error(error.message || t("community.commentFailed")),
  });

  const deleteComment = trpc.community.deleteComment.useMutation({
    onSuccess: () => {
      utils.community.comments.invalidate();
      utils.community.list.invalidate();
      toast.success(t("community.commentDeleted"));
    },
    onError: error => toast.error(error.message || t("community.commentFailed")),
  });

  const handleLike = (id: number) => {
    if (!isAuthenticated) {
      toast.info(t("community.loginToLike"));
      navigate("/login");
      return;
    }
    toggleLike.mutate({ generationId: id });
  };

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t("community.promptCopied"));
    } catch {
      toast.error(t("common.opFailed"));
    }
  };

  const openLightbox = (item: CommunityItem) => {
    setLightbox(item);
    setLightboxImageRatio(null);
    setCommentText("");
  };

  const closeLightbox = () => {
    setLightbox(null);
    setLightboxImageRatio(null);
    setCommentText("");
  };

  const reusePrompt = (item: CommunityItem) => {
    if (!isAuthenticated) {
      try {
        sessionStorage.setItem(
          REUSE_PROMPT_STORAGE_KEY,
          JSON.stringify({
            prompt: item.prompt,
            model: item.model,
            width: item.width,
            height: item.height,
          }),
        );
      } catch {
        // The login flow still works when browser storage is unavailable.
      }
      navigate("/login");
      return;
    }
    navigate("/workspace", {
      state: {
        prompt: item.prompt,
        model: item.model,
        width: item.width,
        height: item.height,
      },
    });
  };

  const handleCommentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    if (!isAuthenticated) {
      toast.info(t("community.loginToComment"));
      navigate("/login");
      return;
    }
    if (!lightbox) return;
    createComment.mutate({ generationId: lightbox.id, body });
  };

  const goToNextPage = () => {
    if (!hasNextPage || listQuery.isFetching || nextCursor === null) return;
    setPageCursors(cursors => [
      ...cursors.slice(0, page + 1),
      nextCursor,
    ]);
    setPage(currentPage => currentPage + 1);
  };

  const goToPreviousPage = () => {
    if (!hasPreviousPage || listQuery.isFetching) return;
    setPage(currentPage => Math.max(0, currentPage - 1));
  };

  const comments = (commentsQuery.data ?? []) as CommunityComment[];
  const metadataRatio =
    lightbox && lightbox.width > 0 && lightbox.height > 0
      ? lightbox.width / lightbox.height
      : 1;
  const lightboxRatio = lightboxImageRatio ?? metadataRatio;
  const lightboxWidth = lightbox
    ? "min(94vw, " + Math.max(1, 42 * lightboxRatio) + "vh)"
    : "94vw";

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
              <Images className="h-8 w-8 text-sky-500" />
              {t("community.title")}
            </h1>
            <p className="mt-2 text-slate-500">{t("community.subtitle")}</p>
          </div>
          <Button
            className="shrink-0 border-0 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-white"
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
        ) : items.length > 0 ? (
          <>
            <div
              className={cn(
                "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
                listQuery.isFetching && "opacity-75",
              )}
            >
              {items.map(item => (
                <article
                  key={item.id}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white/75 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-300/80 hover:shadow-[0_12px_30px_rgba(56,189,248,0.14)]"
                >
                  <button
                    type="button"
                    className="relative block aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left"
                    onClick={() => openLightbox(item)}
                    aria-label={t("community.viewDetails")}
                  >
                    <img
                      src={item.imageUrl ?? ""}
                      alt={item.prompt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      <Maximize2 className="h-3 w-3" />
                      {t("community.viewDetails")}
                    </span>
                  </button>
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={item.authorAvatar ?? undefined} />
                        <AvatarFallback className="bg-violet-500 text-[10px] text-white">
                          {(item.authorName ?? "U").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                        {item.authorName ?? t("community.anon")}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyPrompt(item.prompt)}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        title={t("community.copyPrompt")}
                        aria-label={t("community.copyPrompt")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLike(item.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
                          likedSet.has(item.id)
                            ? "text-pink-500"
                            : "text-slate-400 hover:text-pink-500",
                        )}
                        title={t("community.like")}
                        aria-label={t("community.like")}
                      >
                        <Heart
                          className={cn(
                            "h-3.5 w-3.5",
                            likedSet.has(item.id) && "fill-pink-500",
                          )}
                        />
                        {item.likeCount}
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-slate-600">
                      {item.prompt}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {item.commentCount} {t("community.comments")}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {(hasPreviousPage || hasNextPage) && (
              <div className="mt-8 flex items-center justify-center gap-3 text-sm text-slate-500">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousPage}
                  disabled={!hasPreviousPage || listQuery.isFetching}
                  className="border-slate-300 bg-white/80 text-slate-600"
                  aria-label={t("community.previous")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("community.previous")}
                </Button>
                <span className="min-w-[4rem] text-center text-xs font-medium">
                  {t("community.page")} {page + 1} {t("community.pageSuffix")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={goToNextPage}
                  disabled={!hasNextPage || listQuery.isFetching}
                  className="border-slate-300 bg-white/80 text-slate-600"
                  aria-label={t("community.next")}
                >
                  {t("community.next")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="glass-card rounded-2xl py-24 text-center">
            <Images className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <p className="text-slate-500">{t("community.empty")}</p>
            <Button
              className="mt-6 border-0 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 text-white"
              onClick={() => navigate(isAuthenticated ? "/workspace" : "/login")}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {t("community.goCreate")}
            </Button>
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/95 p-3 backdrop-blur-sm sm:p-6"
          onClick={closeLightbox}
          role="presentation"
        >
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-full bg-slate-100 p-2 text-slate-600 hover:text-slate-900 sm:right-6 sm:top-6"
            onClick={closeLightbox}
            aria-label={t("community.close")}
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(51,65,85,0.18)] sm:max-h-[calc(100vh-3rem)] sm:max-w-[calc(100vw-3rem)]"
            style={{ width: lightboxWidth }}
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("community.details")}
          >
            <div className="flex shrink-0 items-center justify-center overflow-hidden bg-slate-50">
              <img
                src={lightbox.imageUrl ?? ""}
                alt={lightbox.prompt}
                onLoad={event => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setLightboxImageRatio(naturalWidth / naturalHeight);
                  }
                }}
                className="block h-auto w-auto max-h-[42vh] max-w-full object-contain"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-slate-200 p-4 sm:p-5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="shrink-0">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex min-w-0 flex-1 basis-full items-start gap-3 sm:basis-auto">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={lightbox.authorAvatar ?? undefined} />
                        <AvatarFallback className="bg-violet-500 text-xs text-white">
                          {(lightbox.authorName ?? "U").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-700">
                          {lightbox.authorName ?? t("community.anon")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {lightbox.model} · {lightbox.width}×{lightbox.height}
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full max-w-full flex-wrap justify-start gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-300 bg-white text-slate-600"
                        onClick={() => reusePrompt(lightbox)}
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                        {t("community.reusePrompt")}
                      </Button>
                      <a
                        href={lightbox.imageUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-slate-300 bg-white text-slate-600"
                        >
                          <Download className="h-3.5 w-3.5" />
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
                          className={cn(
                            "h-3.5 w-3.5",
                            likedSet.has(lightbox.id) && "fill-white",
                          )}
                        />
                        {lightbox.likeCount}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-6 text-slate-700">
                    {lightbox.prompt}
                  </p>
                </div>
                <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-4">
                  <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-700">
                    <MessageCircle className="h-4 w-4 text-sky-500" />
                    {t("community.comments")}
                    <span className="text-xs font-normal text-slate-400">
                      {comments.length}
                    </span>
                  </div>
                  {commentsQuery.isLoading ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="min-h-0 flex-1 py-3 text-xs text-slate-400">
                      {t("community.commentsEmpty")}
                    </p>
                  ) : (
                    <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                      <div className="space-y-3">
                        {comments.map(comment => {
                          const canDelete =
                            user?.role === "admin" || user?.id === comment.userId;
                          return (
                            <div key={comment.id} className="flex gap-2">
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarImage
                                  src={comment.authorAvatar ?? undefined}
                                />
                                <AvatarFallback className="bg-sky-500 text-[10px] text-white">
                                  {(comment.authorName ?? "U")
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600">
                                    {comment.authorName ?? t("community.anon")}
                                  </span>
                                  <time className="shrink-0 text-[10px] text-slate-400">
                                    {new Date(comment.createdAt).toLocaleString()}
                                  </time>
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        deleteComment.mutate({ id: comment.id })
                                      }
                                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-500"
                                      title={t("community.deleteComment")}
                                      aria-label={t("community.deleteComment")}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                                  {comment.body}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <form
                className="mt-4 shrink-0 border-t border-slate-100 pt-4"
                onSubmit={handleCommentSubmit}
              >
                <Textarea
                  value={commentText}
                  onChange={event => setCommentText(event.target.value)}
                  placeholder={t("community.commentPlaceholder")}
                  maxLength={COMMENT_MAX_LENGTH}
                  rows={2}
                  className="min-h-[72px] resize-none border-slate-200 bg-white text-sm"
                  disabled={createComment.isPending}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-400">
                    {commentText.length}/{COMMENT_MAX_LENGTH}
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      createComment.isPending || commentText.trim().length === 0
                    }
                    className="border-0 bg-sky-500 text-white hover:bg-sky-600"
                  >
                    {createComment.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" />
                    )}
                    {t("community.postComment")}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </SiteLayout>
  );
}
