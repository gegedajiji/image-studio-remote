export function createCanvasNodeIndex(nodes = []) {
  return new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
}

export function canvasNodeById(index, id) {
  if (!id || !(index instanceof Map)) return null;
  return index.get(id) || null;
}
