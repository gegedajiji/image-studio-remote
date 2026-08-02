import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { generationRouter, communityRouter } from "./generationRouter";
import { userRouter } from "./userRouter";
import { adminRouter } from "./adminRouter";
import { canvasRouter } from "./canvasRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  generation: generationRouter,
  community: communityRouter,
  user: userRouter,
  admin: adminRouter,
  canvas: canvasRouter,
});

export type AppRouter = typeof appRouter;
