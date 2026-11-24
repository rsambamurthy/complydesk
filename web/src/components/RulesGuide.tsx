/** How the compliance calendar works out its dates — the written documentation of the rules engine (also in docs/rules.md). */
export function RulesGuide() {
  return (
    <section className="card pad" style={{ lineHeight: 1.65 }}>
      <h3 style={{ marginTop: 0 }}>How dates are worked out</h3>
      <ol style={{ paddingInlineStart: 20, margin: 0 }}>
        <li><strong>Which rules count.</strong> Every firm starts from the built-in rules (kept up to date by Integrata). A firm can change any of them or add its own; a firm’s version always wins for that firm.</li>
        <li><strong>Which companies.</strong> A rule applies to a client when every condition holds: company type, small company or not, the client’s ticks (MSME dues, outstanding loans), first financial year, or the auditor’s term ending that year.</li>
        <li><strong>Which years.</strong> The calendar covers last financial year (its annual filings fall due this year) and the current one. Nothing is due before incorporation; a company incorporated between January and March has a first FY running to the following 31 March.</li>
        <li><strong>The due date</strong>, by kind:
          <ul>
            <li><em>Fixed date</em> — a day and month, in the FY or the year after it (e.g. DPT-3: 30 June after the FY).</li>
            <li><em>Several dates</em> — one item per quarter or half-year (board meetings, MSME-1).</li>
            <li><em>Days after the AGM / first board meeting / incorporation</em> — from the date recorded when the meeting is marked held. Until then the date is <strong>estimated</strong> (marked “est.”) from the last permitted AGM date (30 Sep; 31 Dec for the first AGM) or a fixed date.</li>
            <li><em>Last AGM date</em> — 6 months after the FY ends (9 months for the first FY).</li>
            <li><em>Each director, every N years</em> — DIR-3 KYC: counted from the FY of the director’s last filing (+N), else the FY of DIN allotment (+N+1), due by the set date.</li>
            <li><em>Days after an event</em> — added from a client’s Compliance tab (appointment, allotment, charge…).</li>
          </ul></li>
        <li><strong>In force from / until.</strong> A due date outside these dates is ignored — so a change in law is a new rule from a date, with the old one ending the day before.</li>
        <li><strong>When rules change.</strong> Every client is recalculated at once and again every night. Items already filed or held keep their dates; untouched items the rules no longer produce are hidden; items someone has worked on stay.</li>
        <li><strong>Late fee.</strong> A per-day amount is multiplied by the days late (shown in red); otherwise the note is shown.</li>
      </ol>
    </section>
  );
}
