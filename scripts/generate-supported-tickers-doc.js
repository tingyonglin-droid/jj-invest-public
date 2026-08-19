import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CATEGORY_LABELS = {
  leveraged: "槓桿",
  original: "原形",
  cashEquivalent: "類現金",
};

export function generateSupportedTickersMarkdown(registry) {
  const sections = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
    const rows = registry
      .filter((item) => item.category === category)
      .map((item) =>
        `| ${item.ticker} | ${item.name} | ${item.market} | ${item.symbols.join("、")} | ${item.quoteSources.join(" → ")} | ${item.verifiedAt} |`,
      )
      .join("\n");

    return [
      `## ${label}`,
      "",
      "| 輸入代號 | 顯示名稱 | 市場 | 支援符號 | 報價順序 | 驗證日期 |",
      "|---|---|---|---|---|---|",
      rows,
    ].join("\n");
  });

  return [
    "# 完整支援標的清單",
    "",
    "> 本文件由 `src/data/supported-tickers.json` 自動產生。App 的標的名稱也直接讀取同一份 JSON。",
    "",
    `目前共 ${registry.length} 檔已驗證標的。驗證代表名稱與即時股價均可正常顯示。`,
    "",
    ...sections.flatMap((section) => [section, ""]),
    "## 新增或編輯標的",
    "",
    "1. 編輯 `src/data/supported-tickers.json`。",
    "2. 新增或修改一筆標的資料；`symbols` 必須列出 App 可能收到的完整代號。",
    "3. 執行 `pnpm docs:supported-tickers` 重新產生本文件。",
    "4. 執行 `pnpm test tests/supported-tickers.test.js tests/presentation.test.js` 驗證資料。",
    "",
    "### 欄位說明",
    "",
    "| 欄位 | 用途 |",
    "|---|---|",
    "| `ticker` | 使用者在設定頁輸入的代號 |",
    "| `symbols` | 正規化或報價來源可能回傳的代號，例如 `.TW`、`.TWO` |",
    "| `name` | App 顯示名稱 |",
    "| `category` | `leveraged`、`original` 或 `cashEquivalent` |",
    "| `market` | `TWSE`、`TPEx` 或 `US` |",
    "| `quoteSources` | 報價查詢來源與備援順序 |",
    "| `verified` | 是否已實際驗證名稱與股價 |",
    "| `verifiedAt` | 最近驗證日期，格式為 `YYYY-MM-DD` |",
    "",
  ].join("\n");
}

async function main() {
  const registryUrl = new URL("../src/data/supported-tickers.json", import.meta.url);
  const outputUrl = new URL("../docs/supported-tickers.md", import.meta.url);
  const registry = JSON.parse(await readFile(registryUrl, "utf8"));
  await writeFile(outputUrl, generateSupportedTickersMarkdown(registry), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
