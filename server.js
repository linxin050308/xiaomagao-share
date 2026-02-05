const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 3000;

// ===== 数据存储：有 DATABASE_URL 用 Postgres；否则内存（便于调试） =====
const useDb = !!process.env.DATABASE_URL;
let pool = null;
let memoryPosts = [];
let nextId = 1;

if (useDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.RAILWAY_ENVIRONMENT ? { rejectUnauthorized: false } : false
  });
}

async function initDb() {
  if (!useDb) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      nickname VARCHAR(30) NOT NULL,
      token TEXT NOT NULL,
      numbers INT[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getPosts() {
  if (!useDb) return memoryPosts;
  const { rows } = await pool.query(`
    SELECT
      id, nickname, token, numbers,
      (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAt"
    FROM posts
    ORDER BY created_at DESC
    LIMIT 500
  `);

  return rows.map(r => ({
    id: Number(r.id),
    nickname: r.nickname,
    token: r.token,
    numbers: Array.isArray(r.numbers) ? r.numbers.map(Number) : [],
    createdAt: Number(r.createdAt)
  }));
}

async function addPost({ nickname, token, numbers }) {
  if (!useDb) {
    const p = { id: nextId++, nickname, token, numbers, createdAt: Date.now() };
    memoryPosts.unshift(p);
    memoryPosts = memoryPosts.slice(0, 500);
    return p;
  }

  const ret = await pool.query(
    `
    INSERT INTO posts (nickname, token, numbers)
    VALUES ($1, $2, $3::int[])
    RETURNING id, nickname, token, numbers,
      (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS "createdAt"
    `,
    [nickname, token, numbers]
  );

  // 只留最新 500 条
  await pool.query(`
    DELETE FROM posts
    WHERE id NOT IN (
      SELECT id FROM posts ORDER BY created_at DESC LIMIT 500
    )
  `);

  const r = ret.rows[0];
  return {
    id: Number(r.id),
    nickname: r.nickname,
    token: r.token,
    numbers: Array.isArray(r.numbers) ? r.numbers.map(Number) : [],
    createdAt: Number(r.createdAt)
  };
}

// ===== 业务规则：提取“独立三位数字” =====
// 例如：abc801x -> 801；1234 不算三位
function extractThreeDigitNumbers(text = "") {
  const result = [];
  const re = /(^|[^\d])(\d{3})(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) result.push(Number(m[2]));
  return result;
}

function validateToken(token) {
  if (!token || !token.trim()) return "口令不能为空";
  const nums = extractThreeDigitNumbers(token);
  if (nums.length === 0) return "口令中未找到三位阿拉伯数字";
  const bad = nums.find(n => n < 800);
  if (bad !== undefined) return `检测到三位数字 ${bad} < 800，禁止上传`;
  return null;
}

// ===== Socket 实时通信 =====
io.on("connection", async (socket) => {
  try {
    socket.emit("posts_update", await getPosts());
  } catch {
    socket.emit("posts_update", []);
  }

  socket.on("request_posts", async () => {
    try {
      socket.emit("posts_update", await getPosts());
    } catch {
      socket.emit("posts_update", []);
    }
  });

  socket.on("new_post", async (payload, ack) => {
    try {
      const nickname = String(payload?.nickname || "匿名玩家").trim().slice(0, 30) || "匿名玩家";
      const token = String(payload?.token || "").trim().slice(0, 500);

      const err = validateToken(token);
      if (err) return ack?.({ ok: false, error: err });

      const numbers = extractThreeDigitNumbers(token);
      await addPost({ nickname, token, numbers });

      const posts = await getPosts();
      io.emit("posts_update", posts); // 广播给所有在线用户
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "服务器处理失败，请稍后重试" });
    }
  });
});

// ===== 启动 =====
(async () => {
  await initDb();
  console.log(useDb ? "DB mode: PostgreSQL" : "DB mode: Memory");
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
