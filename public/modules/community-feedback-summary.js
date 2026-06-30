const emptySummary = {
  total: 0,
  reported: 0,
  comments: 0,
  replies: 0,
  normal: 0
};

const summaryCache = new Map();
let feedbackIndexCache = null;

export function clearCreatorFeedbackSummaryCache() {
  summaryCache.clear();
  feedbackIndexCache = null;
}

export function isCreatorFeedbackReported(item) {
  return Number(item?.reportCount || 0) > 0;
}

export function isCreatorFeedbackHandledByState(items = [], handledIds = [], id = '') {
  const feedbackId = String(id || '');
  if (!feedbackId) return false;
  const handledSet = handledIds instanceof Set ? handledIds : new Set(handledIds);
  const serverHandled = items.find((item) => item.id === feedbackId);
  if (serverHandled) return Boolean(serverHandled.handled);
  return handledSet.has(feedbackId);
}

function feedbackItemsSignature(items = [], handledIds = []) {
  const handledText = Array.isArray(handledIds) ? handledIds.join(',') : [...handledIds].join(',');
  if (feedbackIndexCache?.items === items && feedbackIndexCache?.handledText === handledText) {
    return feedbackIndexCache.signature;
  }
  return [
    handledText,
    items.map((item) => [
      item.postId || '',
      item.id || '',
      item.type || '',
      item.handled ? 1 : 0,
      item.reportCount || 0,
      item.updatedAt || '',
      item.createdAt || ''
    ].join(':')).join('|')
  ].join('::');
}

function creatorFeedbackIndex(items = [], handledIds = []) {
  const signature = feedbackItemsSignature(items, handledIds);
  if (feedbackIndexCache?.signature === signature) return feedbackIndexCache.index;
  const handledSet = new Set((Array.isArray(handledIds) ? handledIds : [...handledIds]).map((id) => String(id || '')).filter(Boolean));
  items.forEach((item) => {
    if (item?.handled && item.id) handledSet.add(String(item.id));
  });
  const index = new Map();
  items.forEach((item) => {
    const postId = String(item?.postId || '');
    if (!postId) return;
    let entry = index.get(postId);
    if (!entry) {
      entry = { all: [], pending: [], summary: null };
      index.set(postId, entry);
    }
    entry.all.push(item);
    if (isCreatorFeedbackReported(item) || !handledSet.has(String(item.id || ''))) {
      entry.pending.push(item);
    }
  });
  feedbackIndexCache = {
    signature,
    index,
    items,
    handledText: Array.isArray(handledIds) ? handledIds.join(',') : [...handledIds].join(',')
  };
  return index;
}

function feedbackSummaryPostSignature(post) {
  if (!post?.id) return '';
  const counts = post.pendingFeedbackCounts || {};
  return [
    post.updatedAt || '',
    post.createdAt || '',
    post.commentCount || 0,
    post.likeCount || 0,
    post.reuseCount || 0,
    post.downloadCount || 0,
    counts.total || 0,
    counts.reported || 0,
    counts.comments || 0,
    counts.replies || 0,
    counts.normal || 0
  ].join(':');
}

function pendingCountsFromServer(post) {
  if (!post?.pendingFeedbackCounts) return null;
  const counts = post.pendingFeedbackCounts;
  const comments = Number(counts.comments || 0);
  const replies = Number(counts.replies || 0);
  const reported = Number(counts.reported || 0);
  return {
    total: Number(counts.total || comments + replies + reported),
    reported,
    comments,
    replies,
    normal: Number(counts.normal ?? (comments + replies))
  };
}

export function creatorFeedbackSummaryForPost({
  postId,
  items = [],
  handledIds = [],
  findPost = () => null
} = {}) {
  const id = String(postId || '');
  if (!id) return { ...emptySummary };
  const post = findPost(id);
  const cacheKey = `${feedbackSummaryPostSignature(post)}::${id}::${feedbackItemsSignature(items, handledIds)}`;
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  const indexEntry = creatorFeedbackIndex(items, handledIds).get(id);
  if (!indexEntry?.all.length) {
    const serverCounts = pendingCountsFromServer(post);
    const fallback = serverCounts || { ...emptySummary };
    summaryCache.set(cacheKey, fallback);
    return fallback;
  }

  const pendingItems = indexEntry.pending;
  const reported = pendingItems.filter(isCreatorFeedbackReported).length;
  const replies = pendingItems.filter((item) => item.type === 'reply' && !isCreatorFeedbackReported(item)).length;
  const comments = pendingItems.filter((item) => item.type === 'comment' && !isCreatorFeedbackReported(item)).length;
  const summary = {
    total: pendingItems.length,
    reported,
    comments,
    replies,
    normal: comments + replies
  };
  summaryCache.set(cacheKey, summary);
  if (summaryCache.size > 240) {
    summaryCache.delete(summaryCache.keys().next().value);
  }
  return summary;
}
