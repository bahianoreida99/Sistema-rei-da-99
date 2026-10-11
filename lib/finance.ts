import type { Lead } from "./supabase";
export interface DocumentSplit {
  bahiano_cents: number | null;
  campaign_cents: number | null;
}
export function finance(
  leads: Lead[],
  split: DocumentSplit = { bahiano_cents: null, campaign_cents: null },
) {
  const paid = leads.filter(
    (l) =>
      l.payment_status === "confirmed" &&
      Boolean(l.delivered_at) &&
      l.stage === "pagos",
  );
  const outstanding = leads.filter(
    (l) => l.stage === "finalizados" && l.payment_status !== "confirmed",
  );
  const tracked = (l: Lead) =>
    Boolean(l.campaign_code || ["meta", "campanha"].includes(l.source));
  const validSplit =
    Number.isInteger(split.bahiano_cents) &&
    Number.isInteger(split.campaign_cents) &&
    Number(split.bahiano_cents) >= 0 &&
    Number(split.campaign_cents) >= 0 &&
    Number(split.bahiano_cents) + Number(split.campaign_cents) === 15000;
  return {
    paid,
    outstanding,
    awaitingPayment: outstanding.filter((l) => Boolean(l.delivered_at)),
    received: paid.reduce((sum, l) => sum + l.price_cents, 0),
    receivable: outstanding.reduce((sum, l) => sum + l.price_cents, 0),
    bahiano: paid.reduce(
      (sum, l) =>
        sum +
        (l.service === "uber"
          ? 27000
          : l.service === "documento" && validSplit
            ? Number(split.bahiano_cents)
            : 0),
      0,
    ),
    campaign: paid.reduce(
      (sum, l) =>
        sum +
        (!tracked(l)
          ? 0
          : l.service === "uber"
            ? 8000
            : l.service === "documento" && validSplit
              ? Number(split.campaign_cents)
              : 0),
      0,
    ),
    documentSplitPending:
      paid.some((l) => l.service === "documento") && !validSplit,
  };
}
