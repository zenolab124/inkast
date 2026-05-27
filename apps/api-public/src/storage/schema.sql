-- 公开版核心 schema。idempotent,启动时 apply。
-- topup 通道(invite-code / ldc / ...)各自管自己表,见 src/topups/*/schema.sql。

-- 用户(Linux.do OAuth 拿到的身份)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  linux_do_id   TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  avatar_url    TEXT,
  trust_level   INTEGER,
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'banned'
  created_at    INTEGER NOT NULL,                -- epoch ms
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_linux_do_id ON users(linux_do_id);

-- 余额(独立表方便行级原子更新;单位"次")
CREATE TABLE IF NOT EXISTS user_balance (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- 余额流水(每次变动留痕,可对账)
-- type 字段开放字符串,由调用方约定(如 'topup:invite' / 'topup:ldc' /
-- 'consume:gen' / 'refund:gen' / 'system:grant'),核心不枚举,topup 通道
-- 自己定。delta 正为充值/退款/赠送,负为消费。balance_after 写入这次操作
-- 后的余额(冗余存储,方便对账时不用回放)。
CREATE TABLE IF NOT EXISTS balance_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  delta           INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reason          TEXT,
  related_id      TEXT,                          -- invite code / ldc order id / gen task id 等
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON balance_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_type_time ON balance_ledger(type, created_at DESC);

-- 生图任务元数据(不存图二进制,图在浏览器 IndexedDB)
-- channel: 'passthrough'(用户带自己 key)或 'builtin'(后端兜底 provider)
-- cost: 仅 builtin 通道 > 0(passthrough 不扣公开版余额)
CREATE TABLE IF NOT EXISTS gen_tasks (
  id            TEXT PRIMARY KEY,                -- uuid
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_json   TEXT NOT NULL,
  channel       TEXT NOT NULL,
  model         TEXT,
  cost          INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,                   -- 'pending' | 'success' | 'failed' | 'aborted'
  image_url     TEXT,                            -- 成功后的 R2 url
  error_code    TEXT,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gen_user_time ON gen_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_status_time ON gen_tasks(status, created_at DESC);

-- 限流计数(简单 KV,够用)
-- scope: 'ip:<ip>:<window-tag>' 或 'user:<user_id>:<window-tag>'
-- window-tag 例: 'min:202605271730' / 'day:20260527'
CREATE TABLE IF NOT EXISTS rate_limit (
  scope         TEXT PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL                 -- epoch ms,用于 GC 过期窗口
);

CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limit(window_start);

-- 会话(OAuth 登录后的浏览器 session)
-- token 是随机 32 字节 hex,经 cookie 存浏览器。expires_at 默认 30 天滚动。
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- OAuth 短暂状态(authorize 重定向到 callback 之间寄存 CSRF state + PKCE
-- code_verifier + 可选 post-login 重定向目标)。10 分钟过期,callback 消费即删。
CREATE TABLE IF NOT EXISTS oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  redirect_to    TEXT,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
