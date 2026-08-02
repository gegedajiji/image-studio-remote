// 仅创建画布相关新表（不影响现有数据）
import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

await conn.query(`
  CREATE TABLE IF NOT EXISTS canvas_nodes (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId bigint unsigned NOT NULL,
    type enum('image','prompt','copy') NOT NULL,
    refId bigint unsigned,
    title varchar(255),
    content text,
    x double NOT NULL DEFAULT 0,
    y double NOT NULL DEFAULT 0,
    w int NOT NULL DEFAULT 280,
    z int NOT NULL DEFAULT 0,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await conn.query(`
  CREATE TABLE IF NOT EXISTS canvas_edges (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId bigint unsigned NOT NULL,
    fromId bigint unsigned NOT NULL,
    toId bigint unsigned NOT NULL,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log("canvas tables ready");
await conn.end();
process.exit(0);
