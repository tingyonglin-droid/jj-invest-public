# Beta 再平衡 Reels 封面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 產生一張符合 JJ Invest 品牌的 1080 × 1920 Reels 封面圖片。

**Architecture:** 使用內建圖片生成工具依核准文案與深色投資實驗室視覺建立單張點陣圖。生成後檢查文字、9:16 構圖及中央安全區，並將最終 PNG 保存至專案素材資料夾。

**Tech Stack:** OpenAI image generation、PNG

## Global Constraints

- 尺寸與構圖必須為 9:16 直式。
- 上方金色膠囊文字必須為 `Beta控制系統｜功能更新`。
- 主標必須為 `只調整部分持股，也能再平衡？`。
- 次要資訊必須為 `i 名詞說明｜本次 Beta｜持股選擇`。
- 品牌文字必須為 `JJ Invest System`。
- 不使用真實投資數字、報酬暗示、App 截圖或浮水印。

---

### Task 1: 生成並驗證封面

**Files:**
- Create: `reels-beta-update/jj-invest-beta-rebalance-cover.png`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-22-beta-rebalance-reels-cover-design.md`
- Produces: 可匯入 CapCut 的 9:16 PNG 封面。

- [ ] **Step 1: 使用圖片生成工具建立封面**

Prompt 必須逐字包含四組核准文字，指定深黑背景、白色粗體主標、電光藍關鍵詞、暖金色膠囊與抽象 Beta 儀表刻度。

- [ ] **Step 2: 檢查生成結果**

檢查主標、膠囊、次要資訊與品牌文字是否存在且可讀；確認沒有真實數字、投資報酬暗示、App 截圖或額外浮水印。

- [ ] **Step 3: 保存專案素材**

將選定 PNG 複製為 `reels-beta-update/jj-invest-beta-rebalance-cover.png`，不得覆寫未經授權的其他資產。

- [ ] **Step 4: 驗證檔案**

Run: `file reels-beta-update/jj-invest-beta-rebalance-cover.png`

Expected: PNG image data，直式尺寸比例為 9:16。
