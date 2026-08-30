import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { canvasEdges, canvasNodes, generations } from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { generateCopy } from "./copyEngine";

export const canvasRouter = createRouter({
  // 画布全量状态
  state: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const nodes = await db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.userId, ctx.user.id))
      .orderBy(asc(canvasNodes.z), asc(canvasNodes.id));
    const edges = await db
      .select()
      .from(canvasEdges)
      .where(eq(canvasEdges.userId, ctx.user.id))
      .orderBy(asc(canvasEdges.id));

    // 附带 image 节点的图片信息
    const imageIds = nodes.filter((n) => n.type === "image" && n.refId).map((n) => n.refId!) as number[];
    const genMap = new Map<number, { imageUrl: string | null; prompt: string; model: string }>();
    if (imageIds.length) {
      const gens = await db
        .select({
          id: generations.id,
          imageUrl: generations.imageUrl,
          prompt: generations.prompt,
          model: generations.model,
        })
        .from(generations)
        .where(
          and(
            inArray(generations.id, imageIds),
            eq(generations.userId, ctx.user.id)
          )
        );
      for (const g of gens) {
        genMap.set(g.id, { imageUrl: g.imageUrl, prompt: g.prompt, model: g.model });
      }
    }
    return { nodes, edges, images: Object.fromEntries(genMap) };
  }),

  addNode: authedQuery
      .input(
      z.object({
        type: z.enum(["image", "prompt", "copy"]),
        refId: z.number().int().positive().optional(),
        title: z.string().max(255).optional(),
        content: z.string().max(8000).optional(),
        x: z.number(),
        y: z.number(),
        w: z.number().int().min(180).max(800).default(280),
        z: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.type !== "image" && input.refId !== undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只有图像节点可以关联作品",
        });
      }
      if (input.type === "image" && input.refId !== undefined) {
        const [g] = await db.select().from(generations).where(eq(generations.id, input.refId));
        if (!g || g.userId !== ctx.user.id || g.status !== "success" || !g.imageUrl) {
          throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在" });
        }
      }
      const [{ id }] = await db
        .insert(canvasNodes)
        .values({
          userId: ctx.user.id,
          type: input.type,
          refId: input.refId ?? null,
          title: input.title ?? null,
          content: input.content ?? null,
          x: input.x,
          y: input.y,
          w: input.w,
          z: input.z,
        })
        .$returningId();
      const [node] = await db.select().from(canvasNodes).where(eq(canvasNodes.id, id));
      return node;
    }),

  updateNode: authedQuery
    .input(
      z.object({
        id: z.number(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().int().min(180).max(800).optional(),
        z: z.number().int().optional(),
        title: z.string().max(255).optional(),
        content: z.string().max(8000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...patch } = input;
      if (!Object.keys(patch).length) return { ok: true };
      await db
        .update(canvasNodes)
        .set(patch)
        .where(and(eq(canvasNodes.id, id), eq(canvasNodes.userId, ctx.user.id)));
      return { ok: true };
    }),

  removeNode: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.transaction(async tx => {
        await tx
          .delete(canvasEdges)
          .where(
            and(
              eq(canvasEdges.userId, ctx.user.id),
              or(eq(canvasEdges.fromId, input.id), eq(canvasEdges.toId, input.id)),
            ),
          );
        await tx
          .delete(canvasNodes)
          .where(and(eq(canvasNodes.id, input.id), eq(canvasNodes.userId, ctx.user.id)));
      });
      return { ok: true };
    }),

  addEdge: authedQuery
    .input(z.object({ fromId: z.number().int().positive(), toId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.fromId === input.toId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能连接自身" });
      }
      const db = getDb();
      return db.transaction(async tx => {
        const nodes = await tx
          .select({ id: canvasNodes.id })
          .from(canvasNodes)
          .where(
            and(
              eq(canvasNodes.userId, ctx.user.id),
              inArray(canvasNodes.id, [input.fromId, input.toId])
            )
          )
          .for("update");
        if (nodes.length !== 2) {
          throw new TRPCError({ code: "NOT_FOUND", message: "画布节点不存在" });
        }
        const [existing] = await tx
          .select()
          .from(canvasEdges)
          .where(
            and(
              eq(canvasEdges.userId, ctx.user.id),
              eq(canvasEdges.fromId, input.fromId),
              eq(canvasEdges.toId, input.toId)
            )
          )
          .limit(1);
        if (existing) return existing;
        const [{ id }] = await tx
          .insert(canvasEdges)
          .values({ userId: ctx.user.id, fromId: input.fromId, toId: input.toId })
          .$returningId();
        const [edge] = await tx
          .select()
          .from(canvasEdges)
          .where(eq(canvasEdges.id, id));
        return edge;
      });
    }),

  removeEdge: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .delete(canvasEdges)
        .where(and(eq(canvasEdges.id, input.id), eq(canvasEdges.userId, ctx.user.id)));
      return { ok: true };
    }),

  // 一键生成社交文案：在图像节点旁创建文案节点并自动连线
  generateCopy: authedQuery
    .input(
      z.object({
        imageNodeId: z.number(),
        platform: z.enum(["douyin", "xhs"]),
        language: z.enum(["zh", "en", "mixed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return db.transaction(async tx => {
        const [imageNode] = await tx
          .select()
          .from(canvasNodes)
          .where(and(eq(canvasNodes.id, input.imageNodeId), eq(canvasNodes.userId, ctx.user.id)))
          .for("update");
        if (!imageNode || imageNode.type !== "image" || !imageNode.refId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "请选择图像节点" });
        }
        const [g] = await tx
          .select()
          .from(generations)
          .where(
            and(
              eq(generations.id, imageNode.refId),
              eq(generations.userId, ctx.user.id),
            ),
          )
          .for("update");
        if (!g || g.status !== "success" || !g.imageUrl) {
          throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在" });
        }

        const copy = generateCopy(g.prompt, input.platform, input.language);
        const [{ id }] = await tx
          .insert(canvasNodes)
          .values({
            userId: ctx.user.id,
            type: "copy",
            title: copy.title,
            content: JSON.stringify(copy),
            x: imageNode.x + imageNode.w + 80,
            y: imageNode.y,
            w: 320,
            z: imageNode.z + 1,
          })
          .$returningId();
        const [node] = await tx.select().from(canvasNodes).where(eq(canvasNodes.id, id));
        const [{ id: edgeId }] = await tx
          .insert(canvasEdges)
          .values({ userId: ctx.user.id, fromId: imageNode.id, toId: id })
          .$returningId();
        const [edge] = await tx.select().from(canvasEdges).where(eq(canvasEdges.id, edgeId));
        return { node, edge, copy };
      });
    }),
});
