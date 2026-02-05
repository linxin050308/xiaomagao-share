const socket = io();

const nicknameEl = document.getElementById("nickname");
const tokenEl = document.getElementById("token");
const submitBtn = document.getElementById("submitBtn");
const refreshBtn = document.getElementById("refreshBtn");
const msgEl = document.getElementById("msg");
const postListEl = document.getElementById("postList");
const countEl = document.getElementById("count");

function setMsg(text, type = "") {
  msgEl.textContent = text || "";
  msgEl.className = "msg " + (type || "");
}
function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function formatTime(ts) {
  return new Date(ts).toLocaleString();
}
function renderPosts(posts) {
  countEl.textContent = `共 ${posts.length} 条`;
  if (!posts.length) {
    postListEl.innerHTML = `<div class="empty">暂无分享，快来发布第一条吧～</div>`;
    return;
  }

  postListEl.innerHTML = posts.map((p) => `
    <article class="post">
      <div class="meta">
        <span>${escapeHtml(p.nickname || "匿名玩家")}</span>
        <span>${formatTime(p.createdAt)}</span>
      </div>
      <div class="token">${escapeHtml(p.token || "")}</div>
      <div class="tag">识别到三位数字：${escapeHtml((p.numbers || []).join(", "))}</div>
      <button class="copy-btn" data-token="${escapeHtml(p.token || "")}">复制口令</button>
    </article>
  `).join("");
}

submitBtn.addEventListener("click", () => {
  const nickname = nicknameEl.value.trim();
  const token = tokenEl.value.trim();
  setMsg("");
  submitBtn.disabled = true;

  socket.emit("new_post", { nickname, token }, (res) => {
    submitBtn.disabled = false;
    if (!res?.ok) return setMsg(res?.error || "发布失败", "err");
    tokenEl.value = "";
    setMsg("发布成功，已实时同步。", "ok");
  });
});

refreshBtn.addEventListener("click", () => {
  socket.emit("request_posts");
  setMsg("已刷新。", "ok");
  setTimeout(() => setMsg(""), 1000);
});

socket.on("posts_update", (posts) => renderPosts(posts || []));

postListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const token = btn.getAttribute("data-token") || "";
  try {
    await navigator.clipboard.writeText(token);
    setMsg("已复制口令。", "ok");
  } catch {
    setMsg("复制失败，请手动复制。", "err");
  }
});
