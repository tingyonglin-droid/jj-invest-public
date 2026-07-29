# Automated Daily Morning Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每週一至週五台北時間上午 07:00，由 Codex 本機排程搜尋市場新聞、依核准規則選出五件焦點，並只建立一份待人工核准的晨報草稿。

**Architecture:** Codex 自動化負責網路研究與產生符合既有 schema 的 JSON；專案新增一個窄化的 server-side 提交邊界，直接重用既有 News Draft service 與 Redis repository。CLI 只具備「驗證並儲存 pending 草稿」能力，不提供核准、發布或評分入口。自動化失敗時 fail closed，不影響既有 App。

**Tech Stack:** Next.js 16、Node.js ESM、既有 Upstash Redis、Node test runner、ESLint、Codex local automation。

## Global Constraints

- 不新增 OpenAI API key，也不從 App server 呼叫模型。
- 不自動核准或公開晨報。
- 不修改 Dynamic Beta scoring、Target Beta、再平衡、持股、現金或今日建議。
- 不記錄 `.env.local`、Redis token、管理 token 或完整環境變數。
- 重複執行同一份內容時沿用既有 content-addressed draft revision，不建立無意義重複版本。
- 新聞排序遵守核准權重：影響廣度 25、時間迫近 20、市場關注 20、傳導路徑 20、意外性 10、來源可信度 5。

---

## Task 1: 建立只能新增 pending 草稿的提交核心

**Files:**

- Create: `src/lib/dynamic-beta/news/draft-submission.js`
- Create: `tests/dynamic-beta-morning-brief-submit.test.js`

- [ ] **Step 1: 先寫失敗測試**

測試下列外部可觀察行為：

1. `DYNAMIC_BETA_NEWS_DATA_ENABLED` 未開啟時拒絕提交。
2. JSON 不合法時回傳穩定錯誤碼，且訊息不含檔案內容或秘密。
3. Redis/service 未設定時 fail closed。
4. 既有 service 回報 schema 驗證失敗時，不宣稱已儲存。
5. 成功時只回傳安全摘要，並要求 draft 狀態必須是 `pending`。
6. 核心只呼叫 `service.create(payload)`，沒有 approve/reject 路徑。

預期介面：

```js
export class MorningBriefDraftSubmissionError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "MorningBriefDraftSubmissionError";
    this.code = code;
  }
}

export async function submitMorningBriefDraftFile({
  inputPath,
  readFile,
  newsDataEnabled,
  getService,
}) {}
```

成功結果固定投影為：

```js
{
  saved: true,
  valid: true,
  created: true,
  warningCount: 0,
  briefDate: "2026-07-29",
  draftRevisionId: "ndrv_example",
  draftRevisionNumber: 1,
  status: "pending",
}
```

- [ ] **Step 2: 執行單一測試，確認 RED**

Run:

```bash
node --test tests/dynamic-beta-morning-brief-submit.test.js
```

Expected: FAIL，原因是 module 尚不存在。

- [ ] **Step 3: 實作最小提交核心**

實作順序：讀檔 → JSON parse → feature flag → 取得 service → `service.create` → 驗證結果仍為 pending → 安全摘要。

穩定錯誤碼：

```js
INPUT_REQUIRED
INPUT_READ_FAILED
INVALID_JSON
NEWS_DATA_DISABLED
SERVICE_UNCONFIGURED
PAYLOAD_INVALID
UNSAFE_DRAFT_STATUS
SUBMISSION_FAILED
```

不回傳原始 payload、不回傳 Redis response、不回傳 stack trace。

- [ ] **Step 4: 執行測試，確認 GREEN**

Run:

```bash
node --test tests/dynamic-beta-morning-brief-submit.test.js
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/dynamic-beta/news/draft-submission.js tests/dynamic-beta-morning-brief-submit.test.js
git commit -m "feat: add safe morning brief draft submission"
```

---

## Task 2: 建立本機自動化可呼叫的 CLI adapter

**Files:**

- Create: `scripts/dynamic-beta-morning-brief-submit.js`
- Modify: `package.json`
- Modify: `tests/dynamic-beta-morning-brief-submit.test.js`

- [ ] **Step 1: 寫 CLI 失敗測試**

測試：

- 沒有或超過一個路徑參數時 exit code 1。
- 成功時 stdout 僅輸出一行 JSON 安全摘要。
- 失敗時 stderr 僅輸出一行 `{ ok:false, code, error }`，不含 stack、payload 或秘密。
- 使用 `getDynamicBetaNewsFlags(environment).dataEnabled`，只接受嚴格字串 `true`。
- `package.json` 提供 `morning-brief:draft:submit` 指令並由 `.env.local` 載入 server-side 環境變數。

預期可測介面：

```js
export async function runMorningBriefDraftSubmit({
  argv = process.argv.slice(2),
  environment = process.env,
  readFile,
  getService,
  stdout,
  stderr,
}) {}
```

- [ ] **Step 2: 執行測試，確認 RED**

Run:

```bash
node --test tests/dynamic-beta-morning-brief-submit.test.js
```

Expected: FAIL，原因是 CLI 尚不存在。

- [ ] **Step 3: 實作 CLI 與 package script**

CLI production dependencies：

```js
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createConfiguredNewsDraftService } from "../app/api/dynamic-beta/_shared.js";
import { getDynamicBetaNewsFlags } from "../src/lib/dynamic-beta/config.js";
import {
  MorningBriefDraftSubmissionError,
  submitMorningBriefDraftFile,
} from "../src/lib/dynamic-beta/news/draft-submission.js";
```

package script：

```json
"morning-brief:draft:submit": "node --env-file=.env.local scripts/dynamic-beta-morning-brief-submit.js"
```

CLI 不接受 token，不經過 public HTTP route，也沒有 approve/reject command。

- [ ] **Step 4: 執行 focused tests**

Run:

```bash
node --test tests/dynamic-beta-morning-brief-submit.test.js
```

Expected: PASS。

- [ ] **Step 5: 用既有 7/28 artifact 驗證冪等提交**

Run:

```bash
npm run morning-brief:draft:submit -- artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json
```

Expected: exit 0、status 為 `pending` 或既有同內容 pending revision 的安全摘要；不得核准或發布。

- [ ] **Step 6: Commit**

```bash
git add scripts/dynamic-beta-morning-brief-submit.js package.json tests/dynamic-beta-morning-brief-submit.test.js
git commit -m "feat: add morning brief draft submit cli"
```

---

## Task 3: 版本化每日研究與產稿操作契約

**Files:**

- Create: `docs/automations/dynamic-beta-daily-morning-brief.md`

- [ ] **Step 1: 寫入 automation prompt contract**

文件必須讓每次執行都遵守以下順序：

1. 以 Asia/Taipei 當日日期為 `briefDate`。
2. 搜尋前一個美股交易日收盤後至台北早上 07:00 前的重要資訊；若是假日，仍只使用最新可靠資料，不杜撰「今日市場已交易」。
3. 優先使用官方機構、公司 IR、交易所、政府資料及 AP/Reuters 等可靠媒體。
4. 將同一事件的多篇報導先聚類去重，再以核准的六項權重評分。
5. 選出恰好五件最可能影響大盤、利率、資金流、AI/半導體或台灣科技供應鏈的事件。
6. 每件事件需有傳導路徑、受影響資產、來源連結、信心值與誠實的 `dataToConfirm` / `confirmationRules`；沒有合理方向就用空陣列，不硬填。
7. 依既有 `validateMorningBriefPayload` schema 建立暫存 JSON。
8. 呼叫 `morning-brief:draft:submit`，只儲存 pending 草稿。
9. 若 schema 驗證失敗，只允許依錯誤修正一次；仍失敗就回報，不繞過驗證。
10. 回報五個標題、排序理由、draft revision ID 與管理頁連結；不得核准或公開。

文件同時明定：

- 不修改 repo 程式碼、不 commit、不 push。
- 不讀取或輸出 `.env.local`。
- 不執行評分、Target Beta、交易建議或再平衡。
- 新聞找不到足夠可靠證據時必須失敗，不以虛構事件湊滿五件。

- [ ] **Step 2: 以人工 dry review 壓測 prompt**

逐條確認它能處理：週末/假日、同題新聞去重、科技財報尚未公布、來源互相矛盾、確認數據無合理方向、重跑同一天。

- [ ] **Step 3: Commit**

```bash
git add docs/automations/dynamic-beta-daily-morning-brief.md
git commit -m "docs: define daily morning brief automation contract"
```

---

## Task 4: 建立 Codex 本機平日排程並做一次端到端驗證

**Files:**

- No repository file changes expected.

- [ ] **Step 1: 建立 project-scoped local automation**

透過 Codex Automation API 建立：

- 名稱：`JJ Invest 平日晨報草稿`
- 專案：目前 `jj-invest-public`
- 執行環境：local
- 時區：Asia/Taipei
- 時間：週一至週五 07:00
- 狀態：active
- Prompt：Task 3 的已版本化契約
- 通知：至少失敗時通知，成功時回報 draft 安全摘要

不得以作業系統 crontab 或 App API key 取代產品內建 automation。

- [ ] **Step 2: 讀回 automation 設定驗證**

確認名稱、專案、啟用狀態、執行環境與下一次執行時間正確；回報時使用自然語言，不輸出底層排程表示式。

- [ ] **Step 3: 手動執行一次今日流程**

以 2026-07-29 Asia/Taipei 市場背景搜尋、聚類、排序五件事件，產生 JSON 並執行 CLI。成功條件：

- 回傳 status `pending`。
- 管理頁可以選到 2026-07-29 草稿。
- 沒有 approved/public 版本被自動建立。
- Dynamic Beta score、Target Beta 與正式 App 行為完全未改。

- [ ] **Step 4: 驗證失敗隔離**

用測試注入的 invalid JSON / service unavailable 案例確認 automation 提交失敗只回報錯誤，不改動既有草稿或正式晨報。

---

## Task 5: 完整回歸與交付

**Files:**

- Modify only if verification exposes a defect in the files above.

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/dynamic-beta-morning-brief-submit.test.js tests/dynamic-beta-news.test.js tests/dynamic-beta-news-draft-ui.test.js
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Run production build**

```bash
npm run build
```

- [ ] **Step 5: 檢查 feature flags 與 git diff**

確認 scoring/public flags 仍為關閉，沒有 `.env.local`、秘密、無關影音素材或既有使用者資料進入 commit。

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/plans/2026-07-29-automated-daily-morning-brief.md
git commit -m "docs: add automated morning brief implementation plan"
```

- [ ] **Step 7: 回報**

回報：commit、變更檔案、排程時間、手動測試方式、今日草稿 ID、測試/lint/build 結果，以及明確說明沒有自動發布、沒有啟用 Dynamic Beta scoring。
