import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 公开版数据目录。
 *   1. env PUBLIC_API_DATA_DIR(jdc 部署一般指向 /root/inkast-public/data)
 *   2. 默认 <repo>/data-public(本地 dev 用,与主线 data/ 隔离避免污染)
 */
export function dataDir(): string {
  const envDir = process.env.PUBLIC_API_DATA_DIR;
  const dir = envDir
    ? resolve(envDir)
    : resolve(process.cwd(), "..", "..", "data-public");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
