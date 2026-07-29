# JJ Invest 平日晨報草稿 Automation Contract

## 任務

你正在 `jj-invest-public` 專案執行內部晨報產稿工作。以 Asia/Taipei 的執行日期為 `briefDate`，搜尋最新且可靠的市場資訊，選出最可能影響今日或下一交易時段股市行情的五個事件，建立符合既有 Morning Brief schema 的 JSON，並透過專案 CLI 儲存為 **pending 草稿**。

這不是投資建議，也不是 Dynamic Beta 計分。不得核准、拒絕、發布草稿，不得修改正式 App、使用者資料或投資邏輯。

## 執行前檢查

1. 確認目前工作目錄是 `jj-invest-public`。
2. 讀取以下檔案，使用當下版本作為唯一規格：
   - `docs/superpowers/specs/2026-07-29-automated-daily-morning-brief-design.md`
   - `src/lib/dynamic-beta/news/schema.js`
   - `src/lib/dynamic-beta/news/topics.js`
   - `artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json`（只作 JSON 結構範例，不複製舊新聞）
3. 不讀取、顯示或摘要 `.env.local`。CLI 會自行在 server side 載入需要的設定。
4. 不修改 repository 內任何檔案，不 commit、不 push。每日暫存 JSON 應放在系統暫存目錄。

## 研究範圍

研究窗優先涵蓋前一個美股交易日收盤後至台北早上 07:00 前的新發展，也可使用較早的官方背景資料解釋當前事件。週一應涵蓋週末；台灣或美國假日仍照常研究全球市場，但不得把尚未交易的市場反應寫成已發生。

動態搜尋，不固定只看五個網站，優先順序為：

1. 中央銀行、政府機構、交易所、公司申報與 Investor Relations 等第一手來源。
2. Reuters、AP 等具原始採訪與市場報價能力的可靠媒體。
3. 只有在補足必要脈絡時才使用次級來源，且重要主張要能追溯至更強來源。

關注範圍：

- 全球總經、Fed、通膨、就業、殖利率、公債標售、流動性；
- 地緣政治、能源供應、Brent、WTI、航運；
- AI、半導體、資料中心與融資環境；
- 美國科技巨頭及其對指數估值的影響；
- 台灣科技與半導體供應鏈；
- 台灣信用交易的官方整戶擔保維持率、融資餘額與可能的追繳／斷頭壓力；
- 重要財報與經濟數據；
- 科技財報相關時，特別檢查營收、AI/Cloud 成長、CapEx、自由現金流，以及 CapEx 是否快於自由現金流成長。

## 去重與五大焦點排序

先把候選文章依「同一底層事件」聚類；同一篇通訊社稿件的轉載只算同一來源脈絡。同一事件不得用不同標題占兩個名次。

為每個候選事件作 0–100 的 Market Attention Ranking：

| 維度 | 權重 | 判斷問題 |
|---|---:|---|
| 影響廣度 | 25 | 能影響大盤、多種資產、主要產業或只是一家小公司？ |
| 時間迫近 | 20 | 可能影響今日開盤、交易時段或近期重新定價嗎？ |
| 市場關注 | 20 | 多個獨立可靠來源及市場定價是否正聚焦此事？ |
| 傳導路徑 | 20 | 能否清楚連到利率、通膨、獲利、流動性、風險偏好或估值？ |
| 意外性 | 10 | 是否顯著偏離先前預期並迫使市場重估？ |
| 來源可信度 | 5 | 是否有官方或可靠原始報導支持？ |

由高至低選出恰好五個事件。分數接近時，優先避免五件都重複同一窄題材。不要為了湊題材配額犧牲真正的市場重要性，也不要把文章數量直接當成市場關注度。

若無法找到五個具有可靠證據的獨立事件，整次任務失敗，不得虛構或以低品質內容湊滿。

## JSON 規則

Payload 必須通過現有 `validateMorningBriefPayload`：

- `briefDate` 是 Asia/Taipei 當日日期；`generatedAt` 是可靠的實際 UTC 時間。
- `analystLabel` 只能使用 schema 允許值，且 `analystRationale` 明確是定性判讀，不假裝是量化模型。
- `evidence` 包含來源名稱、tier、標題、URL、摘要；無法可靠取得發布時間時填 `null`，不得推測。
- `events` 恰好五件，rank 為 1–5；每件都有 headline、summary、topicIds、evidenceUrls、transmissionPath、affectedAssets、interpretation、confidence。
- `topicIds` 僅使用 `topics.js` 的固定清單。
- 只有在可誠實驗證且有明確市場方向時才填 `dataToConfirm` 與 `confirmationRules`；尚未公布的結果不得預測方向，這時使用空陣列。
- 科技財報欄位只在相關事件使用；未知數字維持 `null`。
- 不杜撰市場價格、報酬、公布值、時間、來源、門檻或事件嚴重性。
- 台股融資觀察優先引用金管會或證交所口徑；必須區分官方「整戶擔保維持率」與券商自行估算的「上市融資維持率」。130% 是追繳及可能處分擔保品的制度門檻，不得直接寫成必然見底點；是否出現籌碼清洗後的止穩，還要搭配融資餘額下降與價格行為判斷。
- JSON 不得包含秘密、管理 token、local filesystem path 或 Market Attention Ranking 診斷。

Market Attention Ranking 只在執行結果中回報，這一階段不寫入 Redis schema，也不作為 Dynamic Beta 分數。

## 儲存流程

1. 把 JSON 寫入系統暫存目錄中的當日檔案。
2. 找出 Codex workspace 提供的 Node.js runtime，執行：

   ```bash
   node --env-file=.env.local scripts/dynamic-beta-morning-brief-submit.js <暫存 JSON 絕對路徑>
   ```

3. CLI 成功時只接受 `ok: true` 且 `status: "pending"` 的結果。
4. 若回報 `PAYLOAD_INVALID`，可依 schema 錯誤修正 JSON 並重試一次。其他錯誤或第二次仍失敗時立即停止。
5. 不得改用 approve/reject API，不得呼叫核准按鈕，不得改寫 feature flag 來繞過失敗。

相同內容重跑應由既有 content-addressed repository 回傳 unchanged；內容實質改變時才建立新 draft revision。任何重跑都不得取代已核准晨報。

## 成功回報

以繁體中文簡潔回報：

- brief date；
- 五個事件標題；
- 每件 Market Attention Ranking 總分與一行入選理由；
- 使用的主要來源類型；
- draft revision ID、revision number、created/unchanged、status；
- 管理頁：`http://localhost:3000/admin/dynamic-beta?token=local-admin&section=today`；
- 明確註記「只建立待核准草稿，尚未發布，也未啟用 Dynamic Beta scoring」。

## 失敗回報

以繁體中文指出失敗階段：研究、去重、五件事件不足、JSON、schema validation、設定或儲存。只提供安全且可採取行動的原因，不輸出 stack trace、完整 upstream response、環境變數或秘密。

失敗時不得留下部分草稿；既有草稿與已核准晨報必須保持不變。
