import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { inr } from "../../lib/format";
import { Tag } from "../../components/Tag";
import type { CommercialRow, CommercialStatement as CommercialStatementData } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/evaluation/commercialStatement.js --
// the commercial comparison statement for one line (Procurement Officer):
// technically qualified bids ranked by landed price (L1, L2...) or by
// combined score on QCBS lines (C1, C2...). Disqualified bids appear
// without prices. Opening this is logged server-side as price access.
const dash = (v: unknown, fmt: (x: never) => string = (x) => String(x)): string => (v == null ? "—" : fmt(v as never));

function RankCell({ r }: { r: CommercialRow }) {
  if (r.rank == null) return <Tag text="Disqualified" tone="neg" />;
  return (
    <>
      <span className="fs-18px fw-800">{r.rank_label}</span>
      {r.recommended && (
        <div>
          <Tag text="Recommended" tone="pos" />
        </div>
      )}
    </>
  );
}

function Row({ r, qcbs }: { r: CommercialRow; qcbs: boolean }) {
  const off = r.rank == null;
  return (
    <tr>
      <td className="ep-cell">
        <RankCell r={r} />
      </td>
      <td className="ep-cell">
        <div className="fw-600">{r.vendor_name}</div>
        <div className="ep-sub">rating {r.rating}</div>
        {r.tie_note && <div className="ep-sub maxw-220px text-danger-700">{r.tie_note}</div>}
      </td>
      <td className="ep-cell fs-12-5px">
        {off ? (
          r.technical_reason || ""
        ) : r.technical_score != null ? (
          <>
            score <b>{r.technical_score}</b> / 100{r.t_rank ? ` · T${r.t_rank}` : ""}
          </>
        ) : (
          "qualified"
        )}
      </td>
      <td className="ep-cell">
        {off ? (
          <span className="ep-sub">Price not opened</span>
        ) : (
          <>
            <div className="fw-700">{inr(r.unit_price)}</div>
            <div className="ep-sub">
              +{r.gst_percent ?? 0}% GST{r.other_duties ? ` + ${inr(r.other_duties)}` : ""}
            </div>
          </>
        )}
      </td>
      <td className="ep-cell">
        {!off && (
          <>
            <div className="fw-700">{inr(r.landed_unit_price)}</div>
            <div className="ep-sub">total {inr(r.landed_total)}</div>
          </>
        )}
      </td>
      {qcbs && (
        <td className="ep-cell fs-12-5px">
          {!off && (
            <>
              price {dash(r.price_score)}
              <div className="ep-sub">
                combined <b>{dash(r.combined_score)}</b>
              </div>
            </>
          )}
        </td>
      )}
      <td className="ep-cell fs-12-5px">
        {!off && (
          <>
            {dash(r.delivery_lead_days, (d) => d + " days")}
            <div className="ep-sub">valid {dash(r.quote_validity_days, (d) => d + " days")}</div>
            {r.payment_terms && <div className="ep-sub">{r.payment_terms}</div>}
          </>
        )}
      </td>
      <td className="ep-cell fs-12-5px">
        {!off && (
          <>
            {r.variance_pct != null && `${r.variance_pct > 0 ? "+" : ""}${r.variance_pct}% vs estimate`}
            {r.price_flags.map((f, i) => (
              <div className="text-danger-700" key={i}>
                {f}
              </div>
            ))}
          </>
        )}
      </td>
    </tr>
  );
}

export function CommercialStatement({ lineId, onError }: { lineId: number; onError: (message: string) => void }) {
  const [s, setS] = useState<CommercialStatementData | null>(null);

  useEffect(() => {
    api<CommercialStatementData>(`/evaluation/lines/${lineId}/commercial`)
      .then(setS)
      .catch((err) => onError("Could not open prices: " + (err instanceof Error ? err.message : String(err))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  if (!s) return <div className="ep-pane ep-pane-pad hint">Opening prices…</div>;
  const qcbs = s.method === "QCBS";

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Commercial Comparison · {qcbs ? `QCBS (technical ${s.technical_weight} / price ${s.price_weight})` : "lowest landed price (L1)"}</span>
        <span className="ep-k">prices opened · access is logged</span>
      </div>
      <div className="hint padding-10px-16px">
        Only technically qualified bids are ranked. Landed price = unit price + GST + duties.
        {qcbs ? " On QCBS lines the lowest bid scores 100 on price and the rest are scored against it." : ""}
        {s.estimated_price != null ? ` Internal estimate: ${inr(s.estimated_price)} per unit (never shown to vendors).` : ""}
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Rank", "Vendor", "Technical", "Quoted price", "Landed price", ...(qcbs ? ["QCBS"] : []), "Delivery / terms", "Checks"].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <Row r={r} qcbs={qcbs} key={r.vendor_id} />
          ))}
        </tbody>
      </table>
      <div className="ep-sub padding-10px-16px">Confirming the recommendation (L1 confirmation) and any split-award proposal come next; this statement does not award anything.</div>
    </div>
  );
}
