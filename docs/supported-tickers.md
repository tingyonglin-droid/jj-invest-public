# 完整支援標的清單

> 本文件由 `src/data/supported-tickers.json` 自動產生。App 的標的名稱也直接讀取同一份 JSON。

目前共 20 檔已驗證標的。驗證代表名稱與即時股價均可正常顯示。

## 正二

| 輸入代號 | 顯示名稱 | 市場 | 支援符號 | 報價順序 | 驗證日期 |
|---|---|---|---|---|---|
| 00631L | 元大台灣50正2 | TWSE | 00631L.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 00685L | 群益台灣加權正2 | TWSE | 00685L.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 00663L | 國泰台灣加權正2 | TWSE | 00663L.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 00675L | 富邦台灣加權正2 | TWSE | 00675L.TW | TWSE → Yahoo Finance | 2026-08-11 |
| SSO | ProShares Ultra S&P500 | US | SSO | Yahoo Finance | 2026-08-11 |
| QLD | ProShares Ultra QQQ | US | QLD | Yahoo Finance | 2026-08-11 |
| USD | ProShares Ultra Semiconductors | US | USD | Yahoo Finance | 2026-08-11 |

## 原形

| 輸入代號 | 顯示名稱 | 市場 | 支援符號 | 報價順序 | 驗證日期 |
|---|---|---|---|---|---|
| 0050 | 元大台灣50 | TWSE | 0050.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 006208 | 富邦台50 | TWSE | 006208.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 00662 | 富邦NASDAQ | TWSE | 00662.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 009816 | 凱基台灣TOP50 | TWSE | 009816.TW | TWSE → Yahoo Finance | 2026-08-11 |
| VOO | Vanguard S&P 500 ETF | US | VOO | Yahoo Finance | 2026-08-11 |
| QQQ | Invesco QQQ Trust ETF | US | QQQ | Yahoo Finance | 2026-08-11 |
| SMH | VanEck Semiconductor ETF | US | SMH | Yahoo Finance | 2026-08-11 |
| SOXX | iShares Semiconductor ETF | US | SOXX | Yahoo Finance | 2026-08-11 |

## 類現金

| 輸入代號 | 顯示名稱 | 市場 | 支援符號 | 報價順序 | 驗證日期 |
|---|---|---|---|---|---|
| 00865B | 國泰US短期公債 | TWSE | 00865B.TW | TWSE → Yahoo Finance | 2026-08-11 |
| 00864B | 中信美國公債0-1 | TPEx | 00864B.TW、00864B.TWO | TPEx → Yahoo Finance | 2026-08-11 |
| 00859B | 群益0-1年美債 | TPEx | 00859B.TW、00859B.TWO | TPEx → Yahoo Finance | 2026-08-11 |
| SGOV | iShares 0-3 Month Treasury Bond ETF | US | SGOV | Yahoo Finance | 2026-08-11 |
| BSV | Vanguard Short-Term Bond ETF | US | BSV | Yahoo Finance | 2026-08-11 |

## 新增或編輯標的

1. 編輯 `src/data/supported-tickers.json`。
2. 新增或修改一筆標的資料；`symbols` 必須列出 App 可能收到的完整代號。
3. 執行 `pnpm docs:supported-tickers` 重新產生本文件。
4. 執行 `pnpm test tests/supported-tickers.test.js tests/presentation.test.js` 驗證資料。

### 欄位說明

| 欄位 | 用途 |
|---|---|
| `ticker` | 使用者在設定頁輸入的代號 |
| `symbols` | 正規化或報價來源可能回傳的代號，例如 `.TW`、`.TWO` |
| `name` | App 顯示名稱 |
| `category` | `leveraged`、`original` 或 `cashEquivalent` |
| `market` | `TWSE`、`TPEx` 或 `US` |
| `quoteSources` | 報價查詢來源與備援順序 |
| `verified` | 是否已實際驗證名稱與股價 |
| `verifiedAt` | 最近驗證日期，格式為 `YYYY-MM-DD` |
