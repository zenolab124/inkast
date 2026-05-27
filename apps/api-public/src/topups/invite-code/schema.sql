-- invite-code topup 通道独立 schema。核心 db 不知道这张表的存在,
-- 通过 registerInviteCodeTopup() 在启动时 apply。

CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  amount      INTEGER NOT NULL,                   -- 兑换得到的次数
  used_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at     INTEGER,
  expires_at  INTEGER,                            -- NULL = 永不过期
  created_at  INTEGER NOT NULL,
  created_by  TEXT                                -- 'admin' / 'system' / 'campaign:xxx'
);

CREATE INDEX IF NOT EXISTS idx_invite_unused ON invite_codes(used_at) WHERE used_at IS NULL;
