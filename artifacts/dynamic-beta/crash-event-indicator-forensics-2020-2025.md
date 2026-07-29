# Crash Event Indicator Forensics

Generated: 2026-07-27T15:04:19.117Z

> Research-only. Macro history uses revised values with conservative release lags; this is not a complete point-in-time backtest.

## 2020 年 3 月疫情崩盤

SPY peak 2020-02-19; trough 2020-03-23; drawdown -34.1%.

Matched controls: 2024-01-16, 2024-03-15, 2024-02-15, 2023-06-15, 2021-08-16

| Signal | Classification | First anomaly | Lead days | Pre-5 | Peak | Trough | Control anomaly |
|---|---|---:|---:|---:|---:|---:|---:|
| VIX 水位 | concurrent-confirmation | 2020-02-24 | -3 | 25 | 0 | 100 | 0% |
| VIX 20 日變化 | weak-leading | 2020-01-27 | 16 | 25 | 0 | 100 | 0% |
| SPY 20 日報酬 | weak-leading | 2020-01-29 | 14 | 25 | 0 | 100 | 20% |
| SPY 60 日報酬 | concurrent-confirmation | 2020-02-24 | -3 | 0 | 0 | 100 | 0% |
| SPY 近一年回撤 | concurrent-confirmation | 2020-02-25 | -4 | 0 | 0 | 100 | 0% |
| QQQ 相對 SPY 20 日 | late | 2020-04-09 | -36 | 0 | 0 | 0 | 0% |
| SOXX 相對 SPY 20 日 | weak-leading | 2019-11-29 | 54 | 25 | 0 | 0 | 20% |
| 高收益債利差 | insufficient-data | — | — | — | — | — | 0% |
| 高收益債利差 20 日變化 | insufficient-data | — | — | — | — | — | 0% |
| 10Y−2Y 殖利率曲線 | quiet | — | — | 25 | 25 | 25 | 80% |
| 2Y 殖利率 20 日移動 | concurrent-confirmation | 2020-02-28 | -7 | 0 | 0 | 50 | 0% |
| 10Y 殖利率 20 日移動 | weak-leading | 2020-01-31 | 12 | 25 | 0 | 25 | 0% |
| 失業率 3 個月變化 | weak-leading | 2020-01-13 | 25 | 50 | 0 | 0 | 20% |
| 非農 3 個月平均增量 | weak-leading | 2020-01-13 | 25 | 50 | 25 | 0 | 20% |
| 核心 CPI 年增率 | quiet | — | — | 0 | 0 | 0 | 100% |
| 核心 PCE 年增率 | quiet | — | — | 0 | 0 | 0 | 100% |

## 2022 年 10 月熊市低點

SPY peak 2022-08-16; trough 2022-10-12; drawdown -17.02%.

Matched controls: 2020-08-17, 2021-05-17, 2020-11-16, 2021-02-16, 2021-03-15

| Signal | Classification | First anomaly | Lead days | Pre-5 | Peak | Trough | Control anomaly |
|---|---|---:|---:|---:|---:|---:|---:|
| VIX 水位 | high-false-positive | 2022-05-19 | 60 | 50 | 25 | 75 | 80% |
| VIX 20 日變化 | weak-leading | 2022-05-24 | 57 | 0 | 0 | 50 | 0% |
| SPY 20 日報酬 | weak-leading | 2022-05-19 | 60 | 0 | 0 | 50 | 20% |
| SPY 60 日報酬 | weak-leading | 2022-05-19 | 60 | 0 | 0 | 100 | 0% |
| SPY 近一年回撤 | leading | 2022-05-19 | 60 | 75 | 75 | 100 | 0% |
| QQQ 相對 SPY 20 日 | high-false-positive | 2022-05-19 | 60 | 0 | 0 | 25 | 60% |
| SOXX 相對 SPY 20 日 | high-false-positive | 2022-05-24 | 57 | 50 | 50 | 75 | 40% |
| 高收益債利差 | insufficient-data | — | — | — | — | — | — |
| 高收益債利差 20 日變化 | insufficient-data | — | — | — | — | — | — |
| 10Y−2Y 殖利率曲線 | leading | 2022-07-06 | 29 | 75 | 75 | 75 | 0% |
| 2Y 殖利率 20 日移動 | weak-leading | 2022-06-10 | 45 | 0 | 25 | 25 | 0% |
| 10Y 殖利率 20 日移動 | weak-leading | 2022-05-26 | 55 | 25 | 0 | 25 | 0% |
| 失業率 3 個月變化 | quiet | — | — | 0 | 0 | 0 | 0% |
| 非農 3 個月平均增量 | quiet | — | — | 0 | 0 | 0 | 20% |
| 核心 CPI 年增率 | leading | 2022-05-19 | 60 | 100 | 100 | 100 | 0% |
| 核心 PCE 年增率 | leading | 2022-05-19 | 60 | 100 | 100 | 100 | 0% |

## 2024 年 8 月急跌

SPY peak 2024-07-16; trough 2024-08-05; drawdown -8.41%.

Matched controls: 2024-02-15, 2023-07-17, 2024-03-15, 2023-12-15, 2023-06-15

| Signal | Classification | First anomaly | Lead days | Pre-5 | Peak | Trough | Control anomaly |
|---|---|---:|---:|---:|---:|---:|---:|
| VIX 水位 | concurrent-confirmation | 2024-08-02 | -13 | 0 | 0 | 100 | 0% |
| VIX 20 日變化 | weak-leading | 2024-04-18 | 60 | 25 | 25 | 100 | 0% |
| SPY 20 日報酬 | weak-leading | 2024-04-18 | 60 | 25 | 0 | 75 | 0% |
| SPY 60 日報酬 | weak-leading | 2024-04-19 | 59 | 0 | 0 | 50 | 0% |
| SPY 近一年回撤 | weak-leading | 2024-04-19 | 59 | 0 | 0 | 50 | 0% |
| QQQ 相對 SPY 20 日 | concurrent-confirmation | 2024-07-23 | -5 | 0 | 25 | 50 | 0% |
| SOXX 相對 SPY 20 日 | weak-leading | 2024-04-18 | 60 | 25 | 0 | 100 | 0% |
| 高收益債利差 | quiet | — | — | 25 | 25 | 25 | 0% |
| 高收益債利差 20 日變化 | weak-leading | 2024-04-18 | 60 | 0 | 0 | 75 | 0% |
| 10Y−2Y 殖利率曲線 | high-false-positive | 2024-04-18 | 60 | 75 | 75 | 50 | 100% |
| 2Y 殖利率 20 日移動 | weak-leading | 2024-04-18 | 60 | 0 | 25 | 75 | 20% |
| 10Y 殖利率 20 日移動 | weak-leading | 2024-04-18 | 60 | 0 | 25 | 50 | 20% |
| 失業率 3 個月變化 | high-false-positive | 2024-04-18 | 60 | 0 | 50 | 50 | 40% |
| 非農 3 個月平均增量 | leading | 2024-06-12 | 22 | 50 | 75 | 75 | 20% |
| 核心 CPI 年增率 | high-false-positive | 2024-04-18 | 60 | 50 | 50 | 50 | 100% |
| 核心 PCE 年增率 | high-false-positive | 2024-04-18 | 60 | 25 | 25 | 25 | 100% |

## 2025 年 4 月急跌

SPY peak 2025-02-19; trough 2025-04-08; drawdown -19%.

Matched controls: 2024-11-15, 2021-11-15, 2021-07-15, 2023-05-15, 2021-09-15

| Signal | Classification | First anomaly | Lead days | Pre-5 | Peak | Trough | Control anomaly |
|---|---|---:|---:|---:|---:|---:|---:|
| VIX 水位 | weak-leading | 2024-12-18 | 40 | 25 | 25 | 100 | 0% |
| VIX 20 日變化 | weak-leading | 2024-12-18 | 40 | 25 | 0 | 100 | 0% |
| SPY 20 日報酬 | weak-leading | 2024-12-18 | 40 | 50 | 25 | 100 | 0% |
| SPY 60 日報酬 | weak-leading | 2025-01-06 | 29 | 25 | 25 | 100 | 0% |
| SPY 近一年回撤 | concurrent-confirmation | 2025-03-04 | -9 | 0 | 0 | 75 | 0% |
| QQQ 相對 SPY 20 日 | weak-leading | 2024-11-27 | 54 | 25 | 0 | 25 | 0% |
| SOXX 相對 SPY 20 日 | high-false-positive | 2024-11-19 | 60 | 75 | 0 | 100 | 40% |
| 高收益債利差 | concurrent-confirmation | 2025-04-03 | -31 | 0 | 0 | 50 | 0% |
| 高收益債利差 20 日變化 | weak-leading | 2024-12-30 | 33 | 25 | 25 | 75 | 0% |
| 10Y−2Y 殖利率曲線 | quiet | — | — | 25 | 25 | 0 | 20% |
| 2Y 殖利率 20 日移動 | concurrent-confirmation | 2025-03-03 | -8 | 0 | 0 | 25 | 0% |
| 10Y 殖利率 20 日移動 | weak-leading | 2024-12-19 | 39 | 0 | 0 | 0 | 0% |
| 失業率 3 個月變化 | late | 2025-04-14 | -38 | 0 | 0 | 0 | 0% |
| 非農 3 個月平均增量 | leading | 2024-11-19 | 60 | 50 | 50 | 75 | 20% |
| 核心 CPI 年增率 | high-false-positive | 2024-11-19 | 60 | 50 | 50 | 50 | 100% |
| 核心 PCE 年增率 | quiet | — | — | 25 | 25 | 25 | 80% |

## Cross-event ranking

| Signal | Leading events | Weak leading | Concurrent | Insufficient | Avg lead | Avg control anomaly |
|---|---:|---:|---:|---:|---:|---:|
| 非農 3 個月平均增量 | 2 | 1 | 0 | 0 | 41 | 20% |
| SPY 近一年回撤 | 1 | 1 | 2 | 0 | 60 | 0% |
| 10Y−2Y 殖利率曲線 | 1 | 0 | 0 | 0 | 29 | 50% |
| 核心 PCE 年增率 | 1 | 0 | 0 | 0 | 60 | 70% |
| 核心 CPI 年增率 | 1 | 0 | 0 | 0 | 60 | 75% |
| VIX 20 日變化 | 0 | 4 | 0 | 0 | — | 0% |
| SPY 60 日報酬 | 0 | 3 | 1 | 0 | — | 0% |
| 高收益債利差 | 0 | 0 | 1 | 2 | — | 0% |
| 高收益債利差 20 日變化 | 0 | 2 | 0 | 2 | — | 0% |
| 2Y 殖利率 20 日移動 | 0 | 2 | 2 | 0 | — | 5% |
| 10Y 殖利率 20 日移動 | 0 | 4 | 0 | 0 | — | 5% |
| SPY 20 日報酬 | 0 | 4 | 0 | 0 | — | 10% |
| QQQ 相對 SPY 20 日 | 0 | 1 | 1 | 0 | — | 15% |
| 失業率 3 個月變化 | 0 | 1 | 0 | 0 | — | 15% |
| VIX 水位 | 0 | 1 | 2 | 0 | — | 20% |
| SOXX 相對 SPY 20 日 | 0 | 2 | 0 | 0 | — | 25% |

## Data gaps

| Data | Purpose | Priority | Current source |
|---|---|---:|---|
| 市場廣度 | 辨識指數創高但多數成分股已轉弱 | high | none |
| VIX 期貨期限結構 | 辨識短期避險需求與波動結構倒掛 | high | none |
| CBOE SKEW | 衡量尾部風險避險定價 | medium | none |
| Put/Call Ratio | 衡量選擇權避險與投機失衡 | medium | none |
| HYG／LQD 信用 ETF | 補足高收益債利差在 2023 年前的歷史缺口 | high | none |
| MOVE 債券波動率 | 辨識利率市場壓力與去槓桿 | high | none |
| 美元指數 | 辨識全球美元流動性收緊 | medium | none |
| 日圓／套利交易代理 | 辨識日圓套利平倉與跨資產去槓桿 | high | none |
| 金融條件／資金壓力 | 辨識融資、流動性與市場壓力同步收緊 | high | none |
