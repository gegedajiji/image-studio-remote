import { state } from './state.js';
import { communityHeatHelpText } from './constants.js';
import { escapeHtml, formatDate, yuan } from './format.js';
import {
  billingStateText,
  durationText,
  generationModeText,
  generationStatusText,
  qualityLabel,
  redeemStatusForClass,
  redeemStatusText,
  sourceText,
  userStatusText
} from './studio-format.js';

function renderFailureList(items = [], emptyText = '无') {
  const failures = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  if (!failures.length) return `<span>${escapeHtml(emptyText)}</span>`;
  return `<ul>${failures.map((item) => {
    const indexText = Number.isFinite(Number(item.index)) ? `#${Number(item.index) + 1} ` : '';
    const imageIndexText = Number.isFinite(Number(item.imageIndex)) ? `第 ${Number(item.imageIndex) + 1} 张 · ` : '';
    const channelText = item.name || item.upstreamName || item.id || '';
    const statusText = item.statusCode ? `HTTP ${item.statusCode}` : (item.code || '');
    const duration = Number(item.durationMs || 0) ? durationText(item.durationMs) : '';
    const retryAfter = Number(item.retryAfterMs || 0) ? `建议等待 ${durationText(item.retryAfterMs)}` : '';
    const resultText = item.success ? '成功' : (item.message || '失败');
    const meta = [imageIndexText + channelText, statusText, duration, retryAfter].filter(Boolean).join(' · ');
    return `<li class="${item.success ? 'is-success' : ''}"><strong>${escapeHtml(indexText + resultText)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}

export function adminImageUpstreamsHtml(upstreams = []) {
  return upstreams.map((item, index) => {
    const keyState = item.upstreamApiKeyConfigured
      ? `当前 ${escapeHtml(item.upstreamApiKeyMasked || '已配置')}`
      : '未配置';
    const cooling = Number(item.cooldownUntil || 0) > Date.now();
    const stateText = cooling
      ? `冷却中，${formatDate(item.cooldownUntil)} 后恢复`
      : (item.lastUsedAt ? `最近使用 ${formatDate(item.lastUsedAt)}` : '等待调度');
    const errorText = item.lastError ? `<small class="admin-upstream-error">最近错误：${escapeHtml(item.lastError)}</small>` : '';
    return `
      <article class="admin-upstream-card" data-upstream-id="${escapeHtml(item.id || '')}">
        <div class="admin-upstream-card-head">
          <label class="admin-upstream-toggle">
            <input type="checkbox" data-upstream-field="enabled" ${item.enabled !== false ? 'checked' : ''} />
            <span>${item.enabled !== false ? '启用' : '停用'}</span>
          </label>
          <label class="admin-upstream-toggle">
            <input type="checkbox" data-upstream-field="autoBan" ${item.autoBan ? 'checked' : ''} />
            <span>连续失败自动停用</span>
          </label>
          <span class="admin-upstream-rank">${cooling ? '冷却中' : '可调度'} · 优先级 ${escapeHtml(String(item.priority || (100 - index)))} · 权重 ${escapeHtml(String(item.weight || 1))}</span>
        </div>
        <div class="admin-upstream-card-grid">
          <label>通道名称<input data-upstream-field="name" type="text" value="${escapeHtml(item.name || `生图通道 ${index + 1}`)}" autocomplete="off" /></label>
          <label>优先级<input data-upstream-field="priority" type="number" min="1" max="999" step="1" value="${escapeHtml(String(item.priority || (100 - index)))}" inputmode="numeric" /></label>
          <label>权重<input data-upstream-field="weight" type="number" min="1" max="100" step="1" value="${escapeHtml(String(item.weight || 1))}" inputmode="numeric" /></label>
          <label>Base URL<input data-upstream-field="upstreamBaseUrl" type="url" inputmode="url" value="${escapeHtml(item.upstreamBaseUrl || '')}" placeholder="https://image-upstream.example.com" autocomplete="off" /></label>
          <label>API Key <small>${keyState}</small><input data-upstream-field="upstreamApiKey" type="password" placeholder="留空则不修改当前 Key" autocomplete="new-password" /></label>
          <label>图像模型<input data-upstream-field="imageModel" type="text" value="${escapeHtml(item.imageModel || '')}" placeholder="gpt-image-2" autocomplete="off" /></label>
        </div>
        <div class="admin-upstream-state">
          <span>${escapeHtml(stateText)}</span>
          <span>失败 ${escapeHtml(String(item.failureCount || 0))} 次</span>
          ${errorText}
        </div>
        <div class="admin-upstream-card-actions">
          <button type="button" data-admin-remove-upstream="${escapeHtml(item.id || '')}" ${upstreams.length <= 1 ? 'disabled' : ''}>删除通道</button>
        </div>
      </article>
    `;
  }).join('');
}

export function adminGenerationUserOptionsHtml(users = [], current = '') {
  const managedUsers = users.filter((user) => user.role !== 'admin' && user.status !== 'deleted');
  return [
    '<option value="">全部用户</option>',
    ...managedUsers.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username || user.account)} · ${escapeHtml(user.account || '')}</option>`)
  ].join('');
}

export function adminGenerationLogsHtml({
  logs = [],
  loading = false,
  stats = {},
  total = 0,
  page = 1,
  limit = 50
} = {}) {
  const maxPage = Math.max(1, Math.ceil(total / limit));
  if (loading && !logs.length) return '<p class="feature-empty">正在读取生图日志…</p>';
  return logs.length ? `
    <table>
      <thead>
        <tr>
          <th>用户 / 时间</th>
          <th>任务</th>
          <th>扣费</th>
          <th>状态</th>
          <th>通道 / 耗时</th>
          <th>提示词 / 错误</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map((item) => {
          const statusClass = item.status === 'succeeded' ? 'active' : item.status === 'failed' ? 'deleted' : 'used';
          const refundText = Number(item.refundAmountCents || 0) > 0 ? ` / 退 ${yuan(item.refundAmountCents)}` : '';
          const failureBrief = Array.isArray(item.batchFailures) && item.batchFailures.length
            ? item.batchFailures.map((failure) => `#${Number(failure.index || 0) + 1} ${failure.message || '失败'}`).join('；')
            : '';
          const promptText = item.errorPreview || failureBrief
            ? `<strong class="admin-log-error">${escapeHtml(item.errorPreview || failureBrief)}</strong><small>${escapeHtml(item.promptPreview || '')}</small>`
            : `<span>${escapeHtml(item.promptPreview || '-')}</span>`;
          const detailError = item.errorPreview || failureBrief || '无';
          const detailPrompt = item.promptFull || item.promptPreview || '-';
          const partialRefundText = Number(item.refundAmountCents || 0) > 0 && Number(item.returnedCount || 0) > 0
            ? ` · 实扣 ${yuan(item.netAmountCents || 0)}`
            : '';
          const historyDeletedText = item.deletedFromHistoryAt ? `<small>用户已清理历史 · ${escapeHtml(formatDate(item.deletedFromHistoryAt))}</small>` : '';
          const detailMoney = [
            `预扣 ${yuan(item.consumeAmountCents || item.priceCents || 0)}`,
            Number(item.refundAmountCents || 0) > 0 ? `退款 ${yuan(item.refundAmountCents)}` : '',
            `净扣 ${yuan(item.netAmountCents || 0)}`,
            Number.isFinite(Number(item.balanceAfterCents)) ? `余额 ${yuan(item.balanceAfterCents)}` : ''
          ].filter(Boolean).join(' · ');
          return `
            <tr>
              <td>
                <div class="admin-log-user"><strong>${escapeHtml(item.username || '未知用户')}</strong><small>${escapeHtml(item.account || item.userId || '')}</small><small>${escapeHtml(formatDate(item.createdAt))}</small>${historyDeletedText}</div>
              </td>
              <td>
                <div class="admin-log-task"><strong>${escapeHtml(generationModeText(item.mode))} · ${escapeHtml(qualityLabel(item.quality))}</strong><small>${escapeHtml(sourceText(item.source))} · ${escapeHtml(item.size || '-')} · ${escapeHtml(String(item.returnedCount || item.imageCount || 0))}/${escapeHtml(String(item.requestedCount || item.count || 1))} 张</small></div>
              </td>
              <td>
                <div class="admin-log-money"><strong>${yuan(item.consumeAmountCents || item.priceCents || 0)}${refundText}</strong><small>${escapeHtml(billingStateText(item.billingState))}${partialRefundText}${Number.isFinite(Number(item.balanceAfterCents)) ? ` · 余 ${yuan(item.balanceAfterCents)}` : ''}</small></div>
              </td>
              <td><span class="admin-status-pill ${statusClass}">${escapeHtml(generationStatusText(item.status))}</span></td>
              <td>
                <div class="admin-log-upstream"><strong>${escapeHtml(item.upstreamName || item.upstreamModel || item.model || '-')}</strong><small>${escapeHtml(durationText(item.durationMs))}</small></div>
              </td>
              <td>
                <div class="admin-log-prompt">
                  ${promptText}
                  <details class="admin-log-detail">
                    <summary>展开详情</summary>
                    <dl>
                      <div><dt>任务 ID</dt><dd><code>${escapeHtml(item.id || '-')}</code></dd></div>
                      <div><dt>完整提示词</dt><dd><pre>${escapeHtml(detailPrompt)}</pre></dd></div>
                      <div><dt>错误</dt><dd>${escapeHtml(detailError)}</dd></div>
                      <div><dt>计费</dt><dd>${escapeHtml(detailMoney)}</dd></div>
                      <div><dt>上游</dt><dd>${escapeHtml([item.upstreamName, item.upstreamModel || item.model, item.upstreamId].filter(Boolean).join(' · ') || '-')}</dd></div>
                      <div><dt>批量失败</dt><dd>${renderFailureList(item.batchFailures)}</dd></div>
                      <div><dt>通道尝试</dt><dd>${renderFailureList(item.upstreamAttempts)}</dd></div>
                    </dl>
                  </details>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : '<p class="feature-empty">当前筛选下暂无生图日志。</p>';
}

export function adminRedeemCodesHtml({
  codes = [],
  loading = false,
  total = 0,
  page = 1,
  limit = 100,
  stats = {},
  allStats = {},
  selectedIds = []
} = {}) {
  const maxPage = Math.max(1, Math.ceil(total / limit));
  if (loading && !codes.length) return '<p class="feature-empty">正在读取兑换卡密...</p>';
  return codes.length ? `
    <table>
      <thead>
        <tr>
          <th>选择</th>
          <th>卡密</th>
          <th>金额</th>
          <th>状态</th>
          <th>使用用户</th>
          <th>时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${codes.map((item) => {
          const canSelect = item.status === 'active';
          const checked = canSelect && selectedIds.includes(item.id) ? 'checked' : '';
          const action = item.status === 'active'
            ? `<button type="button" data-admin-revoke-code="${escapeHtml(item.id)}">撤销</button>`
            : `<button type="button" disabled>${redeemStatusText(item.status)}</button>`;
          return `
            <tr>
              <td>${canSelect ? `<input type="checkbox" data-admin-redeem-select="${escapeHtml(item.id)}" ${checked} />` : '-'}</td>
              <td><code>${escapeHtml(item.code)}</code></td>
              <td>${yuan(item.amountCents)}</td>
              <td><span class="admin-status-pill ${escapeHtml(redeemStatusForClass(item.status))}">${escapeHtml(redeemStatusText(item.status))}</span></td>
              <td>${escapeHtml(item.usedByName || item.usedByAccount || '-')}</td>
              <td>${escapeHtml(formatDate(item.usedAt || item.revokedAt || item.createdAt))}</td>
              <td>${action}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : '<p class="feature-empty">当前筛选下暂无兑换卡密。</p>';
}

export function adminUsersHtml({ users = [], search = '' } = {}) {
  const keyword = search.trim().toLowerCase();
  const managedUsers = users
    .filter((user) => user.role !== 'admin')
    .filter((user) => {
      if (!keyword) return true;
      return [user.username, user.account]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(keyword));
    });
  return managedUsers.length ? `
    <table>
      <thead>
        <tr>
          <th>用户</th>
          <th>账号</th>
          <th>余额</th>
          <th>状态</th>
          <th>创建时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${managedUsers.map((user) => {
          const isDeleted = user.status === 'deleted';
          const statusButton = user.status === 'active'
            ? `<button type="button" data-admin-user-status="${escapeHtml(user.id)}" data-next-status="disabled">禁用</button>`
            : `<button type="button" data-admin-user-status="${escapeHtml(user.id)}" data-next-status="active" ${isDeleted ? 'disabled' : ''}>启用</button>`;
          return `
            <tr class="${isDeleted ? 'muted' : ''}">
              <td>${escapeHtml(user.username || user.account)}</td>
              <td><code>${escapeHtml(user.account || user.username)}</code></td>
              <td>${yuan(user.balanceCents)}</td>
              <td><span class="admin-status-pill ${escapeHtml(user.status)}">${escapeHtml(userStatusText(user.status))}</span></td>
              <td>${escapeHtml(formatDate(user.createdAt))}</td>
              <td>
                <div class="admin-row-actions">
                  <button type="button" data-admin-reset-password="${escapeHtml(user.id)}" ${isDeleted ? 'disabled' : ''}>重置密码</button>
                  ${statusButton}
                  <button type="button" data-admin-delete-user="${escapeHtml(user.id)}" ${isDeleted ? 'disabled' : ''}>删除</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : '<p class="feature-empty">暂无普通用户。</p>';
}

export function adminCommunityHtml({ posts = [], comments = [] } = {}) {
  const reportedCount = comments.filter((comment) => Number(comment.reportCount || 0) > 0).length;
  return {
    posts: posts.length ? posts.map((post) => `
      <article class="admin-community-item">
        <img src="${escapeHtml(post.imageUrl || '/assets/showcase/hero-studio.svg')}" alt="" loading="lazy" />
        <div>
          <strong>${escapeHtml(post.title || '未命名作品')}</strong>
          <span title="${escapeHtml(communityHeatHelpText)}">${escapeHtml(post.username || '创作者')} · 互动热度 ${escapeHtml(String(post.hotScore || 0))}</span>
          <small>主：${post.likeCount || 0} 赞 / ${post.commentCount || 0} 评论 · 辅助：${post.reuseCount || 0} 参考延展 / ${post.downloadCount || 0} 位用户免费下载</small>
        </div>
        <button type="button" data-admin-community-open="${escapeHtml(post.id)}">查看</button>
      </article>
    `).join('') : '<p class="feature-empty">暂无公开作品。</p>',
    comments: comments.filter((comment) => Number(comment.reportCount || 0) > 0).length ? comments.filter((comment) => Number(comment.reportCount || 0) > 0).map((comment) => `
      <article class="admin-community-item comment">
        <div>
          <strong>${escapeHtml(comment.username || '用户')}${comment.isAuthor ? ' · 作者' : ''}</strong>
          <span>${escapeHtml(comment.postTitle || '交流区作品')} · ${escapeHtml(formatDate(comment.createdAt))}</span>
          <small>${comment.reportCount || 0} 举报 · ${escapeHtml(comment.body || '').slice(0, 90)}</small>
        </div>
        <button type="button" data-admin-community-open="${escapeHtml(comment.postId)}">查看</button>
      </article>
    `).join('') : '<p class="feature-empty">暂无被举报评论。</p>',
    reportedCount
  };
}
