# Betree App Reintroduction Reels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a 55–65 second vertical Reels that accurately introduces Betree's two decision paths and three major interface updates, ending with a direct prompt to configure a portfolio.

**Architecture:** Record the App in short, reusable screen-capture clips grouped by feature rather than final timeline order. Assemble those clips under one continuous voiceover, then add concise on-screen captions and perform separate product-accuracy and mobile-safe-area reviews.

**Tech Stack:** Betree Demo data, iPhone or 9:16 simulator screen recording, CapCut or equivalent editor, 1080 × 1920 H.264 export.

## Global Constraints

- Final duration: 55–65 seconds.
- Format: 9:16, 1080 × 1920.
- Use Demo data only; never expose real holdings, cash, performance, or personal information.
- Market level shows 0050 drawdown from its historical high; it does not predict a bottom or automatically issue a buy signal.
- Daily rebalancing means returning Beta to the long-term target after leaving the tolerance range.
- Raising “rebalancing to Beta” is a one-time exposure decision and does not modify the long-term target Beta.
- Cash-equivalent ETFs can fluctuate and are not principal-protected cash.
- End with `決策與試算工具｜非投資建議`.
- Do not actually confirm or apply a Demo rebalance during recording.

---

## File and Asset Structure

- Reference: `docs/superpowers/specs/2026-08-12-betree-app-reintroduction-reels-design.md` — approved story, wording, and safety boundaries.
- Create folder: `reels-betree-reintroduction/raw/` — untouched screen recordings.
- Create folder: `reels-betree-reintroduction/audio/` — final voiceover and music reference.
- Create folder: `reels-betree-reintroduction/project/` — editor project or exported project package.
- Create folder: `reels-betree-reintroduction/exports/` — review and final video files.
- Create: `reels-betree-reintroduction/voiceover.txt` — exact final voiceover.
- Create: `reels-betree-reintroduction/shot-log.md` — recorded filename, content, usable range, and retake notes.

### Task 1: Prepare a Safe Demo Portfolio

**Deliverable:** A valid, visually legible Demo state that can demonstrate every feature without exposing personal data.

- [ ] **Step 1: Open Betree in a clean Demo or isolated browser state**

Confirm that no real holding, cash value, history record, notification, account name, or browser autofill suggestion is visible.

- [ ] **Step 2: Configure two holdings in one asset class**

Use recognizable Demo tickers and round share counts. Set custom within-class targets to `60%` and `40%`, and confirm the displayed total is `100%`.

- [ ] **Step 3: Configure the cash bucket**

Add TWD or USD Demo cash plus one cash-equivalent ETF. Set a valid real-cash reserve and cash-equivalent allocation whose total is `100%`.

- [ ] **Step 4: Create a visible Beta deviation**

Set Demo values so the overview shows a clear current Beta, long-term target, tolerance range, and `需再平衡 →` state without validation errors.

- [ ] **Step 5: Verify all four recording destinations**

Check that market-level history, the Beta status card, custom holding weights, and cash-equivalent settings are all visible and valid.

### Task 2: Record Market-Level and Beta Decision Clips

**Deliverable:** Six clean screen recordings with 0.5 seconds of stillness before and after each action.

- [ ] **Step 1: Record App launch**

Save as `raw/01-open-betree.mp4`. Start on the phone home screen, tap Betree, and let the overview settle on the market-level visualization.

- [ ] **Step 2: Record the complete market-level card**

Save as `raw/02-market-level-overview.mp4`. Hold long enough to read `0050 距歷史高點`, the latest value, chart, and zone legend.

- [ ] **Step 3: Record historical interaction**

Save as `raw/03-market-level-history.mp4`. Switch exactly one time range and inspect at least one earlier chart point without rapid repeated tapping.

- [ ] **Step 4: Record current Beta status**

Save as `raw/04-beta-status.mp4`. Frame current Beta, target, difference, tolerance, and `需再平衡 →` in one continuous move.

- [ ] **Step 5: Record normal rebalance navigation**

Save as `raw/05-open-rebalance.mp4`. Tap `需再平衡 →` and stop after the rebalance screen is stable.

- [ ] **Step 6: Record one-time Beta increase**

Save as `raw/06-raise-session-beta.mp4`. Raise `再平衡到 Beta` by a visually obvious but plausible amount and show the recalculated post-rebalance Beta and trades. Do not confirm application.

### Task 3: Record Allocation Update Clips

**Deliverable:** Four clean clips proving custom holding allocation and cash-equivalent management.

- [ ] **Step 1: Record allocation-mode switching**

Save as `raw/07-holding-allocation-mode.mp4`. Open `設定 → 持股`, show automatic allocation, then switch once to custom allocation.

- [ ] **Step 2: Record custom holding weights**

Save as `raw/08-custom-holding-weights.mp4`. Enter `60%` and `40%`, then pause on the valid `100%` total.

- [ ] **Step 3: Record cash-equivalent setup**

Save as `raw/09-cash-equivalent.mp4`. Open `設定 → 現金`, show TWD/USD cash, and add or reveal one cash-equivalent ETF.

- [ ] **Step 4: Record cash-bucket allocation**

Save as `raw/10-cash-bucket-allocation.mp4`. Show the real-cash reserve and the cash-equivalent auto/custom allocation controls, ending on a valid configuration.

### Task 4: Create and Record the Voiceover

**Deliverable:** One clean narration track with natural pacing and a target length of 57–60 seconds.

- [ ] **Step 1: Create the exact voiceover file**

Save the following text as `voiceover.txt`, preserving paragraph breaks as edit points:

```text
市場跌了，要不要提高曝險？和平常 Beta 跑掉了要再平衡，其實是兩件不同的事。

新版 Betree 把這兩個判斷放在一起看，但不會把它們混在一起。

市場水位會顯示 0050 距離歷史高點多少，並用歷史走勢呈現回落程度，幫助你判斷現在是否進入自己的低接觀察區。

平常則是看目前 Beta 有沒有超出目標容忍區間；超出時，再把曝險調回原本設定的策略。

如果你根據市場水位決定低接，也可以只提高這一次的再平衡 Beta，不需要改掉長期目標。

新版也能選擇持股自動分配，或自己設定每一檔的目標比例。

現金部位則能加入類現金 ETF，和台幣、美金一起納入配置與再平衡。

打開 Betree，先看市場跌多少，再決定要維持紀律，還是調整這一次的曝險。
```

- [ ] **Step 2: Make a timed scratch recording**

Read at a calm but forward-moving pace. Target these paragraph end times: `5s`, `14s`, `25s`, `34s`, `42s`, `49s`, `55s`, `60s`.

- [ ] **Step 3: Record or generate the final voiceover**

Save as `audio/voiceover-final.wav`. Keep pronunciation consistent for `Betree`, `Beta`, `0050`, and `ETF`; remove long breaths but retain natural sentence pauses.

- [ ] **Step 4: Verify narration accuracy**

Listen once without video and confirm that it never implies an automatic buy signal, bottom prediction, or change to the long-term Beta target.

### Task 5: Assemble the 60-Second Rough Cut

**Deliverable:** A complete 55–65 second rough cut synchronized to voiceover.

- [ ] **Step 1: Build the voiceover-first timeline**

Place `audio/voiceover-final.wav` at `00:00` and add timeline markers at `00:05`, `00:14`, `00:25`, `00:34`, `00:42`, `00:49`, `00:55`, and the final narration endpoint.

- [ ] **Step 2: Assemble the opening and two-decision explanation**

Use clips `01`, `02`, and `04` from `00:00–00:14`. Start with the market-level view, then contrast it with current Beta. Use cuts of 0.5–1.5 seconds in the first five seconds and 2–3 seconds afterward.

- [ ] **Step 3: Assemble market-level history**

Use clips `02` and `03` from `00:14–00:25`. Show one clear time-range change and one historical point inspection.

- [ ] **Step 4: Assemble regular and low-market Beta actions**

Use clips `04`, `05`, and `06` from `00:25–00:42`. Keep the long-term status card visible during the regular-rebalance sentence, then show only `再平衡到 Beta` during the one-time increase sentence.

- [ ] **Step 5: Assemble custom allocation and cash equivalents**

Use clips `07` and `08` from `00:42–00:49`, then clips `09` and `10` from `00:49–00:55`. Ensure the valid `100%` total and cash-equivalent label are each readable for at least one second.

- [ ] **Step 6: Assemble the CTA**

From `00:55` to the end, flash market level, current Beta, and the rebalance result, then hold on the Betree overview or wordmark for at least one second.

### Task 6: Add Captions, Music, and Mobile-Safe Layout

**Deliverable:** A review export with all captions and audio mixed.

- [ ] **Step 1: Add the eight visible caption beats**

Use these exact captions in order:

```text
低檔加碼 ≠ 日常再平衡
市場水位：判斷跌多少｜目前 Beta：判斷是否偏離
① 市場水位歷史視覺化
② 超出容忍區間再平衡
低檔策略：提高本次 Beta
③ 持股比例自由選擇
④ 新增類現金管理
看水位｜管 Beta｜做再平衡
```

- [ ] **Step 2: Add the required supporting disclosures**

During market level, show `看現在跌多少，不預測最低點`. During one-time Beta adjustment, show `不修改長期目標設定`. During cash equivalents, show `類現金 ETF 仍有價格波動，並非保本現金`. At the end, show `決策與試算工具｜非投資建議`.

- [ ] **Step 3: Check caption safe areas**

Keep essential text away from the right-side Reels controls and bottom caption/account area. Limit each large caption to two lines and move captions above any control being demonstrated.

- [ ] **Step 4: Add and mix background music**

Use steady, restrained music. Keep voiceover clearly dominant and mute all original screen-recording audio.

- [ ] **Step 5: Export the review version**

Export `exports/betree-reintroduction-review-v1.mp4` at 1080 × 1920, H.264, with audio enabled.

### Task 7: Review Accuracy, Readability, and Final Export

**Deliverable:** A publication-ready video that passes the content and visual checklist.

- [ ] **Step 1: Watch once for product logic only**

Confirm the video communicates this exact separation:

```text
Current Beta outside tolerance → rebalance toward the long-term target.
Market drawdown observed → user independently decides whether to raise this rebalance's Beta.
```

- [ ] **Step 2: Watch once on a phone without sound**

Confirm the story is understandable from captions, every main caption is readable before the next cut, and no essential text is covered by Reels UI.

- [ ] **Step 3: Watch once with sound but without reading captions**

Confirm all voiceover is intelligible, the music never masks numbers or product terms, and pronunciation is consistent.

- [ ] **Step 4: Check every risk boundary**

Confirm there is no bottom prediction, automatic buy instruction, performance promise, claim that cash-equivalent ETFs are cash, real personal data, or actual application of a Demo rebalance.

- [ ] **Step 5: Export the final master**

Export `exports/betree-reintroduction-final.mp4` at 1080 × 1920, H.264, 55–65 seconds, and play the exported file from beginning to end before publishing.
