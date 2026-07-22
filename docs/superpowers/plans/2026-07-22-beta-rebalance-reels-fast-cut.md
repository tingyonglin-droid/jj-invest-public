# Beta 再平衡 Reels 快速版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一份可由 CapCut Desktop 9.1 開啟的約 40 秒 JJ Invest Beta 再平衡教學草稿。

**Architecture:** 使用 CapCut Mate 產生獨立草稿，將 8 段本地影片依快速版時間軸排列並複製到草稿內。可見字幕分成上下兩個位置，另建立一段近乎透明的完整旁白文字供 CapCut AI 配音。

**Tech Stack:** Python 3.12、CapCut Mate、CapCut Desktop 9.1 for macOS

## Global Constraints

- 保留現有 60 秒草稿，不覆寫其他專案。
- 快速版片長介於 38–42 秒。
- 原始影片音訊靜音。
- 草稿內含 8 段影片、約 9 段可見字幕及一段完整旁白文字。
- 素材必須複製進草稿內，避免 macOS 沙盒拒絕 Synology Drive 路徑。

---

### Task 1: 產生快速版草稿

**Files:**
- Create: `/private/tmp/capcut-mate-jj/build_jj_reels_fast.py`
- Create: `/Users/jjlin/Movies/CapCut/User Data/Projects/com.lveditor.draft/JJ Invest｜Beta 再平衡教學｜快速版/`

**Interfaces:**
- Consumes: `/Users/jjlin/Library/CloudStorage/SynologyDrive-1/Codex/jj-invest-public/reels-beta-update/*.mp4`
- Produces: CapCut Desktop 9.1 可讀取的 40 秒草稿資料夾。

- [ ] **Step 1: 建立產生腳本**

腳本必須呼叫 `create_draft(1080, 1920)`、`_add_videos_internal(...)` 與 `add_captions(...)`，並將八段片長相加控制為 40 秒。

- [ ] **Step 2: 執行腳本**

Run: `/private/tmp/capcut-mate-venv/bin/python /private/tmp/capcut-mate-jj/build_jj_reels_fast.py`

Expected: 印出新草稿暫存路徑，且程序結束碼為 0。

- [ ] **Step 3: 安裝到 CapCut 草稿目錄**

Run: `cp -R <generated-draft> '/Users/jjlin/Movies/CapCut/User Data/Projects/com.lveditor.draft/JJ Invest｜Beta 再平衡教學｜快速版'`

Expected: 建立全新資料夾，不覆寫現有草稿。

- [ ] **Step 4: 驗證草稿內容**

Run: 使用 Python 讀取新草稿 `draft_content.json`。

Expected: `duration == 40000000`、8 個影片素材、9 個可見字幕加 1 個旁白文字，且所有影片路徑均存在。
