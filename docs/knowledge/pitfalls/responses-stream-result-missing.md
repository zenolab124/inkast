# SSE 流正常结束,但流里没有任何 base64

## 现象

`/v1/responses` 流式调用,**SSE 流正常关闭**(没 HTTP 错误、没连接中断、可能收到 `[DONE]` 终止帧),`response.image_generation_call.completed` 事件也来了——但整个流里**没有任何事件携带可用的 base64**,driver 兜底抛错:

```
responses mode: stream ended without an image_generation_call result.
The proxy may not have completed the tool call, or model declined to use it.
```

发现这个错偶发——同样配置同样 prompt,有时图能出来,有时只出"完成"通知没图。

## 根因

第三方代理在转发 SSE 时会做"事件过滤"——只透传它认识/认为有用的事件类型,扔掉其他。理论上图应该出现在三种事件之一:

| 事件 | 字段 | 标准性 |
| --- | --- | --- |
| `response.output_item.done` | `item.result`(item.type=image_generation_call) | 官方契约,最权威 |
| `response.image_generation_call.partial_image` | `partial_image_b64` | 用于实时显示,最后一帧是完整图 |
| `response.image_generation_call.completed` | `result`(非标但常见) | 部分代理把 result 塞这里 |

如果代理的转发白名单**只**列了 `completed` 不列 `output_item.done`,而代理本身又不主动把 result 塞到 `completed` 上,**三个事件都拿不到 base64**。

## 规避

driver 已经三层兜底监听(详见 [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md)),任一命中就拿到。流结束三种都没命中才报错——这种情况通常说明:

- **A. 代理转发太精简**——换 provider 或换 mode 到 `images`
- **B. 模型确实没调工具**——见 [responses-tool-not-invoked](./responses-tool-not-invoked.md),但通常那种会**完全没有** image_generation_call 事件,这里至少有 `completed`,所以是 A 的概率高

调试时打开后台日志看 `[image] …` 行,确认实际收到了哪些事件:

```
[image]   → STREAM https://anyrouter.top/v1/responses
[image]   ... response.created (+823ms)
[image]   ... response.in_progress (+901ms)
[image]   ... response.image_generation_call.in_progress (+1203ms)
[image]   ... response.image_generation_call.completed (+47891ms)   ← 收到但没 result
[image]   ... response.completed (+47920ms)
```

如果**没有** `output_item.done`,基本可以确定是代理过滤。

## 关联条目

- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — 三层兜底设计
- [responses-tool-not-invoked](./responses-tool-not-invoked.md) — 另一种"空 output"现象
- [proxy-no-retrieve-endpoint](./proxy-no-retrieve-endpoint.md) — 代理"OpenAI 兼容"不全的另一例
