export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    const message = String(path || '').startsWith('/api/generate')
      ? '生图请求连接中断。请先查看历史记录和生图日志，系统会在失败时自动退款。'
      : '网络连接中断，请稍后重试。';
    const friendlyError = new Error(message);
    friendlyError.cause = error;
    friendlyError.status = 0;
    throw friendlyError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || `请求失败 (${response.status})`);
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function apiForm(path, formData) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      body: formData
    });
  } catch (error) {
    const friendlyError = new Error('生图请求连接中断。请先查看历史记录和生图日志，系统会在失败时自动退款。');
    friendlyError.cause = error;
    friendlyError.status = 0;
    throw friendlyError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || `请求失败 (${response.status})`);
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
