# i18n 字典与 useLanguage hook

强类型字典 + Context hook 驱动全应用文案切换。

## 文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/i18n/types.ts](../../../apps/web/src/i18n/types.ts) | `Translations` 接口(全部 t.* 路径强类型,缺 key 编译报错) + `Lang = "zh" \| "en"` |
| [apps/web/src/i18n/zh.ts](../../../apps/web/src/i18n/zh.ts) | 中文字典 |
| [apps/web/src/i18n/en.ts](../../../apps/web/src/i18n/en.ts) | 英文字典 |
| [apps/web/src/i18n/LanguageContext.tsx](../../../apps/web/src/i18n/LanguageContext.tsx) | `<LanguageProvider>` + `useLanguage()` hook + localStorage 持久化(key `inkast.lang`) |

## 字典结构(顶层 key)

```
app          : title / tagline
header       : config / dark / light / langZh / langEn
banner       : aiFillFailed / generateFailed / ok / close
composer     : label / optional / hint / placeholder / sample / cancel
               aiFill / aiFillAgain / aiFilling / titleHintFresh / titleHintOverride
               samples (string[]) / generateRaw / generateRawHint / generateRawPending
               reference / referenceAdd / referenceRemove
               referenceFromGallery / referenceUpload
               referenceSourceGallery / referenceSourceUpload
               referencePickTitle / referenceUploadHint / referenceEmpty
editor       : aiBadge / groups{basic,scene,mood,colors,text,others}
               fields{type,style,subject,background,layout,mood,lighting,camera,
                      colorPalette,textElements}
               placeholders{type,style,subject,background,layout,empty}
               json{show,hide,copy,copied} / generate{ready,pending}
palette      : emptyEditable / emptyReadonly / add / delete / presetLabel
textElems    : emptyEditable / emptyReadonly / content / position / font / size /
               color / contentPlaceholder / add / itemPrefix
gallery      : title / loading / loadError / reuse / download / openDetail
detail       : title / prompt / copyJson / copied / reuse / download
config       : title / description / add / edit / addNew / none / confirmDelete /
               loading / error / fields{...} / save / cancel
picker       : titlePrefix / search / clear / noMatch / customLabel /
               customPlaceholder / confirm / cancel
flash        : generateDone / skipped / noProvider / reuseLoaded
jobs         : statusPending / statusRunning
```

## 使用

```tsx
import { useLanguage } from "@/i18n/LanguageContext";

function Component() {
  const { t, lang, setLang } = useLanguage();
  return <button>{t.composer.aiFill}</button>;
}
```

## 嗅探初始语言

```ts
function detectInitialLang(): Lang {
  const saved = localStorage.getItem("inkast.lang") as Lang | null;
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
```

## 切换 + 持久化

```tsx
useEffect(() => {
  try { localStorage.setItem("inkast.lang", lang); } catch {}
}, [lang]);
```

## 注入 LLM 输出

`aiFill` 调用 `/api/draft-prompt` 时透传 `lang`,后端 `getPromptEngineSystemPrompt(lang)` 末尾追加最高优先级语言指令,模型按对应语言输出字段值。见 [i18n](../domains/i18n.md)。

## 关联条目

- [i18n](../domains/i18n.md) — 数据流全景
- [field-dictionary](field-dictionary.md) — 字段词典也走双语
