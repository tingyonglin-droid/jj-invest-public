import {
  briefStatusLabel,
  formatBriefConfidence,
  knownMissingLabel,
} from "../../lib/dynamic-beta/news/brief-presentation.js";

function present(value, missing = "未提供") {
  return value === null || value === undefined || value === "" ? missing : value;
}

function formatTime(value, missing) {
  if (!value) return missing;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function formatGrowth(value) {
  return Number.isFinite(value) ? `${value}%` : knownMissingLabel("technologyMetric");
}

function formatComparison(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  return knownMissingLabel("technologyMetric");
}

function formatRule(rule) {
  if (!rule) return "規則內容未提供";
  const direction = rule.expectedDirection === "up"
    ? "上漲"
    : rule.expectedDirection === "down"
      ? "下跌"
      : present(rule.expectedDirection, "方向未提供");
  const suffix = rule.changeType === "percent"
    ? "%"
    : rule.changeType === "basis_points"
      ? " bps"
      : "";
  const threshold = rule.threshold === null || rule.threshold === undefined
    ? "門檻未提供"
    : `${rule.threshold}${suffix}`;
  return `${present(rule.seriesId, "序列未提供")} · ${direction}至少 ${threshold}`;
}

function boundedHeadingLevel(value, fallback) {
  const level = Number.isInteger(value) ? value : fallback;
  return Math.min(6, Math.max(1, level));
}

function BoundedHeading({ level, fallback, children }) {
  switch (boundedHeadingLevel(level, fallback)) {
    case 1: return <h1>{children}</h1>;
    case 2: return <h2>{children}</h2>;
    case 3: return <h3>{children}</h3>;
    case 4: return <h4>{children}</h4>;
    case 5: return <h5>{children}</h5>;
    default: return <h6>{children}</h6>;
  }
}

function ValueList({ items, empty, ordered = false, arrows = false, separated = false }) {
  if (!items?.length) return <span>{empty}</span>;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag className={arrows ? "morningBriefPath" : undefined}>
      {items.map((item, index) => (
        <li key={`${String(item)}:${index}`}>
          {item}
          {arrows && index < items.length - 1 ? " →" : ""}
          {separated && index < items.length - 1 ? "," : ""}
        </li>
      ))}
    </ListTag>
  );
}

function SourceLinks({ urls }) {
  if (!urls?.length) return <span>沒有來源連結</span>;
  return (
    <ul className="morningBriefLinkList">
      {urls.map((url) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer">{url}</a>
        </li>
      ))}
    </ul>
  );
}

export function MorningBriefHeader({ brief, compact = false, headingLevel = 2 }) {
  if (!brief) return null;
  const identity = brief.identity || {};
  const kindLabel = identity.kind === "draft" ? "Draft Morning Brief" : "Published Morning Brief";
  return (
    <header className="morningBriefHeader">
      <div>
        <BoundedHeading level={headingLevel} fallback={2}>{kindLabel}</BoundedHeading>
        <p>
          <strong>{present(identity.briefDate, "日期未提供")}</strong>
          {" · Revision #"}{present(identity.revisionNumber, "未提供")}
          {" · "}{briefStatusLabel(identity.status)}
        </p>
        <p className="hint">
          Revision ID: <code>{present(identity.revisionId, "未提供")}</code>
        </p>
      </div>
      <dl className="morningBriefDefinitionList">
        <dt>分析標籤</dt>
        <dd>{present(brief.analysis?.label, "未提供分析標籤")}</dd>
        <dt>分析理由</dt>
        <dd>{present(brief.analysis?.rationale, "未提供分析理由")}</dd>
        {!compact && (
          <>
            <dt>晨報產生時間</dt>
            <dd>{formatTime(brief.generatedAt, "未提供產生時間")}</dd>
          </>
        )}
      </dl>
    </header>
  );
}

export function TechEarningsDetails({ value }) {
  if (!value) {
    return (
      <>
        <dt>科技財報</dt>
        <dd>{knownMissingLabel("technologyEarnings")}</dd>
      </>
    );
  }
  return (
    <>
      <dt>科技財報公司</dt>
      <dd>{present(value.company, "公司尚未標示")}</dd>
      <dt>營收成長</dt>
      <dd>{formatGrowth(value.revenueGrowthPct)}</dd>
      <dt>AI／雲端成長</dt>
      <dd>{formatGrowth(value.aiCloudGrowthPct)}</dd>
      <dt>CapEx 成長</dt>
      <dd>{formatGrowth(value.capexGrowthPct)}</dd>
      <dt>自由現金流成長</dt>
      <dd>{formatGrowth(value.freeCashFlowGrowthPct)}</dd>
      <dt>CapEx 成長快於自由現金流</dt>
      <dd>{formatComparison(value.capexGrowingFasterThanFcf)}</dd>
    </>
  );
}

export function ConfirmationStatusBadge({ status, label }) {
  const visibleLabel = label || briefStatusLabel(status);
  return (
    <span className={`morningBriefStatus morningBriefStatus--${status || "unknown"}`}>
      {visibleLabel}
    </span>
  );
}

export function ConfirmationSummary({ summary, headingLevel = 4 }) {
  if (!summary) return null;
  const aggregate = Array.isArray(summary.d1?.items) || Array.isArray(summary.d3?.items);
  return (
    <section
      className={`morningBriefConfirmation ${aggregate ? "morningBriefConfirmation--aggregate" : ""}`}
      aria-label="市場確認摘要"
    >
      <BoundedHeading level={headingLevel} fallback={4}>市場確認摘要</BoundedHeading>
      <dl className="morningBriefDefinitionList">
        <dt>D+1</dt>
        <dd>
          {summary.d1?.items ? (
            <span className="morningBriefConfirmationCounts">
              {summary.d1.items.map((item) => (
                <span key={item.status}>
                  <ConfirmationStatusBadge status={item.status} label={item.label} />
                  {" "}{item.count}
                </span>
              ))}
            </span>
          ) : (
            <ConfirmationStatusBadge status={summary.d1?.status} />
          )}
        </dd>
        <dt>D+3</dt>
        <dd>
          {summary.d3?.items ? (
            <span className="morningBriefConfirmationCounts">
              {summary.d3.items.map((item) => (
                <span key={item.status}>
                  <ConfirmationStatusBadge status={item.status} label={item.label} />
                  {" "}{item.count}
                </span>
              ))}
            </span>
          ) : (
            <ConfirmationStatusBadge status={summary.d3?.status} />
          )}
        </dd>
        <dt>持續性</dt>
        <dd>
          {summary.persistenceItems ? (
            <span className="morningBriefConfirmationCounts">
              {summary.persistenceItems.map((item) => (
                <span key={item.status}>{item.label} {item.count}</span>
              ))}
            </span>
          ) : present(summary.persistence, "尚未形成持續性判讀")}
        </dd>
      </dl>
    </section>
  );
}

export function MorningBriefEventCard({ event, compact = false, headingLevel = 3 }) {
  if (!event) return null;
  if (compact) {
    return (
      <li className="morningBriefEventSummary">
        <strong>#{present(event.rank, "?")} {present(event.headline, "事件標題未提供")}</strong>
        <span>{present(event.summary, "事件摘要未提供")}</span>
      </li>
    );
  }
  return (
    <article className="morningBriefEventCard">
      <BoundedHeading level={headingLevel} fallback={3}>
        #{present(event.rank, "?")} {present(event.headline, "事件標題未提供")}
      </BoundedHeading>
      <p>{present(event.summary, "事件摘要未提供")}</p>
      <details open>
        <summary>完整事件資料</summary>
        <dl className="morningBriefDefinitionList">
          <dt>來源連結</dt>
          <dd><SourceLinks urls={event.evidenceUrls} /></dd>
          <dt>Topic IDs</dt>
          <dd><ValueList items={event.topicIds} empty="沒有 Topic ID" /></dd>
          <dt>傳導路徑</dt>
          <dd><ValueList items={event.transmissionPath} empty="沒有傳導路徑" ordered arrows /></dd>
          <dt>受影響資產</dt>
          <dd><ValueList items={event.affectedAssets} empty="沒有列出受影響資產" separated /></dd>
          <dt>市場日期</dt>
          <dd>{present(event.marketDate, "市場日期未提供")}</dd>
          <dt>待確認資料</dt>
          <dd><ValueList items={event.dataToConfirm} empty="沒有待確認資料" /></dd>
          <dt>確認規則</dt>
          <dd>
            <ValueList
              items={event.confirmationRules?.map(formatRule)}
              empty={knownMissingLabel("confirmationRules")}
            />
          </dd>
          <dt>判讀</dt>
          <dd>{present(event.interpretation, "未提供事件判讀")}</dd>
          <dt>信心</dt>
          <dd>{formatBriefConfidence(event.confidence)}</dd>
          <TechEarningsDetails value={event.techEarnings} />
        </dl>
        <ConfirmationSummary
          summary={event.confirmationSummary || event.confirmation}
          headingLevel={boundedHeadingLevel(headingLevel, 3) + 1}
        />
      </details>
    </article>
  );
}

function EvidenceList({ evidence, headingLevel = 3 }) {
  if (!evidence?.length) return <p>沒有來源資料</p>;
  return (
    <ul className="morningBriefEvidenceList">
      {evidence.map((source, index) => (
        <li key={source.evidenceId || source.url || index}>
          <BoundedHeading level={headingLevel} fallback={3}>
            {source.url
              ? <a href={source.url} target="_blank" rel="noreferrer">{present(source.title, source.url)}</a>
              : present(source.title, "來源標題未提供")}
          </BoundedHeading>
          <p>{present(source.summary, "未提供來源摘要")}</p>
          <dl className="morningBriefDefinitionList">
            <dt>來源</dt>
            <dd>{present(source.sourceName, "來源名稱未提供")} · {present(source.sourceTier, "來源層級未提供")}</dd>
            <dt>Evidence ID</dt>
            <dd><code>{present(source.evidenceId, "未提供")}</code></dd>
            <dt>Evidence revision</dt>
            <dd><code>{present(source.revisionId, "未提供")}</code></dd>
            <dt>發布時間</dt>
            <dd>{formatTime(source.publishedAt, "未提供發布時間")}</dd>
            <dt>取得時間</dt>
            <dd>{formatTime(source.retrievedAt, "未提供取得時間")}</dd>
            <dt>來源網址</dt>
            <dd className="morningBriefUrl">{present(source.url, "來源網址未提供")}</dd>
            {source.originalUrl && source.originalUrl !== source.url && (
              <>
                <dt>原始來源網址</dt>
                <dd className="morningBriefUrl">
                  <a href={source.originalUrl} target="_blank" rel="noreferrer">
                    {source.originalUrl}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

export default function MorningBriefContent({ brief, compact = false, headingLevel = 2 }) {
  if (!brief) return null;
  const baseHeadingLevel = boundedHeadingLevel(headingLevel, 2);
  return (
    <section className={`morningBrief ${compact ? "morningBrief--compact" : ""}`}>
      <MorningBriefHeader
        brief={brief}
        compact={compact}
        headingLevel={baseHeadingLevel}
      />
      {compact ? (
        <section aria-label="五則事件摘要">
          <BoundedHeading level={baseHeadingLevel + 1} fallback={3}>
            五則事件摘要
          </BoundedHeading>
          <ol className="morningBriefEventSummaries">
            {brief.events?.map((event) => (
              <MorningBriefEventCard key={`${event.rank}:${event.headline}`} event={event} compact />
            ))}
          </ol>
        </section>
      ) : (
        <>
          <section aria-label="晨報來源">
            <BoundedHeading level={baseHeadingLevel} fallback={2}>來源</BoundedHeading>
            <EvidenceList evidence={brief.evidence} headingLevel={baseHeadingLevel + 1} />
          </section>
          <section aria-label="晨報五則事件">
            <BoundedHeading level={baseHeadingLevel} fallback={2}>五則事件</BoundedHeading>
            <div className="morningBriefEventList">
              {brief.events?.map((event) => (
                <MorningBriefEventCard
                  key={`${event.rank}:${event.headline}`}
                  event={event}
                  headingLevel={baseHeadingLevel + 1}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
