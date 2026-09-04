// Create the community comments table without touching existing data.
// This is kept separate from the generated Drizzle migrations because this
// repository historically deploys schema changes with `db:push`.
import "dotenv/config";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const conn = await mysql.createConnection(databaseUrl);
try {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      generationId bigint unsigned NOT NULL,
      userId bigint unsigned NOT NULL,
      body varchar(1000) NOT NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY comments_generation_created_idx (generationId, createdAt, id),
      KEY comments_user_created_idx (userId, createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("community comments table ready");
} finally {
  await conn.end();
}
