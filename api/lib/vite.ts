import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use(
    "/generated/*",
    serveStatic({
      root: "./data",
      onFound: (_path, c) => {
        // Filenames are UUIDs and never change, so browsers/CDNs can keep
        // generated images for a year. This removes the repeated slow image
        // downloads observed in the history view.
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    })
  );
  app.use(
    "/avatars/*",
    serveStatic({
      root: "./data",
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=86400");
      },
    })
  );
  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound(c => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
