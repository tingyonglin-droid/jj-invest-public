# JJ Invest System App 介紹圖卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一組可直接發布的 7 張 1080 × 1350 Instagram 輪播圖卡，向新觀眾說明 JJ Invest System 的設計動機與核心功能。

**Architecture:** 以 Pillow 建立可重複產生的圖卡排版，純文字卡使用現有黑金藍 Beta 儀表視覺作背景，第 5、6 張加入使用者提供的最新 Demo App 截圖。產出後以程式檢查尺寸、張數及檔案完整性，再逐張做視覺檢查。

**Tech Stack:** Python 3.12、Pillow、PNG

## Global Constraints

- 共 7 張，每張尺寸 1080 × 1350 px。
- 面向第一次認識 JJ Invest System 的新觀眾。
- 主線為追求長期超越 0050，同時控制自己能承受的下跌風險，降低恐慌停損破壞長期策略的可能。
- 「長期超越 0050」只能表述為策略目標，不得作為績效保證。
- 第 5、6 張使用 Demo 模式畫面，不暴露個人資料。
- 黑底、白字、電光藍重點字、暖金色品牌元素。
- 最後一張包含使用、留言、追蹤三項 CTA，以及非投資建議與不保證績效警語。

---

### Task 1: 匯入最新 Demo App 畫面

**Files:**
- Create: `ig-app-intro/assets/overview.jpg`
- Create: `ig-app-intro/assets/history.jpg`
- Create: `ig-app-intro/assets/rebalance.jpg`

**Interfaces:**
- Consumes: 使用者提供的 `照片 1.jpg`、`照片 2.jpg`、`照片 3.jpg`
- Produces: 三張可供圖卡排版使用的最新直式 App 截圖。

- [ ] **Step 1: 複製最新截圖到素材資料夾**

Run: 將三張附件依序複製為 `overview.jpg`、`history.jpg`、`rebalance.jpg`。

Expected: `ig-app-intro/assets/` 內存在三張圖片。

- [ ] **Step 2: 驗證截圖**

Run: 使用 Pillow 開啟三張圖片。

Expected: 三張圖片皆可讀取，且為直式畫面。

### Task 2: 產生 7 張圖卡

**Files:**
- Create: `ig-app-intro/create_cards.py`
- Create: `ig-app-intro/01-cover.png`
- Create: `ig-app-intro/02-goal.png`
- Create: `ig-app-intro/03-risk.png`
- Create: `ig-app-intro/04-principle.png`
- Create: `ig-app-intro/05-overview.png`
- Create: `ig-app-intro/06-rebalance.png`
- Create: `ig-app-intro/07-cta.png`

**Interfaces:**
- Consumes: 設計稿、黑金藍背景素材及 Task 1 的兩張 App 截圖。
- Produces: 7 張 1080 × 1350 PNG 圖卡。

- [ ] **Step 1: 建立可重複排版腳本**

腳本必須定義統一的品牌色、字型、系列膠囊、頁碼、主標、內文、重點字與底部品牌元素，並為第 5、6 張建立手機截圖卡框。

- [ ] **Step 2: 執行圖卡產生器**

Run: `/private/tmp/capcut-mate-venv/bin/python ig-app-intro/create_cards.py`

Expected: 產生 7 張 PNG，程序結束碼為 0。

- [ ] **Step 3: 程式驗證輸出**

Run: 使用 Pillow 檢查所有輸出。

Expected: 恰好 7 張，且每張皆為 1080 × 1350 px。

- [ ] **Step 4: 視覺驗證**

逐張檢查文字是否完整、App 畫面是否清楚、重點字是否正確，以及最後一張是否包含三項 CTA 和警語。
