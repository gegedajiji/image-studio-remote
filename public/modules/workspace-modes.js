export const workspaceModes = Object.freeze({
  image: {
    id: 'image',
    route: '/image/history',
    label: '图片工作台',
    status: 'active'
  },
  video: {
    id: 'video',
    route: '/video',
    label: '视频工作台',
    status: 'planned'
  }
});

export function plannedWorkspaceMode(id) {
  const mode = workspaceModes[id];
  return mode?.status === 'planned' ? mode : null;
}
