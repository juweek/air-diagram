/**
 * ── THE GOURMET MEDIA CONTAINER CONVENTION ─────────────────────────────────
 * Every graph / interactive area sits inside this container — the same
 * `.gourmetMediaContainer` div used across gourmetDataInteractives and
 * foodBarCharts, ported to React. Structure (class names match the originals
 * so the convention carries over):
 *
 *   <div class="gourmetMediaContainer">
 *     <h2> big question title </h2>
 *     <i>  intro note </i>
 *     <div class="buttonsDiv"> <select> …views… </select> </div>   ← the dropdown
 *     <div class="graphArea">                                       ← inset band
 *       <h4 class="graphTitle"> per-view title </h4>
 *       <i class="graphSubhead"> per-view subhead </i>
 *       …the graphic (children)…
 *       <i class="graphSource"> Source: <a>…</a> </i>
 *     </div>
 *   </div>
 *
 * The CONTAINER owns the title/subhead/source, so charts inside it should
 * render headerless (pass header={false} to ChartFrame/BarChart/LineChart —
 * see src/lib/brandChart.jsx). Styling lives in src/index.css under
 * "gourmetMediaContainer convention".
 *
 * `views` drives the dropdown: [{ value, label, graphTitle?, graphSubhead? }].
 * Omit `views` (or pass one) and no dropdown renders. For bespoke controls
 * (buttons, sliders), pass them as `controls` instead.
 */
export default function GourmetMediaContainer({
  title,
  titleAction,
  intro,
  views,
  view,
  onViewChange,
  controls,
  graphTitle,
  graphSubhead,
  source,
  children,
}) {
  const active = views?.find((v) => v.value === view) ?? views?.[0];
  const showDropdown = views && views.length > 1;

  return (
    <div className="gourmetMediaContainer">
      {/* The title shares its baseline row with an optional action (e.g. the
         "Random" jump), which sits flush-right and wraps below on narrow cards. */}
      {(title || titleAction) && (
        <div className="containerTitleRow">
          {title && <h2>{title}</h2>}
          {titleAction}
        </div>
      )}
      {intro && <i className="containerIntro">{intro}</i>}

      {(showDropdown || controls) && (
        <div className="buttonsDiv">
          {showDropdown && (
            <select
              className="selectButton"
              value={active?.value}
              onChange={(e) => onViewChange(e.target.value)}
              aria-label="Choose a view"
            >
              {views.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          {controls}
        </div>
      )}

      <div className="graphArea">
        {(graphTitle ?? active?.graphTitle) && (
          <h4 className="graphTitle">
            <b>{graphTitle ?? active?.graphTitle}</b>
          </h4>
        )}
        {(graphSubhead ?? active?.graphSubhead) && (
          <i className="graphSubhead">{graphSubhead ?? active?.graphSubhead}</i>
        )}

        {children}

        {source && (
          <i className="graphSource">
            Source:{' '}
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          </i>
        )}
      </div>
    </div>
  );
}
