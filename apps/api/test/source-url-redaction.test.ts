import assert from 'node:assert/strict'
import test from 'node:test'
import { redactUrl } from '../src/domain/plugin-async/url-redaction.js'

test('七牛 S3 短期签名 URL 在日志和错误中只保留 origin 与 path', () => {
  const raw = 'https://s3.cn-north-1.qiniucs.com/mp-inkast-user-media/source/img_test?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=secret#fragment'
  const redacted = redactUrl(raw)
  assert.equal(redacted, 'https://s3.cn-north-1.qiniucs.com/mp-inkast-user-media/source/img_test')
  assert.doesNotMatch(redacted, /X-Amz|Credential|secret|fragment/)
})

test('URL 用户名密码与畸形值 fail-closed', () => {
  assert.equal(redactUrl('https://user:pass@example.com/source.png?token=secret'), '<redacted-credentials>')
  assert.equal(redactUrl('not a url?token=secret'), '<malformed>')
})
