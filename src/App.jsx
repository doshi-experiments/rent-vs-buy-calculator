import {Button, HelpPopover, SegmentedControl} from "@doshi-experiments/design-system/react";
import { resolveTokens } from "./design-system/tokens.js";
import React, { useState, useMemo } from "react";
import routesData from "./routes.json";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

/* ------------------------------------------------------------------ *
 *  Palette + type
 * ------------------------------------------------------------------ */
/* Two sheets, one drawing. `C` is deliberately mutable: it is read at
 * render time by every component and by the <style> block below, so
 * swapping its contents and re-rendering repaints the whole app. That
 * beats threading a theme prop through ~2000 lines of JSX, and it keeps
 * concrete shared token values going to the installed Recharts version. */
function palette(appearance) {
  const t = resolveTokens({project: 'calculator', appearance});
  return {bg:t['surface-page'], panel:t['surface-raised'], panelAlt:t['surface-overlay'],
    ink:t.text, mute:t['text-secondary'], line:t.border, buy:t['action-primary'],
    buySoft:t['success-bg'], rent:t['chart-4'], rentSoft:t['error-bg'],
    signal:t['warning-text'], rentWash:t['error-bg'], grid:t.border,
    field:t['surface-raised'], onBuy:t['action-text']};
}
const LIGHT = palette('light'), DARK = palette('dark');
const intensity = appearance => {
  const t = resolveTokens({project:'calculator', appearance});
  return [t['action-primary'], ...[1,2,3,4,5].map(i => t['ramp-'+i])];
};
const LIGHT_TINTS = intensity('light'), DARK_TINTS = intensity('dark');

const C = { ...LIGHT };
const BUY_TINTS = [...LIGHT_TINTS];

function readTheme() {
  const m = document.cookie.match(/(?:^|;\s*)sheet-theme=(light|dark)/);
  let t = m && m[1];
  if (!t) { try { t = localStorage.getItem("sheet-theme"); } catch (e) {} }
  if (t !== "light" && t !== "dark")
    t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return t;
}
function applyPalette(t) {
  Object.assign(C, t === "dark" ? DARK : LIGHT);
  BUY_TINTS.length = 0;
  BUY_TINTS.push(...(t === "dark" ? DARK_TINTS : LIGHT_TINTS));
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  root.style.setProperty("--rvb-bg", C.bg);
  root.style.colorScheme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", C.bg);
}
function writeTheme(t) {
  /* cookie is scoped to the registrable domain so the choice carries
   * between rishabhdoshi.com, experiments. and rent-vs-buy. */
  try {
    document.cookie = "sheet-theme=" + t + ";domain=.rishabhdoshi.com;path=/;" +
                      "max-age=31536000;samesite=lax";
    document.cookie = "sheet-theme=" + t + ";path=/;max-age=31536000;samesite=lax";
    localStorage.setItem("sheet-theme", t);
  } catch (e) {}
}
const SERIF = resolveTokens()["font-display"];
const SANS = resolveTokens()["font-body"];
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/* ------------------------------------------------------------------ *
 *  Formatting
 * ------------------------------------------------------------------ */
/* MODEL:START — everything to MODEL:END is pure and DOM-free, so the
   Node test harness can slice it out and assert against it directly. */
const usd = (n) =>
  (n < 0 ? "-" : "") +
  "$" +
  Math.round(Math.abs(n)).toLocaleString("en-US");
const compact = (n) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "k";
  return s + "$" + Math.round(a);
};
const num = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};
const trim = (n) => n.toFixed(2).replace(/\.?0+$/, "");

/* Filters typed or pasted text down to a number as you go, so "$1,450,000"
 * becomes "1450000" instead of being rejected. The fields cannot use
 * type="number" for this: browsers hand back an empty string for anything
 * they consider invalid, so a single $ or comma silently blanked the field
 * and every downstream figure recomputed against zero. Keeps one leading
 * minus and at most one decimal point. */
const cleanNum = (v) => {
  let s = String(v).replace(/[^0-9.\-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  return (neg ? "-" : "") + s;
};

/* ------------------------------------------------------------------ *
 *  BC-specific rules
 * ------------------------------------------------------------------ */

// Canadian fixed mortgages compound semi-annually, not monthly.
const monthlyRate = (annualPct) => Math.pow(1 + annualPct / 200, 1 / 6) - 1;

const payment = (bal, i, n) =>
  bal <= 0 || n <= 0 ? 0 : i === 0 ? bal / n : (bal * i) / (1 - Math.pow(1 + i, -n));

// Property Transfer Tax: 1% to $200k, 2% to $2M, 3% to $3M, 5% above.
function bcPTT(price, firstTime) {
  let t = Math.min(price, 200000) * 0.01;
  if (price > 200000) t += (Math.min(price, 2000000) - 200000) * 0.02;
  if (price > 2000000) t += (Math.min(price, 3000000) - 2000000) * 0.03;
  if (price > 3000000) t += (price - 3000000) * 0.05;
  if (firstTime) {
    const full = 8000; // the exemption waives tax on the first $500k
    let credit = 0;
    if (price <= 835000) credit = Math.min(full, t);
    else if (price < 860000) credit = full * ((860000 - price) / 25000);
    t = Math.max(0, t - credit);
  }
  return t;
}

// CMHC premium, financed into the principal. Nothing owed at 20% down.
function cmhcPct(downPct, amortYears) {
  if (downPct >= 20) return 0;
  let r = downPct >= 15 ? 2.8 : downPct >= 10 ? 3.1 : 4.0;
  if (amortYears > 25) r += 0.2;
  return r;
}

// 5% of the first $500k, 10% of the rest; 20% required at $1.5M and up.
function minDownPct(price) {
  if (price >= 1500000) return 20;
  if (price <= 0) return 5;
  const d = Math.min(price, 500000) * 0.05 + Math.max(0, price - 500000) * 0.1;
  return (d / price) * 100;
}

// Home Owner Grant: $570 basic, clawed back above the $2.075M threshold.
function homeOwnerGrant(assessed, on) {
  if (!on) return 0;
  return Math.max(0, 570 - Math.max(0, (assessed - 2075000) / 1000) * 5);
}

/* ------------------------------------------------------------------ *
 *  Regions
 *
 *  The two countries do not merely use different numbers — the mortgage
 *  mathematics differs. Rather than scatter `if (isUS)` through the model,
 *  every rule that varies is reached through one profile object, so
 *  "did I handle both regions" is a single grep for `R.`.
 *
 *  The rule functions above stay exactly where they are; this only points
 *  at them, which keeps the diff on trusted bodies at zero.
 * ------------------------------------------------------------------ */
const REGIONS = {
  ca: {
    id: "ca",
    label: "British Columbia",
    monthlyRate,                                  // semi-annual compounding
    transferTax: (price, p) => bcPTT(price, p.firstTime),
    // CMHC is a one-time premium financed into the principal.
    mortgageInsurance: (downPct, amortYears) =>
      ({ upfrontPct: cmhcPct(downPct, amortYears), annualPct: 0, cancelLtv: 0 }),
    minDownPct,
    insurableCap: 1500000,
    propTaxCredit: (assessed, p) => homeOwnerGrant(assessed, p.hog),
    renews: true,
    breakPenaltyMonths: 3,
    registered: true,                             // FHSA / HBP exist
    gainExclusion: () => Infinity,                // principal residence, uncapped
    acqDebtCap: Infinity,
    saltCap: Infinity,
    itemizes: false,                              // no mortgage interest deduction
    hasPrepayPrivilege: true,                     // 10-20%/yr lump cap, most lenders
    defaults: {},                                 // DEFAULTS *is* the CA baseline
  },

  us: {
    id: "us",
    label: "United States",
    monthlyRate: (annualPct) => annualPct / 100 / 12,   // monthly, not semi-annual
    // Title, escrow, recording and lender fees, as a share of price. There is
    // no federal transfer tax; `firstTime` is ignored rather than repurposed.
    transferTax: (price, p) => (price * p.usClosingPct) / 100,
    // PMI is a monthly charge that terminates, not a premium financed into
    // the loan — so nothing is capitalised and the cancellation is handled
    // in the monthly loop.
    mortgageInsurance: (downPct, amortYears, p) =>
      ({ upfrontPct: 0, annualPct: downPct >= 20 ? 0 : p.pmiPct, cancelLtv: 78 }),
    minDownPct: () => 3,                          // conventional
    insurableCap: Infinity,
    propTaxCredit: () => 0,                       // no Home Owner Grant
    renews: false,                                // 30-yr fixed
    breakPenaltyMonths: 0,                        // no prepayment penalty
    registered: false,                            // no FHSA / HBP
    gainExclusion: (p) => (p.couple ? 500000 : 250000),   // §121
    acqDebtCap: 750000,
    saltCap: 10000,
    itemizes: true,
    hasPrepayPrivilege: false,                    // no prepayment cap
    // Applied only on an explicit region flip — never merged into DEFAULTS,
    // so old shared links keep parsing as Canada.
    defaults: {
      homePrice: 450000, downPct: 20, apprPct: 3.5, firstTime: false,
      legalFees: 3000, rate: 6.5, renewalRate: 6.5, termYears: 30, amortYears: 30,
      sellCostPct: 6, propTaxPct: 1.1, hog: false, insYr: 2200, maintYr: 4500,
      utilYr: 1200, strataMo: 0,
      rentMo: 2100, rentGrowthPct: 3.5, marketRentGrowthPct: 3.5,
      suiteRentMo: 0, marginalTaxPct: 32, capGainsPct: 15,
      fhsaUse: 0, hbpUse: 0, taxableUse: 120000, cashSavings: 0,
      apprThen: 300000, apprThenYear: 2016, apprNow: 450000, apprNowYear: 2026,
      cmpRate: 6.5, cmpAmort: 30,
      cmpA1: 350000, cmpA2: 425000, cmpA3: 500000, cmpA4: 600000, cmpA5: "",
      cpCash: 150000, cpLOCRate: 8.5,
      cpAPrice: 450000, cpAPropTax: 1.1, cpAMaint: 4500, cpAStrata: 0, cpASuite: 0,
      cpBPrice: 380000, cpBPropTax: 1.1, cpBMaint: 3000, cpBStrata: 250, cpBSuite: 0,
      cpBRemodel: 40000,
      ivPrice: 400000, ivRate: 7.0, ivApprPct: 3.5, ivPropTaxPct: 1.1,
      ivInsYr: 2400, ivUtilYr: 1200, ivU1: 1500, ivU2: 1400,
      ivU3: 1400, ivU4: 1400, ivU5: 1400, ivU6: 1400,
      ppLoan: 360000, ppRate: 6.5, ppAmort: 30, ppTermYears: 30, ppRenewalRate: 6.5,
    },
  },
};

/* ------------------------------------------------------------------ *
 *  The model
 * ------------------------------------------------------------------ */
function simulate(p) {
  // A string here would be coerced to 0 by the `p` loop and silently run the
  // wrong country's model, so fail loudly instead of falling back.
  if (typeof p.us !== "boolean") throw new Error("region flag `us` must be boolean");
  const R = REGIONS[p.us ? "us" : "ca"];
  const price = p.homePrice;
  const downPct = Math.min(100, Math.max(0, p.downPct));
  const down = (price * downPct) / 100;
  const ptt = R.transferTax(price, p);
  const closing = ptt + p.legalFees;

  const mi = R.mortgageInsurance(downPct, p.amortYears, p);
  const premiumPct = mi.upfrontPct;
  const pmiCutoff = (price * mi.cancelLtv) / 100;
  const baseLoan = Math.max(0, price - down);
  const premium = (baseLoan * premiumPct) / 100;
  const loan = baseLoan + premium; // the premium is added to the mortgage

  // Where the cash to close comes from. Each dollar carries its own tax character.
  const cashNeeded = down + closing;
  const capMult = p.couple ? 2 : 1;
  // Clamped in the model, not merely hidden in the UI: a stale URL must not
  // be able to inject Canadian registered money into a US run.
  const fhsaCap = R.registered ? 40000 * capMult : 0;
  const hbpCap = R.registered ? 60000 * capMult : 0;

  const fhsaUse = Math.max(0, Math.min(p.fhsaUse, fhsaCap, cashNeeded));
  const hbpUse = Math.max(0, Math.min(p.hbpUse, hbpCap, cashNeeded - fhsaUse));
  const savingsUse = Math.max(0, Math.min(p.cashSavings, cashNeeded - fhsaUse - hbpUse));
  const remainder = Math.max(0, cashNeeded - fhsaUse - hbpUse - savingsUse);

  // Brokerage fills the gap unless the user has pinned it themselves
  const taxableUse = p.autoBrokerage
    ? remainder
    : Math.max(0, Math.min(p.taxableUse, remainder));

  // Anything a pinned brokerage figure leaves uncovered has to come from cash
  const shortfall = remainder - taxableUse;
  const cashUse = savingsUse + shortfall;

  // Selling shares to fund a down payment realises the gain today
  const gainFrac = Math.min(1, Math.max(0, p.taxableGainPct / 100));
  const effSaleRate = Math.min(0.95, gainFrac * (p.capGainsPct / 100));
  const grossSale = taxableUse > 0 ? taxableUse / (1 - effSaleRate) : 0;
  const saleTax = grossSale - taxableUse;

  const marg = p.marginalTaxPct / 100;
  const remodelMonths = p.remodelCost > 0 ? Math.max(1, Math.round(p.remodelYears * 12)) : 0;
  const remodelMo = remodelMonths > 0 ? p.remodelCost / remodelMonths : 0;
  // Value added lands on the home as the work completes, then appreciates with it
  const remodelValue = p.remodelCost > 0 ? (p.remodelCost * p.remodelRecoveryPct) / 100 : 0;
  const remodelValueMo = remodelMonths > 0 ? remodelValue / remodelMonths : 0;
  const hasSuite = p.suiteRentMo > 0; // no suite: no rental income, nothing deductible
  const hbpAnnual = hbpUse / 15;
  const hbpGraceMonths = 24; // 2026 onward: repayments begin the second year after
  const hbpRepayMonths = 180;

  const amortMonths = Math.max(1, Math.round(p.amortYears * 12));
  // A US 30-yr fixed never renews. Setting the term to the full amortization
  // makes the renewal condition below unreachable (it needs m > 1 AND
  // (m-1) % termMonths === 0) in BOTH the main loop and the fullInterest
  // re-run, which read this same local — no extra branches.
  const termMonths = R.renews
    ? Math.max(1, Math.round(p.termYears * 12))
    : amortMonths;
  const months = Math.max(1, Math.round(p.horizonYears * 12));

  let i = R.monthlyRate(p.rate);
  let pmt = payment(loan, i, amortMonths);
  const firstPayment = pmt;
  let renewalPayment = null;

  const mAppr = Math.pow(1 + p.apprPct / 100, 1 / 12);
  const mInfl = Math.pow(1 + p.inflPct / 100, 1 / 12);
  const mInv = Math.pow(1 + Math.max(-99, p.investPct - p.feeDragPct) / 100, 1 / 12);

  const afterTax = (val, basis) =>
    val - Math.max(0, val - basis) * (p.capGainsPct / 100);

  let balance = loan;
  let homeValue = price;

  // Investments carried through the purchase rather than spent on it. Seeded
  // on BOTH sides — the household keeps them whichever way it goes — so it
  // cancels out of the buy-vs-rent spread. It exists so that a renovation has
  // somewhere real to be drawn from; without it buyPort starts empty, because
  // by construction the buyer has just spent everything on closing.
  const keep = Math.max(0, p.keepInvested || 0);
  const keepBasis = keep * (1 - gainFrac);

  // The renter never liquidates, so their money keeps its original character
  let rentPort = grossSale + cashUse + keep; // taxable: shares stay unsold, cash gets invested
  let rentBasis = grossSale * (1 - gainFrac) + cashUse + keepBasis;
  let rentReg = fhsaUse + hbpUse; // registered: RRSP, plus an FHSA that rolls into one
  let buyPort = keep;
  let buyBasis = keepBasis;
  let buyReg = 0; // the buyer's RRSP, rebuilt by HBP repayments
  let totHbpRepaid = 0;
  let totHbpTax = 0;
  let infl = 1;

  let totInterest = 0,
    totPrincipal = 0,
    totBuyOut = 0,
    totRentOut = 0,
    totMaint = 0,
    totPropTax = 0,
    totSuite = 0,
    totRemodel = 0,
    totRemodelFromPort = 0,
    totRemodelTax = 0,
    totLOCInterest = 0,
    totPMI = 0,
    totTaxBenefit = 0,
    totRemodelSpent = 0;
  // Annual buckets for the US itemized settlement. Deductions are an annual,
  // itemized-vs-standard decision, so they cannot be prorated monthly:
  // max(standard/12, itemized_m) is not max(standard, sum itemized_m) exactly
  // in the borderline case that decides most households, and the SALT cap is
  // annual too.
  let yrDeductInt = 0, yrSaltProp = 0, yrBalSum = 0, yrMonths = 0;
  // Renovation on a line of credit: draws pile onto the balance, the
  // interest-only minimum is paid from cash flow each month, and whatever
  // is still owing comes off the sale price at the horizon. HELOCs price
  // monthly, not semi-annually like the mortgage, so /12 is the honest rate.
  let locBal = 0;
  const locMoRate = (p.locRatePct || 0) / 100 / 12;
  let payoffMonth = null;
  let pmiEndsMonth = null;
  let y1Buy = null;
  let y1Rent = null;

  // Breaking a fixed mortgage mid-term costs at least three months' interest
  // Must be zeroed explicitly: with termMonths === amortMonths the modulo is
  // true nearly every month, so it would otherwise fire constantly.
  const penaltyAt = (mIdx) =>
    R.breakPenaltyMonths > 0 && balance > 0 && termMonths > 0 && mIdx % termMonths !== 0
      ? balance * i * R.breakPenaltyMonths
      : 0;
  // Tax on the home's own gain. Canada needs no branch: its exclusion is
  // Infinity, so `gain - Infinity` floors at zero and nothing is charged.
  // Basis is money SPENT, so the remodel's cost — not the value it added.
  const saleGainTax = (mIdx) => {
    const realized = homeValue * (1 - p.sellCostPct / 100);
    const gain = Math.max(0, realized - (price + closing + totRemodelSpent));
    // §121 wants 2 of the last 5 years of ownership and use.
    const excl = mIdx >= 24 ? R.gainExclusion(p) : 0;
    return Math.max(0, gain - excl) * (p.capGainsPct / 100);
  };
  // The whole series is a "if you liquidated today" series — that is what
  // sellCostPct and the break penalty already do at every point — so the
  // gain tax belongs at every point too. Charging it only at the end would
  // leave the breakeven search comparing pre-tax months to a post-tax end.
  const netBuy = (mIdx) =>
    homeValue * (1 - p.sellCostPct / 100) -
    balance -
    locBal -
    penaltyAt(mIdx) -
    saleGainTax(mIdx) +
    afterTax(buyPort, buyBasis) +
    buyReg * (1 - marg);
  const netRent = () => afterTax(rentPort, rentBasis) + rentReg * (1 - marg);
  let contractRent = p.rentMo;

  const series = [{ t: 0, buy: netBuy(0), rent: netRent() }];
  const years = [];
  const amort = [];
  let yrPrincipal = 0,
    yrInt = 0,
    yrBuyOut = 0,
    yrRentOut = 0;

  for (let m = 1; m <= months; m++) {
    // Renewal: the rate resets and the payment is recalculated over what's left
    if (m > 1 && (m - 1) % termMonths === 0 && m <= amortMonths) {
      i = R.monthlyRate(p.renewalRate);
      pmt = payment(balance, i, amortMonths - (m - 1));
      if (renewalPayment === null) renewalPayment = pmt;
    }

    const balOpen = balance;          // PMI bills on this, as interest does
    const interest = balance * i;
    const principal = Math.min(Math.max(pmt - interest, 0), balance);
    const pi = balance > 0 ? interest + principal : 0;
    balance = Math.max(0, balance - principal);
    if (balance === 0 && payoffMonth === null && loan > 0) payoffMonth = m;

    const grossTax = (homeValue * p.propTaxPct) / 100;
    const propTax = Math.max(0, grossTax - R.propTaxCredit(homeValue, p)) / 12;
    const maint = (p.maintYr / 12) * infl;
    const ins = (p.insYr / 12) * infl;
    const util = (p.utilYr / 12) * infl;
    const strata = p.strataMo * infl;
    // Statutory termination is 78% of the ORIGINAL value, not the appreciated
    // one — keying this to homeValue cancels PMI years early and flatters
    // buying. Not deductible either: that provision lapsed after 2021.
    const pmi =
      mi.annualPct > 0 && balOpen > pmiCutoff ? (balOpen * mi.annualPct) / 100 / 12 : 0;
    totPMI += pmi;
    // The first month it stops being charged, so the page can say when
    if (pmiEndsMonth === null && mi.annualPct > 0 && pmi === 0) pmiEndsMonth = m;
    // Renovation money. Drawn from the taxable portfolio when asked for, which
    // both realises the gain and stops that money compounding — the real cost
    // of paying for a kitchen out of investments. Whatever the portfolio
    // cannot cover falls back to coming out of pocket, so the model degrades
    // instead of pretending the money was there.
    let remodel = m <= remodelMonths ? remodelMo : 0;
    // Basis counts the money that went into the house, whatever paid for it —
    // capture it before the funding branches below zero `remodel` out.
    totRemodelSpent += remodel;
    if (remodel > 0 && p.remodelFromLOC) {
      // Nothing leaves the pocket this month — the balance grows instead,
      // and the interest below starts compounding against the decision.
      locBal += remodel;
      remodel = 0;
    } else if (remodel > 0 && p.remodelFromPortfolio && buyPort > 0) {
      // Sell enough to net the month's bill, taxing only the gain actually
      // embedded in the portfolio right now — sales consume basis pro rata,
      // so a pot of fresh cash draws nearly tax-free at first and pays more
      // as its gains accrue. (The old flat t=0 rate overtaxed cash pots.)
      const basisFrac = Math.min(1, buyBasis / buyPort);
      const drawRate = Math.min(0.95, (1 - basisFrac) * (p.capGainsPct / 100));
      const grossDraw = remodel / (1 - drawRate);
      if (buyPort >= grossDraw) {
        buyPort -= grossDraw;
        buyBasis = Math.max(0, buyBasis - grossDraw * basisFrac);
        totRemodelTax += grossDraw - remodel;
        totRemodelFromPort += remodel;
        remodel = 0;
      } else {
        const tax = Math.max(0, buyPort - buyBasis) * (p.capGainsPct / 100);
        const netFromPort = buyPort - tax;
        totRemodelTax += tax;
        totRemodelFromPort += netFromPort;
        buyPort = 0;
        buyBasis = 0;
        remodel -= netFromPort;
      }
    }
    if (m <= remodelMonths) homeValue += remodelValueMo;
    // Interest-only minimum on whatever has been drawn so far
    const locInterest = locBal > 0 ? locBal * locMoRate : 0;
    totLOCInterest += locInterest;
    const gross = pi + propTax + maint + ins + util + strata + pmi + remodel + locInterest;

    const yearIdx = Math.floor((m - 1) / 12);

    // The suite's share of interest and running costs is deductible first
    const suiteGross = hasSuite
      ? p.suiteRentMo *
        Math.pow(1 + p.suiteGrowthPct / 100, yearIdx) *
        (1 - p.suiteVacancyPct / 100)
      : 0;
    const deductible = hasSuite
      ? (p.suiteSharePct / 100) * (interest + propTax + maint + ins + util + strata)
      : 0;
    const suiteTaxable = Math.max(0, suiteGross - deductible);
    const suiteTax = suiteTaxable * (p.marginalTaxPct / 100);
    const suite = suiteGross - suiteTax;
    const buyCost = gross - suite;

    // In BC a sitting tenant's rent is capped, but a move resets it to market
    const movingNow =
      p.moveEveryYears > 0 && m > 1 && m % 12 === 1 && yearIdx % p.moveEveryYears === 0;
    if (m > 1 && m % 12 === 1) {
      contractRent = movingNow
        ? p.rentMo * Math.pow(1 + p.marketRentGrowthPct / 100, yearIdx)
        : contractRent * (1 + p.rentGrowthPct / 100);
    }
    const rentCost = contractRent + p.rentInsMo * infl + (movingNow ? p.moveCost : 0);

    // Registered money compounds at the same market rate
    rentPort *= mInv;
    buyPort *= mInv;
    rentReg *= mInv;
    buyReg *= mInv;

    // Home Buyers' Plan: repay 1/15 a year, or have it added to your income
    let hbpFlow = 0;
    if (hbpUse > 0 && m > hbpGraceMonths && m <= hbpGraceMonths + hbpRepayMonths) {
      if (p.hbpRepay) {
        hbpFlow = hbpAnnual / 12;
        buyReg += hbpFlow;
        totHbpRepaid += hbpFlow;
      } else {
        hbpFlow = (hbpAnnual * marg) / 12; // the shortfall is taxed at your marginal rate
        totHbpTax += hbpFlow;
      }
    }
    // Bucket THIS month before settling, or December's interest lands in the
    // following year and the last year of the horizon loses a month entirely.
    yrDeductInt += interest;
    yrSaltProp += propTax;
    yrBalSum += balOpen;
    yrMonths += 1;

    // US itemized settlement, at the year boundary or the final partial year.
    let taxBenefit = 0;
    if (R.itemizes && (m % 12 === 0 || m === months)) {
      // Pub 936 average-balance method for the $750k acquisition-debt cap.
      const avgBal = yrBalSum / Math.max(1, yrMonths);
      const dedInt = yrDeductInt * Math.min(1, R.acqDebtCap / Math.max(avgBal, 1));
      const frac = yrMonths / 12;                       // partial final year
      const stateTax = p.usIncome * (p.usStateTaxPct / 100) * frac;
      const std = p.usStdDed * (p.couple ? 2 : 1) * frac;
      // Both sides, always. Comparing the owner's itemized total against the
      // standard deduction alone would credit them with a deduction they had
      // anyway — several thousand a year of benefit that does not exist.
      const ownerItem = dedInt + Math.min(R.saltCap * frac, stateTax + yrSaltProp);
      const renterItem = Math.min(R.saltCap * frac, stateTax);
      taxBenefit = marg * (Math.max(ownerItem, std) - Math.max(renterItem, std));
      totTaxBenefit += taxBenefit;
      yrDeductInt = 0; yrSaltProp = 0; yrBalSum = 0; yrMonths = 0;
    }

    // Routed through `diff` rather than straight into netBuy, so the refund
    // lands in the portfolio and compounds the way a real refund would.
    const diff = buyCost + hbpFlow - rentCost - taxBenefit;
    if (diff > 0) {
      rentPort += diff;
      rentBasis += diff;
    } else {
      buyPort += -diff;
      buyBasis += -diff;
    }

    yrPrincipal += principal;
    yrInt += interest;
    yrBuyOut += buyCost + hbpFlow;
    yrRentOut += rentCost;
    totInterest += interest;
    totPrincipal += principal;
    totBuyOut += buyCost + hbpFlow;
    totRentOut += rentCost;
    totMaint += maint;
    totRemodel += remodel;
    totPropTax += propTax;
    totSuite += suite;

    if (m === 12 || (m === months && y1Buy === null)) {
      y1Buy = { pi, propTax, maint, ins, util, strata, pmi, remodel, loc: locInterest, gross, suite, suiteTax, total: buyCost };
      y1Rent = { rent: contractRent, ins: p.rentInsMo * infl, total: rentCost };
    }

    homeValue *= mAppr;
    infl *= mInfl;

    if (m % 12 === 0) {
      years.push({
        year: m / 12,
        homeValue,
        balance,
        equity: homeValue * (1 - p.sellCostPct / 100) - balance,
        buyOut: yrBuyOut,
        rentOut: yrRentOut,
        buyNW: netBuy(m),
        rentNW: netRent(),
      });
      amort.push({ year: m / 12, principal: yrPrincipal, interest: yrInt });
      yrPrincipal = 0;
      yrInt = 0;
      yrBuyOut = 0;
      yrRentOut = 0;
    }
    series.push({ t: m / 12, buy: netBuy(m), rent: netRent() });
  }

  // Interest over the whole amortization, renewing at the renewal rate
  let fullInterest = 0;
  if (loan > 0) {
    let b = loan;
    let ii = R.monthlyRate(p.rate);
    let pp = payment(b, ii, amortMonths);
    for (let m = 1; m <= amortMonths && b > 0.005; m++) {
      if (m > 1 && (m - 1) % termMonths === 0) {
        ii = R.monthlyRate(p.renewalRate);
        pp = payment(b, ii, amortMonths - (m - 1));
      }
      const int = b * ii;
      b -= Math.min(Math.max(pp - int, 0), b);
      fullInterest += int;
    }
  }

  const final = series[series.length - 1];
  const advantage = final.buy - final.rent;

  let breakeven = null;
  for (let k = 0; k < series.length; k++) {
    if (series[k].buy >= series[k].rent) {
      let holds = true;
      for (let j = k; j < series.length; j++)
        if (series[j].buy < series[j].rent) {
          holds = false;
          break;
        }
      if (holds) {
        breakeven = series[k].t;
        break;
      }
    }
  }

  return {
    series,
    years,
    amort,
    advantage,
    breakeven,
    payment: firstPayment,
    renewalPayment,
    loan,
    baseLoan,
    premium,
    premiumPct,
    down,
    ptt,
    closing,
    legalFees: p.legalFees,
    fhsaUse,
    hbpUse,
    taxableUse,
    cashUse,
    grossSale,
    saleTax,
    saleGain: grossSale * gainFrac,
    hbpAnnual,
    hbpMonthly: p.hbpRepay ? hbpAnnual / 12 : 0,
    hbpTaxMonthly: p.hbpRepay ? 0 : (hbpAnnual * marg) / 12,
    totHbpRepaid,
    totHbpTax,
    registeredUsed: fhsaUse + hbpUse,
    overCap: p.fhsaUse > fhsaCap || p.hbpUse > hbpCap,
    fhsaCap,
    hbpCap,
    savingsUse,
    shortfall,
    remainder,
    autoBrokerage: p.autoBrokerage,
    sourcesTotal: fhsaUse + hbpUse + taxableUse + cashUse,
    buyRegEnd: buyReg,
    rentRegEnd: rentReg,
    buyTaxableEnd: afterTax(buyPort, buyBasis),
    rentTaxableEnd: afterTax(rentPort, rentBasis),
    breakPenalty: penaltyAt(months),
    totRemodelFromPort,
    totRemodelTax,
    totLOCInterest,
    totPMI,
    pmiEndsMonth,
    // What §121 leaves taxable at the horizon. Always 0 in Canada.
    gainTaxEnd: saleGainTax(months),
    totTaxBenefit,
    locBalance: locBal,
    cashToClose: down + closing,
    minDown: (price * R.minDownPct(price)) / 100,
    belowMin: downPct < R.minDownPct(price) - 0.001,
    insurable: price < 1500000,
    balanceEnd: balance,
    totInterest,
    totPrincipal,
    totBuyOut,
    totRentOut,
    totMaint,
    totPropTax,
    totSuite,
    totRemodel,
    remodelMo,
    remodelValue,
    fullInterest,
    payoffMonth,
    y1Buy,
    y1Rent,
    finalBuy: final.buy,
    finalRent: final.rent,
  };
}


/* ------------------------------------------------------------------ *
 *  Investment property
 *
 *  A separate model, not a flag on simulate(). simulate()'s spine is
 *  `diff = buyCost - rentCost` routing a surplus between two HOUSEHOLD
 *  portfolios; a rental has no renting household. The counterfactual is
 *  one portfolio seeded with the cash to close, fed by whatever the
 *  property costs to carry. It reuses what matters — the same `p`, the
 *  same region profile, payment(), and the same after-tax idiom.
 * ------------------------------------------------------------------ */
const IV_UNITS = ["ivU1", "ivU2", "ivU3", "ivU4", "ivU5", "ivU6"];
const IV_MAX_UNITS = IV_UNITS.length;

function ivUnitCount(p) {
  return Math.min(IV_MAX_UNITS, Math.max(1, Math.round(p.ivUnitCount || 1)));
}
// "Same rent for every unit" DERIVES from unit 1 rather than writing into the
// other slots. Writing would destroy the per-unit figures; deriving means
// switching back restores them exactly.
function ivUnitRent(p, idx) {
  const v = p.ivSameRent ? p.ivU1 : p[IV_UNITS[idx]];
  return v > 0 ? v : 0;
}
function ivGrossMonthlyRent(p) {
  let t = 0;
  for (let k = 0; k < ivUnitCount(p); k++) t += ivUnitRent(p, k);
  return t;
}

function simulateRental(p) {
  if (typeof p.us !== "boolean") throw new Error("region flag `us` must be boolean");
  const R = REGIONS[p.us ? "us" : "ca"];

  const price = p.ivPrice;
  const downPct = Math.min(100, Math.max(0, p.ivDownPct));
  const down = (price * downPct) / 100;
  // Investors get no first-time exemption and no owner-occupier grant, and
  // mortgage insurance does not exist on non-owner-occupied property in
  // either country — so R.mortgageInsurance is deliberately never called.
  const closing = R.transferTax(price, { ...p, firstTime: false }) + p.legalFees;
  const loan = Math.max(0, price - down);
  const cashToClose = down + closing + p.ivInitialCapex;

  const marg = p.marginalTaxPct / 100;
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const amortMonths = Math.max(1, Math.round(p.ivAmort * 12));
  const i = R.monthlyRate(p.ivRate);
  const pmt = payment(loan, i, amortMonths);

  // Depreciation applies to the building, never the land.
  const depBasis = ((price + closing) * p.ivBuildingPct) / 100;
  const usDepMo = R.id === "us" ? depBasis / 27.5 / 12 : 0;
  let ucc = R.id === "ca" && p.ivCCA ? depBasis : 0;   // Class 1, 4% declining

  const mAppr = Math.pow(1 + p.ivApprPct / 100, 1 / 12);
  const mInfl = Math.pow(1 + p.inflPct / 100, 1 / 12);
  const mInv = Math.pow(1 + Math.max(-99, p.investPct - p.feeDragPct) / 100, 1 / 12);

  let balance = loan, homeValue = price, infl = 1;
  let accumDep = 0, suspendedPAL = 0, capexSpent = p.ivInitialCapex;
  // The property's own side, and the "just buy index funds" alternative.
  let invPort = 0, invBasis = 0;
  let altPort = cashToClose, altBasis = cashToClose;

  let totEgi = 0, totOpex = 0, totInterest = 0, totTax = 0, totDep = 0, totCF = 0;
  let yrEgi = 0, yrOpex = 0, yrInt = 0, yrDep = 0, yrMonths = 0;
  let y1 = null;
  const years = [];

  const afterTax = (val, basis) => val - Math.max(0, val - basis) * (p.capGainsPct / 100);

  // Exit tax, charged at every point on the series for the same reason the
  // owner-occupier model charges its gain tax everywhere: the series is a
  // "if you sold today" series. There is NO §121 here — a rental is not a
  // principal residence.
  const exitTax = () => {
    const realized = homeValue * (1 - p.sellCostPct / 100);
    if (R.id === "us") {
      const adjBasis = price + closing + capexSpent - accumDep;
      const gain = realized - adjBasis;
      // Recapture can never exceed the gain.
      const recapture = Math.min(accumDep, Math.max(0, gain));
      const capGain = Math.max(0, gain - recapture);
      return recapture * 0.25 + capGain * (p.capGainsPct / 100) - suspendedPAL * marg;
    }
    // Canada: recapture is ordinary income, capital gain is separate.
    const buildingCost = ((price + closing) * p.ivBuildingPct) / 100;
    const recapture = Math.max(0, Math.min(realized, buildingCost) - (buildingCost - accumDep));
    const capGain = Math.max(0, realized - (price + closing + capexSpent));
    return recapture * marg + capGain * (p.capGainsPct / 100);
  };
  const netProp = () =>
    homeValue * (1 - p.sellCostPct / 100) - balance - exitTax() + afterTax(invPort, invBasis);
  const netAlt = () => afterTax(altPort, altBasis);

  const series = [{ t: 0, buy: netProp(), rent: netAlt() }];

  for (let m = 1; m <= months; m++) {
    const balOpen = balance;
    const interest = balance * i;
    const principal = Math.min(Math.max(pmt - interest, 0), balance);
    balance = Math.max(0, balance - principal);
    const debtService = balOpen > 0 ? interest + principal : 0;

    const yearIdx = Math.floor((m - 1) / 12);
    const gsi = ivGrossMonthlyRent(p) * Math.pow(1 + p.ivRentGrowthPct / 100, yearIdx);
    const egi = gsi * (1 - p.ivVacancyPct / 100);

    const propTax = (homeValue * p.ivPropTaxPct) / 100 / 12;
    const fixed = propTax + (p.ivInsYr / 12) * infl + (p.ivUtilYr / 12) * infl +
                  p.ivHoaMo * infl + (p.ivOtherYr / 12) * infl;
    // Maintenance, capex reserve and management all scale with collected rent.
    const variable = (egi * (p.ivMaintPct + p.ivCapexPct + p.ivMgmtPct)) / 100;
    const opex = fixed + variable;
    // NOI excludes debt service AND depreciation. Folding the mortgage in here
    // is the classic error and it corrupts cap rate, DSCR and cash-on-cash all
    // at once.
    const noi = egi - opex;

    const dep = R.id === "us" ? usDepMo : 0;
    accumDep += dep;
    capexSpent += (egi * p.ivCapexPct) / 100;

    yrEgi += egi; yrOpex += opex; yrInt += interest; yrDep += dep; yrMonths += 1;
    totEgi += egi; totOpex += opex; totInterest += interest; totDep += dep;

    // Annual tax settlement, same reasoning as the owner-occupier model.
    let tax = 0;
    if (m % 12 === 0 || m === months) {
      const frac = yrMonths / 12;
      let taxable;
      if (R.id === "ca" && p.ivCCA) {
        // CCA cannot create or increase a rental loss (s.1100(11)), and the
        // half-year rule applies in the first year.
        const beforeCCA = yrEgi - yrOpex - yrInt;
        const entitlement = ucc * 0.04 * (yearIdx === 0 ? 0.5 : 1);
        const cca = Math.min(Math.max(0, beforeCCA), entitlement);
        ucc -= cca; accumDep += cca; yrDep += cca; totDep += cca;
        taxable = beforeCCA - cca;
      } else {
        taxable = yrEgi - yrOpex - yrInt - yrDep;
      }

      if (taxable >= 0) {
        tax = taxable * marg;
      } else if (R.id === "us") {
        // §469 passive activity losses. The $25k active-participation
        // allowance phases out $1 per $2 of MAGI over $100k. Without this a
        // leveraged rental writes off a loss every early year and the return
        // is overstated invisibly.
        const allow = Math.max(0, Math.min(25000, 25000 - (p.usIncome - 100000) / 2)) * frac;
        const used = Math.min(-taxable, allow);
        suspendedPAL += -taxable - used;
        tax = -used * marg;
      } else {
        // Canada has no passive-loss regime: rental losses are deductible.
        tax = taxable * marg;
      }
      totTax += tax;
      yrEgi = 0; yrOpex = 0; yrInt = 0; yrDep = 0; yrMonths = 0;
    }

    invPort *= mInv; altPort *= mInv;
    const cashFlow = noi - debtService - tax;
    totCF += cashFlow;
    // Negative cash flow is money the investor must feed the property, so the
    // market alternative receives exactly the same money.
    if (cashFlow < 0) { altPort += -cashFlow; altBasis += -cashFlow; }
    else { invPort += cashFlow; invBasis += cashFlow; }

    if (m === 12 || (m === months && y1 === null)) {
      y1 = { gsi: gsi * 12, egi: egi * 12, opex: opex * 12, noi: noi * 12,
             debtService: debtService * 12, propTax: propTax * 12,
             tax: totTax, cashFlow: (noi - debtService) * 12 };
    }
    homeValue *= mAppr; infl *= mInfl;
    if (m % 12 === 0) {
      years.push({ year: m / 12, homeValue, balance, noi: noi * 12,
                   equity: homeValue * (1 - p.sellCostPct / 100) - balance,
                   accumDep, netProp: netProp(), netAlt: netAlt() });
    }
    series.push({ t: m / 12, buy: netProp(), rent: netAlt() });
  }

  const last = series[series.length - 1];
  const advantage = last.buy - last.rent;
  let breakeven = null;
  for (let k = 0; k < series.length; k++) {
    if (series[k].buy >= series[k].rent && series.slice(k).every((d) => d.buy >= d.rent)) {
      breakeven = series[k].t; break;
    }
  }

  const y = y1 || { gsi: 0, egi: 0, opex: 0, noi: 0, debtService: 0, tax: 0, cashFlow: 0 };
  const basisForCap = price + p.ivInitialCapex;
  return {
    series, years, advantage, breakeven, y1: y,
    price, loan, down, closing, cashToClose, payment: pmt,
    unitCount: ivUnitCount(p), grossMonthlyRent: ivGrossMonthlyRent(p),
    capRate: basisForCap > 0 ? (y.noi / basisForCap) * 100 : 0,
    cashOnCash: cashToClose > 0 ? ((y.noi - y.debtService) / cashToClose) * 100 : 0,
    afterTaxCoC: cashToClose > 0 ? ((y.noi - y.debtService - y.tax) / cashToClose) * 100 : 0,
    dscr: y.debtService > 0 ? y.noi / y.debtService : Infinity,
    grm: y.gsi > 0 ? price / y.gsi : 0,
    monthlyCF: (y.noi - y.debtService) / 12,
    monthlyCFAfterTax: (y.noi - y.debtService - y.tax) / 12,
    totEgi, totOpex, totInterest, totTax, totDep, totCF,
    accumDep, suspendedPAL, exitTax: exitTax(),
    finalValue: homeValue, finalBalance: balance,
  };
}

/* ------------------------------------------------------------------ *
 *  Mortgage prepayment
 *
 *  Two households, same mortgage, same monthly outflow. One sends extra
 *  money to the lender and pays the loan off early; the other pays only
 *  the regular amount and invests the difference. Both finish debt-free
 *  by the ORIGINAL amortization date — the prepayer just gets there
 *  early, then redirects the freed-up payment into the market for
 *  whatever's left of the term.
 *
 *  The integrity of the comparison rests on one rule: every month, both
 *  households spend exactly the same amount. `outAt(m)` is that shared
 *  budget. It is defined off the INVEST side's own balance (the
 *  do-nothing counterfactual, built first as `investRun`) and never off
 *  the prepay side's — so nothing downstream can make the two schedules
 *  drift apart. In Canada, where the payment resets every `termMonths`
 *  at a new rate, this also matters for realism: it is what makes the
 *  prepayer's freed-up cash automatically absorb their own renewal
 *  surplus rather than reverting to whatever a smaller balance would
 *  newly require.
 * ------------------------------------------------------------------ */
function simulatePrepay(p) {
  if (typeof p.us !== "boolean") throw new Error("region flag `us` must be boolean");
  const R = REGIONS[p.us ? "us" : "ca"];
  const loan = Math.max(0, p.ppLoan);
  const n = Math.max(1, Math.round(p.ppAmort * 12));
  const termMonths = R.renews ? Math.max(1, Math.round(p.ppTermYears * 12)) : n;
  const marg = p.marginalTaxPct / 100;
  const itemizing = !!p.ppDeduct && R.itemizes;

  if (loan <= 0) {
    return {
      loan: 0, basePmt: 0, amortMonths: n, termMonths, renews: R.renews,
      modeB: !!p.ppMode, targetMonths: n, modeBPmt: 0, derivedExtra: 0,
      targetTooLong: false, modeBPmtByTerm: null,
      monthlyExtra: 0, biweeklyExtra: 0, annualLump: 0, oneTimeLump: 0,
      oneTimeMonth: 0, oneTimeDropped: false,
      payoffMonth: 0, monthsSaved: 0, yearsSaved: 0,
      prepayInterest: 0, investInterest: 0, interestSaved: 0,
      prepayNet: 0, investNet: 0, advantage: 0, crossover: null,
      freedMonths: 0, freedMonthly: 0,
      hurdle: null, hurdleNet: null, hurdleVsRate: null, effectiveRate: 0,
      hurdleReason: "no-loan",
      renewals: [],
      itemizing: false, prepayRefund: 0, investRefund: 0, refundForfeited: 0,
      hasPrivilege: R.hasPrepayPrivilege, privilege: null,
      series: [{ t: 0, prepay: 0, invest: 0 }], years: [],
      outflowMismatch: 0,
    };
  }

  // A plain amortization run to `totalMonths`, renewing (rate resets, payment
  // recalculated on the balance remaining) exactly like simulate()'s main
  // loop. Used both for the do-nothing baseline (totalMonths = n) and, in
  // Mode B, for the shorter target run whose payment IS the answer.
  function buildAmortRun(totalMonths) {
    let balance = loan;
    let i = R.monthlyRate(p.ppRate);
    let pmt = payment(balance, i, totalMonths);
    const pmtByMonth = [];
    for (let m = 1; m <= totalMonths; m++) {
      if (R.renews && m > 1 && (m - 1) % termMonths === 0) {
        i = R.monthlyRate(p.ppRenewalRate);
        pmt = payment(balance, i, totalMonths - (m - 1));
      }
      pmtByMonth.push(pmt);
      const interest = balance * i;
      const principal = Math.min(Math.max(pmt - interest, 0), balance);
      balance = Math.max(0, balance - principal);
      if (balance < 0.005) balance = 0;       // float dust; see line ~638
    }
    return { pmtByMonth };
  }

  const investRun = buildAmortRun(n);
  const investPmtAt = (m) => investRun.pmtByMonth[m - 1];
  const basePmt = investRun.pmtByMonth[0];

  const modeB = !!p.ppMode;
  let targetMonths = n, targetTooLong = false, modeBRun = null;
  if (modeB) {
    targetMonths = Math.max(1, Math.round(p.ppTargetAmort * 12));
    if (targetMonths >= n) { targetTooLong = true; targetMonths = Math.max(1, n - 1); }
    modeBRun = buildAmortRun(targetMonths);
  }
  const modeBPmt = modeB ? modeBRun.pmtByMonth[0] : null;
  const derivedExtra = modeB ? Math.max(0, modeBPmt - basePmt) : 0;

  // Mode A's four levers. Disabled in Mode B — a lump would make the "done
  // in exactly Y years" headline false, since payoff would land before the
  // year the user typed, and bi-weekly is redundant once the payment
  // itself has already been solved for.
  const monthlyExtra = modeB ? 0 : Math.max(0, p.ppExtraMo);
  const biweeklyExtra = modeB ? 0 : (p.ppBiweekly ? basePmt / 12 : 0);
  const annualLump = modeB ? 0 : Math.max(0, p.ppAnnualLump);
  const oneTimeLumpRaw = modeB ? 0 : Math.max(0, p.ppOneTime);
  const anniv = Math.min(12, Math.max(1, Math.round(p.ppAnnivMonth || 12)));
  const oneTimeYear = Math.max(1, Math.round(p.ppOneTimeYear || 1));
  const oneTimeMonth = (oneTimeYear - 1) * 12 + anniv;
  const oneTimeDropped = oneTimeLumpRaw > 0 && oneTimeMonth > n;
  const oneTimeLump = oneTimeDropped ? 0 : oneTimeLumpRaw;

  const extraAt = (m) => monthlyExtra + biweeklyExtra
    + (annualLump > 0 && m % 12 === anniv % 12 ? annualLump : 0)
    + (m === oneTimeMonth ? oneTimeLump : 0);

  // The shared household budget — see the comment at the top of this
  // function. Reads only the INVEST side (`investPmtAt`, `modeBRun`),
  // never the prepay side, so the two schedules cannot drift apart.
  const outAt = (m) => modeB
    ? (m <= targetMonths ? modeBRun.pmtByMonth[m - 1] : modeBRun.pmtByMonth[targetMonths - 1])
    : investPmtAt(m) + extraAt(m);

  // One builder for both sides — they differ only in how much of `outAt`
  // the lender gets. Whatever is left over (`toMarket`) is identical in
  // total between the two by construction; only the split changes.
  function buildSide(attackAt) {
    let balance = loan;
    let i = R.monthlyRate(p.ppRate);
    let payoffMonth = null, totInterest = 0, totPaid = 0;
    let yrInt = 0, yrBalSum = 0, yrMonths = 0;
    const contrib = [], rows = [];
    for (let m = 1; m <= n; m++) {
      if (R.renews && m > 1 && (m - 1) % termMonths === 0) {
        i = R.monthlyRate(p.ppRenewalRate);
      }
      const balOpen = balance;
      const interest = balOpen * i;
      const attack = attackAt(m);
      const principal = Math.min(Math.max(attack - interest, 0), balOpen);
      balance = Math.max(0, balOpen - principal);
      if (balance < 0.005) balance = 0;
      const paid = balOpen > 0 ? interest + principal : 0;
      totPaid += paid;
      totInterest += interest;
      const toMarket = outAt(m) - paid;     // the stub, then the whole payment
      if (balance === 0 && payoffMonth === null) payoffMonth = m;

      // US mortgage-interest deduction, opt-in. Each side gets its own
      // refund off its own average balance — crediting the difference to
      // one side instead gets the spread right but the chart levels wrong.
      yrInt += interest; yrBalSum += balOpen; yrMonths += 1;
      let refund = 0;
      if (itemizing && (m % 12 === 0 || m === n)) {
        const avgBal = yrBalSum / Math.max(1, yrMonths);
        refund = marg * yrInt * Math.min(1, R.acqDebtCap / Math.max(avgBal, 1));
        yrInt = 0; yrBalSum = 0; yrMonths = 0;
      }

      contrib.push(toMarket + refund);
      rows.push({ balance, balOpen, interest, principal, paid, toMarket, refund });
    }
    return { contrib, rows, payoffMonth: payoffMonth === null ? n : payoffMonth, totInterest, totPaid };
  }

  const prepaySide = buildSide(outAt);
  const investSide = buildSide(investPmtAt);

  // Grow-then-contribute, same idiom as simulate()/simulateRental() (lines
  // ~339, ~800): a month's contribution earns nothing in its own month.
  function growFull(stream, annualPct) {
    const mInv = Math.pow(1 + Math.max(-99, annualPct - p.feeDragPct) / 100, 1 / 12);
    let port = 0, basis = 0;
    for (let k = 0; k < stream.length; k++) { port *= mInv; port += stream[k]; basis += stream[k]; }
    return { port, basis, afterTax: port - Math.max(0, port - basis) * (p.capGainsPct / 100) };
  }
  function growSeries(side, annualPct) {
    const mInv = Math.pow(1 + Math.max(-99, annualPct - p.feeDragPct) / 100, 1 / 12);
    let port = 0, basis = 0;
    const net = [];
    for (let k = 0; k < side.rows.length; k++) {
      port *= mInv; port += side.contrib[k]; basis += side.contrib[k];
      net.push(port - Math.max(0, port - basis) * (p.capGainsPct / 100) - side.rows[k].balance);
    }
    return net;
  }

  const prepayPort = growFull(prepaySide.contrib, p.investPct);
  const investPort = growFull(investSide.contrib, p.investPct);
  const advantage = prepayPort.afterTax - investPort.afterTax;

  // The hurdle: the annual return above which investing the extras beats
  // prepaying. Both sides are re-run at each trial rate — the prepay side
  // invests too, from its payoff month onward — but only through the cheap
  // scalar growFull(), never the month-by-month schedules again.
  const hasExtras = modeB ? derivedExtra > 1e-6
    : (monthlyExtra > 0 || biweeklyExtra > 0 || annualLump > 0 || oneTimeLump > 0);
  const spread = (x) => growFull(prepaySide.contrib, x).afterTax - growFull(investSide.contrib, x).afterTax;
  let hurdle = null, hurdleReason = null;
  if (!hasExtras) {
    hurdleReason = "no-extras";
  } else {
    let lo = 0, hi = 25, sLo = spread(0), sHi = spread(25);
    if (sHi > 0) { hi = 60; sHi = spread(60); }        // needed above ~18% mortgage rates
    if (sLo <= 0 || sHi > 0) {
      hurdleReason = "out-of-range";
    } else {
      for (let iter = 0; iter < 40 && hi - lo > 0.01; iter++) {
        const mid = (lo + hi) / 2;
        if (spread(mid) > 0) lo = mid; else hi = mid;
      }
      hurdle = (lo + hi) / 2;
    }
  }
  const hurdleNet = hurdle === null ? null : hurdle - p.feeDragPct;

  // Balance-weighted average rate over the loan's life — the fair thing to
  // measure the hurdle against once a Canadian renewal has put more than
  // one rate on the loan.
  const balSum = investSide.rows.reduce((s, r) => s + r.balOpen, 0);
  const effectiveRate = balSum > 0 ? (investSide.totInterest / balSum) * 12 * 100 : p.ppRate;
  const hurdleVsRate = hurdle === null ? null : hurdle - effectiveRate;

  const monthsSaved = Math.max(0, n - prepaySide.payoffMonth);
  const freedMonths = monthsSaved;
  const freedMonthly = prepaySide.payoffMonth < n ? outAt(Math.min(prepaySide.payoffMonth + 1, n)) : 0;

  const prepayRefund = prepaySide.rows.reduce((s, r) => s + r.refund, 0);
  const investRefund = investSide.rows.reduce((s, r) => s + r.refund, 0);

  // Renewal exposure: same household outflow either way, but the
  // prepayer's smaller balance means a smaller payment jump when the rate
  // resets — this is the case for prepaying that is invisible in the US.
  const renewalMonths = [];
  if (R.renews) for (let m = termMonths + 1; m <= n; m += termMonths) renewalMonths.push(m);
  const renewals = renewalMonths.map((m) => ({
    month: m, year: m / 12,
    investBalance: investSide.rows[m - 2].balance, investPmt: investPmtAt(m),
    prepayBalance: prepaySide.rows[m - 2].balance, prepayPmt: outAt(m),
  }));
  const modeBPmtByTerm = modeB
    ? [{ month: 1, pmt: modeBRun.pmtByMonth[0] },
       ...renewalMonths.filter((m) => m <= targetMonths).map((m) => ({ month: m, pmt: modeBRun.pmtByMonth[m - 1] }))]
    : null;

  // Canadian prepayment privilege — warn, never block. Resets every
  // mortgage year; a lump landing on the renewal month itself is exempt,
  // since a payout made at renewal attracts no penalty at all.
  let privilege = null;
  if (R.hasPrepayPrivilege) {
    const cap = loan * (Math.max(0, p.ppPrivilegePct) / 100);
    let worstYear = 0, worstPct = 0, breached = false, yrExtra = 0;
    for (let m = 1; m <= prepaySide.payoffMonth; m++) {
      const isRenewalMonth = R.renews && m > 1 && (m - 1) % termMonths === 0;
      if (!isRenewalMonth) yrExtra += Math.max(0, prepaySide.rows[m - 1].paid - investPmtAt(m));
      if (m % 12 === 0 || m === prepaySide.payoffMonth) {
        const pct = cap > 0 ? (yrExtra / cap) * 100 : 0;
        if (pct > worstPct) { worstPct = pct; worstYear = Math.ceil(m / 12); }
        if (yrExtra > cap + 1e-6) breached = true;
        yrExtra = 0;
      }
    }
    const paymentIncreasePct = basePmt > 0 ? (monthlyExtra / basePmt) * 100 : 0;
    privilege = {
      cap, worstYear, worstYearPct: worstPct, breached,
      paymentIncreasePct, paymentIncreaseBreached: paymentIncreasePct > p.ppPrivilegePct,
    };
  }

  const prepayNetSeries = growSeries(prepaySide, p.investPct);
  const investNetSeries = growSeries(investSide, p.investPct);
  const series = [{ t: 0, prepay: -loan, invest: -loan }];
  const years = [];
  let pIntYr = 0, iIntYr = 0;
  for (let m = 1; m <= n; m++) {
    series.push({ t: m / 12, prepay: prepayNetSeries[m - 1], invest: investNetSeries[m - 1] });
    pIntYr += prepaySide.rows[m - 1].interest;
    iIntYr += investSide.rows[m - 1].interest;
    if (m % 12 === 0 || m === n) {
      years.push({
        year: Math.ceil(m / 12),
        prepayBalance: prepaySide.rows[m - 1].balance, investBalance: investSide.rows[m - 1].balance,
        prepayInterestYr: pIntYr, investInterestYr: iIntYr,
      });
      pIntYr = 0; iIntYr = 0;
    }
  }
  // The first point from which investing stays ahead for the rest of the
  // horizon. Both series start tied at -loan, so the "holds for the rest"
  // clause is what keeps that opening tie from reading as a crossover.
  let crossover = null;
  for (let k = 0; k < series.length; k++) {
    if (series[k].invest >= series[k].prepay && series.slice(k).every((d) => d.invest >= d.prepay)) {
      crossover = series[k].t; break;
    }
  }

  // Integrity diagnostic: both sides' total spend must match every month.
  // Should be ~0 always, by construction — see the comment on `outAt`.
  let outflowMismatch = 0;
  for (let m = 1; m <= n; m++) {
    const a = prepaySide.rows[m - 1].paid + prepaySide.rows[m - 1].toMarket;
    const b = investSide.rows[m - 1].paid + investSide.rows[m - 1].toMarket;
    if (Math.abs(a - b) > outflowMismatch) outflowMismatch = Math.abs(a - b);
  }

  return {
    loan, basePmt, amortMonths: n, termMonths, renews: R.renews,
    modeB, targetMonths, modeBPmt, derivedExtra, targetTooLong, modeBPmtByTerm,
    monthlyExtra, biweeklyExtra, annualLump, oneTimeLump, oneTimeMonth, oneTimeDropped,
    payoffMonth: prepaySide.payoffMonth, monthsSaved, yearsSaved: monthsSaved / 12,
    prepayInterest: prepaySide.totInterest, investInterest: investSide.totInterest,
    interestSaved: investSide.totInterest - prepaySide.totInterest,
    prepayNet: prepayPort.afterTax, investNet: investPort.afterTax, advantage,
    crossover, freedMonths, freedMonthly,
    hurdle, hurdleNet, hurdleVsRate, effectiveRate, hurdleReason,
    renewals,
    itemizing, prepayRefund, investRefund, refundForfeited: investRefund - prepayRefund,
    hasPrivilege: R.hasPrepayPrivilege, privilege,
    series, years,
    outflowMismatch,
  };
}

/* MODEL:END */

/* ------------------------------------------------------------------ *
 *  Small UI pieces
 * ------------------------------------------------------------------ */
// Two-or-more mutually exclusive choices. This recipe was duplicated
// verbatim on the payments and compare tabs before it was extracted.
function Segmented({options, value, onChange}) {
  return <SegmentedControl options={options} value={value} onValueChange={onChange} />;
}
function Info({text, label}) {
  return <HelpPopover title={label || "More information"} label={label ? "What " + label + " means" : "More information"}>{text}</HelpPopover>;
}

function Eyebrow({ children, tone, as: Tag = "div" }) {
  return (
    <Tag
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        letterSpacing: "0.04em",
        color: tone || C.mute,
        fontWeight: 500,
        margin: 0,
      }}
    >
      {children}
    </Tag>
  );
}

function Field({ label, value, onChange, prefix, suffix, step = 1, hint, badge, readOnly, tip }) {
  const fieldId = React.useId();
  // Says so when characters were dropped, rather than silently changing the
  // number under the user — a stray letter in a pasted figure would
  // otherwise become a different, plausible-looking value.
  const [dropped, setDropped] = useState(false);
  React.useEffect(() => {
    if (!dropped) return;
    const id = setTimeout(() => setDropped(false), 2600);
    return () => clearTimeout(id);
  }, [dropped]);

  const handle = (e) => {
    const typed = e.target.value;
    const clean = cleanNum(typed);
    // Write the cleaned text back to the DOM node as well as to state.
    // React skips the re-render when the cleaned value happens to equal the
    // value already in state — pasting "$1,450,000" over 1450000, say — and
    // without this the rejected characters stay sitting in the field.
    if (clean !== typed) e.target.value = clean;
    setDropped(clean !== typed);
    onChange(clean);
  };
  // type="text" loses the browser's arrow-key stepping, so put it back
  const onKeyDown = (e) => {
    if (readOnly) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? step * 10 : step);
    setDropped(false);
    onChange(trim(num(value) + d));
  };

  return (
    <div className="block">
      <span
        className="flex items-baseline justify-between"
        style={{ marginBottom: 4, gap: 6 }}
      >
        <span className="flex items-center" style={{ gap: 5, minWidth: 0 }}>
          <label htmlFor={fieldId} style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>{label}</label>
          {tip && <Info text={tip} label={label} />}
        </span>
        {badge}
      </span>
      <span
        className="flex items-center"
        style={{
          background: C.field,
          border: "1px solid " + C.line,
          borderRadius: 3,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {prefix && (
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute }}>
            {prefix}
          </span>
        )}
        <input
          id={fieldId}
          aria-describedby={(dropped || hint) ? fieldId + "-hint" : undefined}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={handle}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          className="w-full"
          style={{
            fontFamily: MONO,
            fontSize: 13.5,
            color: readOnly ? C.mute : C.ink,
            background: "transparent",
            border: "none",
            padding: "7px 4px",
            minWidth: 0,
            cursor: readOnly ? "default" : "text",
          }}
        />
        {suffix && (
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.mute }}>
            {suffix}
          </span>
        )}
      </span>
      {(dropped || hint) && (
        <span id={fieldId + "-hint"} role="status"
          style={{
            fontFamily: SANS,
            fontSize: 10.5,
            color: dropped ? C.signal : C.mute,
            display: "block",
            marginTop: 3,
          }}
        >
          {dropped ? "Numbers only — other characters were ignored." : hint}
        </span>
      )}
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step, accent, suffix, prefix, format }) {
  return (
    <div className="flex items-center gap-3">
      <span
        style={{ fontFamily: SANS, fontSize: 13, color: C.mute, whiteSpace: "nowrap", minWidth: 118 }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
        style={{ accentColor: accent }}
        aria-label={label}
      />
      <span
        className="flex items-center"
        style={{
          background: C.field,
          border: "1px solid " + C.line,
          borderRadius: 3,
          paddingLeft: 7,
          paddingRight: 7,
          flexShrink: 0,
        }}
      >
        {prefix && <span style={{ fontFamily: MONO, fontSize: 13, color: C.mute }}>{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            const clean = cleanNum(e.target.value);
            if (clean !== e.target.value) e.target.value = clean;  // see Field
            onChange(clean);
          }}
          aria-label={label + " value"}
          style={{
            fontFamily: MONO,
            fontSize: 17,
            fontWeight: 600,
            color: C.ink,
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "5px 2px",
            width: format === "money" ? 74 : 46,
            textAlign: "right",
          }}
        />
        {suffix && (
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.mute, paddingLeft: 3 }}>{suffix}</span>
        )}
      </span>
    </div>
  );
}

function Group({ title, children, note, tip }) {
  return (
    <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
      <Eyebrow>
        {title}
        {tip && <> <Info text={tip} label={title} /></>}
      </Eyebrow>
      {note && (
        <div
          style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 4 }}
        >
          {note}
        </div>
      )}
      <div className="rvb-fields mt-3">{children}</div>
    </div>
  );
}

function Panel({ children, className }) {
  return (
    <section
      className={className}
      style={{
        background: C.panel,
        border: "1px solid " + C.line,
        borderRadius: 4,
        padding: 18,
      }}
    >
      {children}
    </section>
  );
}

function Row({ label, value, tone, strong, tip }) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ padding: "5px 0", borderBottom: "1px dotted " + C.line, gap: 10 }}
    >
      <span className="flex items-center" style={{ gap: 5, minWidth: 0 }}>
        <span style={{ fontFamily: SANS, fontSize: 12.5, color: strong ? C.ink : C.mute }}>
          {label}
        </span>
        {tip && <Info text={tip} label={label} />}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          color: tone || C.ink,
          fontWeight: strong ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}


/* ------------------------------------------------------------------ *
 *  Appreciation calculator
 * ------------------------------------------------------------------ */
function AppreciationTab({ raw, set, p, appr, onApply }) {
  const pct = (n) => (n >= 0 ? "" : "\u2212") + Math.abs(n).toFixed(2) + "%";
  const good = appr.valid && appr.cagr !== null;
  const tone = !good ? C.mute : appr.cagr >= 0 ? C.buy : C.rent;

  return (
    <>
      <header className="mb-7">
        <Eyebrow as="h1">Home Appreciation Calculator · compound annual growth rate</Eyebrow>
        <p
          style={{
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: "clamp(28px, 5vw, 52px)",
            lineHeight: 1.06,
            letterSpacing: "-0.02em",
            margin: 0,
            marginTop: 10,
            maxWidth: 1020,
          }}
        >
          {good ? (
            <>
              That works out to{" "}
              <span style={{ color: tone, borderBottom: "3px solid " + tone }}>
                {pct(appr.cagr)}
              </span>{" "}
              a year over {appr.years === Math.round(appr.years) ? appr.years : appr.years.toFixed(1)}{" "}
              {Math.abs(appr.years) === 1 ? "year" : "years"}.
            </>
          ) : (
            <>Enter two values and a period.</>
          )}
        </p>
        <p style={{ fontFamily: SANS, fontSize: 14, color: C.mute, maxWidth: 640, marginTop: 12, lineHeight: 1.5 }}>
          Average annual growth isn't the total change divided by the years — growth compounds
          on itself. This works out the rate that actually gets you from one value to the other.
        </p>
      </header>

      <div className="rvb-main">
        <div className="rvb-col">
          <Panel>
            <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
              Two points in time
            </h2>
            <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
              Works for a home, an index, or anything else that compounds.
            </p>

            <Group title="Then">
              <Field label="Value" prefix="$" step={10000} value={raw.apprThen} onChange={set("apprThen")} />
              {!p.apprUseSpan && (
                <Field label="Year" step={1} value={raw.apprThenYear} onChange={set("apprThenYear")} />
              )}
            </Group>

            <Group title="Now">
              <Field label="Value" prefix="$" step={10000} value={raw.apprNow} onChange={set("apprNow")} />
              {!p.apprUseSpan && (
                <Field label="Year" step={1} value={raw.apprNowYear} onChange={set("apprNowYear")} />
              )}
            </Group>

            <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={raw.apprUseSpan}
                  onChange={(e) => set("apprUseSpan")(e.target.checked)}
                  style={{ accentColor: C.buy, width: 14, height: 14 }}
                />
                <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                  Use a time span instead of years
                </span>
              </label>
              {p.apprUseSpan && (
                <div className="mt-3">
                  <Field label="Over how long" suffix="yr" step={1} value={raw.apprSpan} onChange={set("apprSpan")} hint="Decimals are fine \u2014 1.5 for 18 months" />
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="rvb-col">
          <Panel className="mb-5">
            <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 12 }}>
              The numbers
            </h2>
            <Row label="Average annual growth" value={good ? pct(appr.cagr) : "\u2014"} tone={tone} strong />
            <Row label="Total change" value={good ? pct(appr.totalPct) : "\u2014"} />
            <Row label="Change in dollars" value={good ? usd(appr.now - appr.then) : "\u2014"} />
            <Row label="Years elapsed" value={good ? String(Math.round(appr.years * 100) / 100) : "\u2014"} />
            <Row
              label="Multiple of the starting value"
              value={good ? (appr.now / appr.then).toFixed(2) + "\u00d7" : "\u2014"}
            />
            {good && appr.doubling && appr.cagr > 0 && (
              <Row label="At this rate, doubles every" value={appr.doubling.toFixed(1) + " yr"} />
            )}

            {good && (
              <Button
                onClick={() => onApply(appr.cagr)}
                style={{
                  fontFamily: SANS,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.onBuy,
                  background: C.buy,
                  border: "none",
                  borderRadius: 3,
                  padding: "9px 14px",
                  marginTop: 14,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                Use {pct(appr.cagr)} in the rent vs. buy calculator
              </Button>
            )}
            <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 8, lineHeight: 1.45 }}>
              Careful with this one. A rate measured over a particular decade is history, not a
              forecast — pick a start year at the top of a boom and you'll flatter the future.
            </div>
          </Panel>

          {good && appr.curve.length > 1 && (
            <Panel>
              <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
                The same rate, projected on
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 10 }}>
                Solid is what happened. Dashed is the next ten years at the same rate — an
                illustration, not a prediction.
              </p>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <ComposedChart data={appr.curve} margin={{ top: 6, right: 10, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                      stroke={C.line}
                      interval={Math.max(0, Math.floor(appr.curve.length / 8) - 1)}
                    />
                    <YAxis
                      tickFormatter={compact}
                      tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                      stroke={C.line}
                      width={58}
                    />
                    <Tooltip
                      cursor={{ stroke: C.mute, strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={{ background: C.field, border: "1px solid " + C.line, borderRadius: 3, padding: "8px 10px", fontFamily: MONO, fontSize: 12 }}>
                            <div style={{ color: C.mute, fontSize: 10.5, marginBottom: 3 }}>
                              {d.label}
                              {d.projected ? " \u00b7 PROJECTED" : ""}
                            </div>
                            <div>{usd(d.value)}</div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      x={p.apprUseSpan ? Math.round(appr.years) : p.apprNowYear}
                      stroke={C.signal}
                      strokeWidth={2}
                      label={{ value: "today", position: "top", offset: 6, fontFamily: MONO, fontSize: 10, fill: C.signal }}
                    />
                    <Line
                      dataKey={(d) => (d.projected ? null : d.value)}
                      stroke={C.buy}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    <Line
                      dataKey={(d) => (d.projected ? d.value : null)}
                      stroke={C.buy}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Payment comparison
 *
 *  Five amounts against one set of conditions. "Amount" is deliberately
 *  either a purchase price or a mortgage — asking for a price lets the
 *  BC rules do their work (minimum down, CMHC premium financed into the
 *  principal), but someone who already knows their loan figure should
 *  not have to back into it through a down payment percentage.
 * ------------------------------------------------------------------ */
const CMP_SLOTS = ["cmpA1", "cmpA2", "cmpA3", "cmpA4", "cmpA5"];

function comparePayments(p) {
  const R = REGIONS[p.us ? "us" : "ca"];
  const priceMode = !p.cmpLoanMode;
  const i = R.monthlyRate(p.cmpRate);
  const n = Math.max(1, Math.round(p.cmpAmort * 12));
  const rows = [];

  CMP_SLOTS.forEach((k, idx) => {
    const amt = p[k];
    if (!(amt > 0)) return;               // blank slots simply drop out
    let down = 0, premium = 0, premiumPct = 0, minDown = 0, belowMin = false, loan;

    if (priceMode) {
      const dp = Math.min(100, Math.max(0, p.cmpDownPct));
      minDown = R.minDownPct(amt);
      belowMin = dp + 1e-9 < minDown;
      down = (amt * dp) / 100;
      premiumPct = R.mortgageInsurance(dp, p.cmpAmort, p).upfrontPct;
      const base = Math.max(0, amt - down);
      premium = (base * premiumPct) / 100;
      loan = base + premium;
    } else {
      loan = amt;
    }

    const mo = payment(loan, i, n);
    rows.push({
      key: k, idx, amt, down, premium, premiumPct, loan, mo,
      total: mo * n, interest: mo * n - loan,
      belowMin, minDown,
      ptt: priceMode ? R.transferTax(amt, { ...p, firstTime: p.cmpFirstTime }) : 0,
    });
  });

  return rows;
}

function PaymentsTab({ raw, set, p, rows, onCopyConditions }) {
  const us = !!p.us;
  const priceMode = !p.cmpLoanMode;
  const maxMo = rows.length ? Math.max(...rows.map((r) => r.mo)) : 0;
  const minMo = rows.length ? Math.min(...rows.map((r) => r.mo)) : 0;
  const cheapest = rows.find((r) => r.mo === minMo);

  return (
    <div className="rvb-main">
      {/* ---- inputs ---- */}
      <div className="rvb-col">
        <Panel>
          <Eyebrow as="h1">
            Mortgage Payment Comparison Calculator ·{" "}
            {us ? "United States" : "British Columbia"}
          </Eyebrow>
          <h2 style={{ fontFamily: SERIF, fontSize: 21, marginBottom: 2, marginTop: 8 }}>
            Compare payments
          </h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
            Up to five amounts, one set of conditions. Leave a row blank to drop it.
          </p>

          <div style={{ marginBottom: 4 }}>
            <Segmented
              options={[[false, "Purchase prices"], [true, "Mortgage amounts"]]}
              value={!priceMode}
              onChange={(v) => set("cmpLoanMode")(v)}
            />
          </div>

          <Group
            title="The same conditions"
            note={priceMode
              ? us
                ? "Applied to every amount below. PMI is charged monthly under 20% down and is not in these figures."
                : "Applied to every amount below. CMHC is added automatically under 20% down."
              : "Applied to every amount below. These are the mortgage figures themselves."}
          >
            <Field label="Interest rate" suffix="%" step={0.05}
                   value={raw.cmpRate} onChange={set("cmpRate")} />
            <Field label="Amortization" suffix="yr" step={1}
                   value={raw.cmpAmort} onChange={set("cmpAmort")} />
            {priceMode && (
              <Field label="Down payment" suffix="%" step={1}
                     value={raw.cmpDownPct} onChange={set("cmpDownPct")} />
            )}
          </Group>

          {priceMode && (
            <label className="flex items-center gap-2 cursor-pointer"
                   style={{ marginTop: -8, marginBottom: 14 }}>
              <input type="checkbox" checked={!!raw.cmpFirstTime}
                     onChange={(e) => set("cmpFirstTime")(e.target.checked)} />
              <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>
                {us ? "First-time buyer (affects closing costs, not the payment)"
                    : "First-time buyer (affects transfer tax, not the payment)"}
              </span>
            </label>
          )}

          <Group title={priceMode ? "Purchase prices" : "Mortgage amounts"}>
            {CMP_SLOTS.map((k, idx) => (
              <Field key={k} label={"Option " + (idx + 1)} prefix="$" step={25000}
                     value={raw[k]} onChange={set(k)} />
            ))}
          </Group>

          <Button
            type="button"
            onClick={onCopyConditions}
            style={{
              fontFamily: SANS, fontSize: 12, color: C.buy,
              background: "transparent", border: "1px solid " + C.line,
              borderRadius: 3, padding: "7px 11px", cursor: "pointer",
            }}
          >
            Use my rent-vs-buy conditions
          </Button>
        </Panel>
      </div>

      {/* ---- results ---- */}
      <div className="rvb-col">
        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 21, marginBottom: 2 }}>
            Monthly payment
          </h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
            Principal and interest only — no tax, insurance,{" "}
            {us ? "HOA dues" : "strata"} or upkeep.
            {priceMode && " Canadian fixed rates compound semi-annually."}
          </p>

          {rows.length === 0 ? (
            <div style={{
              fontFamily: SANS, fontSize: 12.5, color: C.mute,
              border: "1px dashed " + C.line, borderRadius: 3, padding: 16,
            }}>
              Put an amount into at least one option to see a payment.
            </div>
          ) : (
            <>
              {rows.map((r, n) => {
                // subtract the rounded figures, so the deltas agree with
                // the payments as displayed rather than being a dollar out
                const delta = Math.round(r.mo) - Math.round(minMo);
                const isLow = r === cheapest;
                return (
                  <div key={r.key} style={{
                    padding: "12px 0",
                    borderBottom: n === rows.length - 1 ? "none" : "1px solid " + C.line,
                  }}>
                    <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.mute }}>
                        {usd(r.amt)}
                        {priceMode && (
                          <span style={{ color: C.mute }}>
                            {"  →  "}{usd(r.loan)} mortgage
                          </span>
                        )}
                      </span>
                      <span style={{
                        fontFamily: MONO, fontSize: 19, fontWeight: 600,
                        color: isLow ? C.buy : C.ink, whiteSpace: "nowrap",
                      }}>
                        {usd(r.mo)}<span style={{ fontSize: 12, color: C.mute }}>/mo</span>
                      </span>
                    </div>

                    {/* the bar is the comparison; the numbers are the detail */}
                    <div style={{
                      height: 8, borderRadius: 999, background: C.panelAlt,
                      marginTop: 8, marginBottom: 7, overflow: "hidden",
                    }}>
                      <div style={{
                        width: (maxMo > 0 ? (r.mo / maxMo) * 100 : 0) + "%",
                        height: "100%", borderRadius: 999,
                        background: BUY_TINTS[Math.min(n, BUY_TINTS.length - 1)],
                        transition: "width .35s cubic-bezier(.4,0,.2,1)",
                      }} />
                    </div>

                    <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                      <span style={{ fontFamily: SANS, fontSize: 11, color: C.mute }}>
                        {isLow
                          ? "lowest payment"
                          : "+" + usd(delta) + "/mo  ·  +" + usd(delta * 12) + "/yr"}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute }}>
                        {usd(r.interest)} interest over {trim(p.cmpAmort)} yr
                      </span>
                    </div>

                    {priceMode && r.belowMin && (
                      <div style={{
                        fontFamily: SANS, fontSize: 10.5, color: C.signal, marginTop: 5,
                      }}>
                        {trim(p.cmpDownPct)}% is under the {trim(r.minDown)}% minimum down
                        {us ? " on a conventional loan" : " at this price"} — a lender
                        would not write this one.
                      </div>
                    )}
                    {priceMode && r.premiumPct > 0 && !r.belowMin && (
                      <div style={{
                        fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 5,
                      }}>
                        includes {trim(r.premiumPct)}% CMHC premium ({usd(r.premium)})
                        financed into the mortgage
                      </div>
                    )}
                  </div>
                );
              })}

              {rows.length > 1 && (
                <div style={{
                  marginTop: 14, padding: "10px 12px", borderRadius: 3,
                  background: C.panelAlt, fontFamily: SANS, fontSize: 12, color: C.ink,
                }}>
                  Cheapest to dearest is{" "}
                  <b>{usd(Math.round(maxMo) - Math.round(minMo))} a month</b>, or{" "}
                  <b>{usd((Math.round(maxMo) - Math.round(minMo)) * 12)} a year</b>.
                </div>
              )}

              {priceMode && rows.length > 0 && (
                <div style={{
                  marginTop: 10, fontFamily: SANS, fontSize: 10.5, color: C.mute,
                }}>
                  Transfer tax at these prices:{" "}
                  {rows.map((r, n) => (
                    <span key={r.key}>
                      {n ? " · " : ""}{usd(r.amt)} → {usd(r.ptt)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Two-property comparison
 *
 *  Runs the whole model twice and compares the two `advantage` figures —
 *  each property's net worth against the SAME renting alternative.
 *
 *  Comparing the two `buy` figures directly would be wrong: when a place
 *  costs more per month than renting, that surplus lands in the renter's
 *  portfolio, not the buyer's. Both properties will cost more than rent,
 *  so both end with an empty buyer portfolio, and the difference in what
 *  they cost each month would vanish from the answer entirely. Measuring
 *  each against a common rent baseline keeps that difference in view —
 *  which is why the rent inputs are shared and not per-property.
 * ------------------------------------------------------------------ */
const CP_FIELDS = [
  ["Price", "Purchase price", "$", null, 25000],
  ["Down", "Down payment", null, "%", 1],
  ["Appr", "Appreciation", null, "%/yr", 0.25],
  ["PropTax", "Property tax", null, "%/yr", 0.01],
  ["Maint", "Maintenance", "$", "/yr", 500],
  ["Strata", "Strata fee", "$", "/mo", 25],
  ["Suite", "Suite rent", "$", "/mo", 100],
  ["Remodel", "Remodelling", "$", null, 5000],
  ["RemodelYears", "Spread over", null, "yr", 1],
  ["RemodelRec", "Value recovered", null, "%", 5],
];

function compareProps(p, side) {
  // One pot of cash, whole household. Each property takes its down payment
  // and closing costs out of the pot on day one; whatever is left goes into
  // the market as the buyer's portfolio, and the renting alternative simply
  // invests the entire pot. A cheaper property therefore starts its owner
  // with more money working — which is most of what "affordable" means.
  //
  // The pot is cash, so its basis is itself: taxableGainPct is zeroed and
  // the t=0 brokerage machinery is bypassed. Renovations then draw from the
  // leftover (or ride the line of credit), taxed only on gains that have
  // actually accrued by the time of each draw.
  const g = (n) => p["cp" + side + n];
  const price = g("Price");
  const down = (price * Math.min(100, Math.max(0, g("Down")))) / 100;
  const R = REGIONS[p.us ? "us" : "ca"];
  const closeCost = down + R.transferTax(price, p) + p.legalFees;
  const cash = Math.max(0, p.cpCash);
  return {
    ...p,
    homePrice: price,
    downPct: g("Down"),
    apprPct: g("Appr"),
    propTaxPct: g("PropTax"),
    maintYr: g("Maint"),
    strataMo: g("Strata"),
    suiteRentMo: g("Suite"),
    remodelCost: g("Remodel"),
    remodelYears: g("RemodelYears"),
    remodelRecoveryPct: g("RemodelRec"),
    cashSavings: cash,
    fhsaUse: 0,
    hbpUse: 0,
    taxableUse: 0,
    autoBrokerage: false,
    taxableGainPct: 0,
    keepInvested: Math.max(0, cash - closeCost),
    remodelFromPortfolio: !p.cpRemodelLOC,
    remodelFromLOC: !!p.cpRemodelLOC,
    locRatePct: p.cpLOCRate,
  };
}

function CompareTab({ raw, set, p, cmp, onLoadA }) {
  const { a, b, pa, pb } = cmp;
  const us = !!p.us;
  const locMode = !!p.cpRemodelLOC;
  // Round before subtracting so the gap agrees with the figures on screen
  const advA = Math.round(a.advantage);
  const advB = Math.round(b.advantage);
  const gap = advA - advB;
  const winner = gap === 0 ? null : gap > 0 ? "A" : "B";
  const apprDiffers = pa.apprPct !== pb.apprPct;

  const mo = (r, s) => {
    const y = r.y1Buy || {};
    return y[s] || 0;
  };
  // Values stay numeric so the difference column can be derived rather than
  // parsed back out of formatted strings
  const perMo = (v) => usd(v) + "/mo";
  const rows = [
    ["Purchase price", pa.homePrice, pb.homePrice, usd, true],
    ["Cash to close", a.cashToClose, b.cashToClose, usd],
    ["Left invested, day one", pa.keepInvested, pb.keepInvested, usd],
    ["Mortgage", a.loan, b.loan, usd],
    ["Mortgage payment", a.payment, b.payment, perMo],
    ["Property tax", mo(a, "propTax"), mo(b, "propTax"), perMo],
    ["Maintenance", mo(a, "maint"), mo(b, "maint"), perMo],
    [us ? "HOA dues" : "Strata", mo(a, "strata"), mo(b, "strata"), perMo, false, true],
    ["Suite, after tax", -mo(a, "suite"), -mo(b, "suite"), perMo, false, true],
    ["Line of credit interest", mo(a, "loc"), mo(b, "loc"), perMo, false, true],
    ["Net cost, year 1", mo(a, "total"), mo(b, "total"), perMo, true],
  ];
  const signed = (v, fmt) =>
    Math.abs(v) < 0.5 ? "—" : (v > 0 ? "+" : "") + fmt(v);
  const cell = (v, tone, strong) => (
    <span style={{
      fontFamily: MONO, fontSize: 12.5, textAlign: "right",
      color: tone || C.ink, fontWeight: strong ? 600 : 400, whiteSpace: "nowrap",
    }}>{v}</span>
  );

  return (
    <>
      {/* ---- the verdict ---- */}
      <Panel className="mb-5">
        <Eyebrow as="h1">
          Compare Two Properties · {p.us ? "United States" : "British Columbia"} ·
          {" "}which home is the better buy
        </Eyebrow>
        {winner === null ? (
          <p style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15, marginTop: 10 }}>
            Both properties land in the same place.
          </p>
        ) : (
          <p style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15, marginTop: 10 }}>
            Property {winner} leaves you{" "}
            <span style={{
              color: C.buy, borderBottom: "2px solid " + C.buySoft, paddingBottom: 1,
            }}>{usd(Math.abs(gap))}</span>{" "}
            better off after {trim(p.horizonYears)} years.
          </p>
        )}
        <p style={{ fontFamily: SANS, fontSize: 13, color: C.mute, marginTop: 10, maxWidth: 760 }}>
          Each property is measured against the same renting alternative, then
          the two are compared. That keeps the difference in what they cost
          every month in the answer — it would otherwise disappear, since money
          not spent on a house is money invested either way.
        </p>

        <div className="rvb-pair mt-4">
          {[["A", a, advA], ["B", b, advB]].map(([id, r, adv]) => (
            <div key={id} style={{
              border: "1px solid " + (winner === id ? C.buy : C.line),
              borderRadius: 3, padding: "12px 14px",
              background: winner === id ? C.panelAlt : "transparent",
            }}>
              <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute }}>
                Property {id} · {usd(id === "A" ? pa.homePrice : pb.homePrice)}
              </div>
              <div style={{
                fontFamily: MONO, fontSize: 22, fontWeight: 600, marginTop: 4,
                color: adv >= 0 ? C.buy : C.rent,
              }}>
                {adv >= 0 ? "+" : "−"}{usd(Math.abs(adv))}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginTop: 2 }}>
                {adv >= 0 ? "ahead of renting" : "behind renting"} at year {trim(p.horizonYears)}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginTop: 5,
                            borderTop: "1px dotted " + C.line, paddingTop: 5 }}>
                starts with <b style={{ color: C.ink, fontWeight: 600 }}>
                {usd((id === "A" ? pa : pb).keepInvested)}</b> still invested
              </div>
            </div>
          ))}
        </div>

        {/* scrub the horizon and watch the verdict move */}
        <div style={{ marginTop: 16, borderTop: "1px solid " + C.line, paddingTop: 14 }}>
          <SliderRow label="Time period" value={p.horizonYears}
                     onChange={set("horizonYears")}
                     min={1} max={30} step={1} suffix="yr" accent={C.buy} />
        </div>

        {(a.shortfall > 0.5 || b.shortfall > 0.5) && (
          <div style={{
            marginTop: 14, padding: "9px 12px", borderRadius: 3,
            background: C.rentWash, fontFamily: SANS, fontSize: 11.5, color: C.rent,
          }}>
            Your cash does not cover the down payment and closing on{" "}
            {a.shortfall > 0.5 && b.shortfall > 0.5 ? "either property"
              : a.shortfall > 0.5 ? "Property A" : "Property B"}
            {" — short "}
            {a.shortfall > 0.5 && b.shortfall > 0.5
              ? usd(a.shortfall) + " and " + usd(b.shortfall)
              : usd(Math.max(a.shortfall, b.shortfall))}
            . The model pretends the gap is funded, so treat those numbers as
            optimistic.
          </div>
        )}
        {(a.belowMin || b.belowMin) && (
          <div style={{
            marginTop: 10, padding: "9px 12px", borderRadius: 3,
            background: C.panelAlt, fontFamily: SANS, fontSize: 11.5, color: C.signal,
          }}>
            The down payment on{" "}
            {a.belowMin && b.belowMin ? "both properties is" :
             a.belowMin ? "Property A is" : "Property B is"} below the minimum
            {us ? " on a conventional loan" : " for the price in BC"} — a lender
            would not write that mortgage.
          </div>
        )}

        {apprDiffers && (
          <div style={{
            marginTop: 14, padding: "9px 12px", borderRadius: 3,
            background: C.rentWash, fontFamily: SANS, fontSize: 11.5, color: C.ink,
          }}>
            These properties are set to appreciate at different rates
            ({trim(pa.apprPct)}% vs {trim(pb.apprPct)}%). Over{" "}
            {trim(p.horizonYears)} years that gap drives the result more than
            anything else on this page — worth being sure you believe it.
          </div>
        )}
      </Panel>

      {/* ---- how the renovation gets paid for (shared, deliberately:
              funding is a household decision, and making it per-property
              would let one side win by financing rather than by merit) ---- */}
      <Panel className="mb-5">
        <Eyebrow>Paying for renovations</Eyebrow>
        <div style={{ marginTop: 10, marginBottom: 12 }}>
          <Segmented
            options={[[false, "From investments"], [true, "From a line of credit"]]}
            value={locMode}
            onChange={(v) => set("cpRemodelLOC")(v)}
          />
        </div>
        <div className="rvb-fields">
          <Field label="Total available cash" prefix="$" step={25000}
                 value={raw.cpCash} onChange={set("cpCash")}
                 hint={"Down payment, " + (us ? "closing costs" : "transfer tax") +
                       " and legal come out of this; the rest is invested"} />
          {locMode && (
            <Field label="Line of credit rate" suffix="%" step={0.25}
                   value={raw.cpLOCRate} onChange={set("cpLOCRate")}
                   hint="Interest-only minimum, paid monthly" />
          )}
        </div>
        <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 8, maxWidth: 760 }}>
          {locMode
            ? "Each property takes its closing costs out of this pot on day one and " +
              "the rest goes straight into the market. Renovations ride the line of " +
              "credit instead of touching those investments: the interest-only " +
              "minimum comes out of cash flow monthly, and the balance comes off " +
              "the sale at the horizon. The renting alternative invests the whole pot."
            : "Each property takes its closing costs out of this pot on day one and " +
              "the rest goes straight into the market. Renovations are then drawn " +
              "from those investments as the work happens, taxed only on the gains " +
              "accrued by then. The renting alternative invests the whole pot."}
        </p>
      </Panel>

      {/* ---- inputs ---- */}
      <div className="rvb-pair mb-5">
        {["A", "B"].map((id) => (
          <Panel key={id}>
            <div className="flex items-center justify-between mb-1">
              <h2 style={{ fontFamily: SERIF, fontSize: 20 }}>Property {id}</h2>
              {id === "A" && (
                <Button type="button" onClick={onLoadA}
                  style={{
                    fontFamily: SANS, fontSize: 11, color: C.buy,
                    background: "transparent", border: "1px solid " + C.line,
                    borderRadius: 3, padding: "5px 9px", cursor: "pointer",
                  }}>
                  Load my rent-vs-buy scenario
                </Button>
              )}
            </div>
            <div className="rvb-fields mt-3">
              {CP_FIELDS.map(([k, label, prefix, suffix, step]) => (
                <Field key={k}
                       label={us ? { "Strata fee": "HOA dues", "Suite rent": "Rental income" }[label] || label : label}
                       prefix={prefix} suffix={suffix} step={step}
                       value={raw["cp" + id + k]} onChange={set("cp" + id + k)} />
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {/* ---- side by side ---- */}
      <Panel>
        <h2 style={{ fontFamily: SERIF, fontSize: 21, marginBottom: 2 }}>Side by side</h2>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
          Monthly figures are year one. Everything else on this page — rate,
          amortisation, taxes, the rent being compared against — is shared, and
          lives on the first tab.
        </p>

        <div className="rvb-cmp">
          <span />
          {cell("Property A", C.mute)}
          {cell("Property B", C.mute)}
          {cell("Difference", C.mute)}
          {rows.map(([label, av, bv, fmt, strong, dashZero]) => {
            const txt = (v) => (dashZero && Math.abs(v) < 0.5 ? "—" : fmt(v));
            const box = { padding: "6px 0", borderTop: "1px dotted " + C.line, textAlign: "right" };
            return (
              <React.Fragment key={label}>
                <span style={{
                  fontFamily: SANS, fontSize: 12.5, padding: "6px 0",
                  color: strong ? C.ink : C.mute,
                  fontWeight: strong ? 600 : 400,
                  borderTop: "1px dotted " + C.line,
                }}>{label}</span>
                <span style={box}>{cell(txt(av), null, strong)}</span>
                <span style={box}>{cell(txt(bv), null, strong)}</span>
                <span className="cmp-d" style={box}>
                  {/* rounded before subtracting, so the column agrees with
                      the two beside it rather than landing a dollar out */}
                  {cell(signed(Math.round(av) - Math.round(bv), fmt), C.mute, strong)}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid " + C.line, marginTop: 14, paddingTop: 12 }}>
          <Eyebrow>Over {trim(p.horizonYears)} years</Eyebrow>
          <div className="mt-2">
            <Row label="Home value at the horizon"
                 value={usd(a.years.length ? a.years[a.years.length - 1].homeValue : 0)
                        + "  ·  " + usd(b.years.length ? b.years[b.years.length - 1].homeValue : 0)} />
            <Row label="Mortgage still owing"
                 value={usd(a.years.length ? a.years[a.years.length - 1].balance : 0)
                        + "  ·  " + usd(b.years.length ? b.years[b.years.length - 1].balance : 0)} />
            {(a.totRemodelFromPort > 0.5 || b.totRemodelFromPort > 0.5) && (
              <>
                <Row label="Remodelling drawn from investments"
                     value={usd(a.totRemodelFromPort) + "  ·  " + usd(b.totRemodelFromPort)}
                     tone={C.rent} />
                <Row label="Capital gains tax realised doing so"
                     value={usd(a.totRemodelTax) + "  ·  " + usd(b.totRemodelTax)}
                     tone={C.rent} />
              </>
            )}
            {(a.totLOCInterest > 0.5 || b.totLOCInterest > 0.5) && (
              <>
                <Row label="Line of credit interest paid"
                     value={usd(a.totLOCInterest) + "  ·  " + usd(b.totLOCInterest)}
                     tone={C.rent} />
                <Row label="Still owing on the line of credit"
                     value={usd(a.locBalance) + "  ·  " + usd(b.locBalance)}
                     tone={C.rent} />
              </>
            )}
            {(a.totRemodel > 0.5 || b.totRemodel > 0.5) && (
              <Row label="Remodelling that fell back to cash"
                   value={usd(a.totRemodel) + "  ·  " + usd(b.totRemodel)}
                   tone={C.signal} />
            )}
            <Row label="Ahead of renting" strong
                 value={usd(advA) + "  ·  " + usd(advB)}
                 tone={C.buy} />
          </div>
          {(a.totRemodel > 0.5 || b.totRemodel > 0.5) && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: C.signal, marginTop: 8 }}>
              The renovation ran past what was left invested after closing, so
              the remainder is being paid out of pocket. Raise your total
              available cash if that is not what you meant.
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Investment property
 * ------------------------------------------------------------------ */

// One metric, stated plainly, with the sentence that says how to read it.
function Metric({ label, value, tone, note, tip }) {
  return (
    <div style={{ borderLeft: "3px solid " + (tone || C.line), paddingLeft: 10 }}>
      <Eyebrow>
        {label}
        {tip && <> <Info text={tip} label={label} /></>}
      </Eyebrow>
      <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600, marginTop: 3, color: tone || C.ink }}>
        {value}
      </div>
      {note && (
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 2, lineHeight: 1.35 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function InvestTab({ raw, set, setRaw, p, iv }) {
  const us = !!p.us;
  const units = iv.unitCount;
  const same = !!p.ivSameRent;
  const adv = Math.round(iv.advantage);
  const ahead = adv >= 0;
  const cf = iv.monthlyCFAfterTax;

  /* Typing a different figure into a unit that is currently following unit 1
   * is a perfectly reasonable thing to want, so take it: drop the toggle and
   * keep every unit showing exactly what it was already showing. Only the
   * units on screen are written — hidden slots keep their own figures for if
   * the count goes back up. Editing unit 1 itself is not a break: unit 1 is
   * the source, and changing it is what the toggle is for. */
  const editUnit = (idx) => (v) => {
    if (!same || idx === 0) return set(IV_UNITS[idx])(v);
    setRaw((st) => {
      const next = { ...st, ivSameRent: false };
      for (let k = 0; k < units; k++) next[IV_UNITS[k]] = st.ivU1;
      next[IV_UNITS[idx]] = v;
      return next;
    });
  };

  const be =
    iv.breakeven === null
      ? "not within " + trim(p.horizonYears) + " years"
      : iv.breakeven === 0
      ? "immediately"
      : "year " + trim(iv.breakeven);

  // Year one, top to bottom. Negatives are money going out, so the ledger
  // reads the way an operating statement does.
  const y = iv.y1;
  const stmt = [
    ["Gross scheduled rent", y.gsi, false],
    ["Vacancy", y.egi - y.gsi, false],
    ["Effective gross income", y.egi, true],
    ["Operating expenses", -y.opex, false],
    ["Net operating income", y.noi, true],
    ["Mortgage payment", -y.debtService, false],
    ["Cash flow before tax", y.noi - y.debtService, true],
    ["Income tax", -y.tax, false],
    ["Cash flow after tax", y.noi - y.debtService - y.tax, true],
  ];

  return (
    <>
      {/* ---- the verdict ---- */}
      <Panel className="mb-5">
        <Eyebrow as="h1">
          Investment Property Calculator · {us ? "United States" : "British Columbia"} ·
          {" "}buy and rent out
        </Eyebrow>
        <p style={{ fontFamily: SERIF, fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, marginTop: 10 }}>
          {ahead ? "This property beats" : "This property trails"} the market by{" "}
          <span style={{ color: ahead ? C.buy : C.rent, borderBottom: "3px solid " + (ahead ? C.buy : C.rent) }}>
            {usd(Math.abs(adv))}
          </span>{" "}
          after {trim(p.horizonYears)} years.
        </p>
        <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.mute, marginTop: 12, maxWidth: 760, lineHeight: 1.5 }}>
          The alternative is putting the whole {usd(iv.cashToClose)} of cash to
          close into the market at {trim(p.investPct)}% instead, and feeding it
          every dollar the property would have needed from you. Both sides are
          sold at the horizon and taxed. Owning pulls ahead{" "}
          <strong style={{ color: C.ink, fontWeight: 600 }}>{be}</strong>.
        </p>

        <div className="rvb-metrics mt-5">
          <Metric label="Return on the property" value={trim(iv.capRate) + "%"} tone={C.buy}
                  note="What the building itself earns, before any mortgage"
                  tip="Known in the trade as the cap rate: first-year net operating income divided by the price plus any up-front work. It ignores how you paid for the place, which is what makes it comparable between one deal and the next." />
          <Metric label="Return on your cash" value={trim(iv.cashOnCash) + "%"}
                  tone={iv.cashOnCash >= 0 ? C.buy : C.rent}
                  note={"First-year cash flow against the " + usd(iv.cashToClose) + " you put in"}
                  tip="Known as cash-on-cash. Unlike the return on the property, this one does count the mortgage — so it can be strongly negative on a place that is perfectly sound but heavily borrowed against." />
          <Metric label="Rent against the mortgage"
                  value={isFinite(iv.dscr) ? iv.dscr.toFixed(2) + "\u00d7" : "—"}
                  tone={iv.dscr >= 1.2 ? C.buy : iv.dscr >= 1 ? C.signal : C.rent}
                  note="Above 1.00 and the rent covers the payment on its own"
                  tip="The debt service coverage ratio, or DSCR: net operating income divided by the mortgage payment. Lenders writing investment mortgages usually want 1.20 or better, meaning the rent covers the payment with 20% to spare." />
          <Metric label="Monthly cash flow" value={usd(cf) + "/mo"}
                  tone={cf >= 0 ? C.buy : C.rent}
                  note={cf >= 0 ? "What lands in your account, after the mortgage and tax"
                                : "What you pay in every month, after the mortgage and tax"}
                  tip="Rent collected, less operating costs, less the mortgage payment, less income tax. This is the number that decides whether you can actually hold the property, as opposed to whether it is a good investment." />
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid " + C.line, paddingTop: 14 }}>
          <SliderRow label="Time period" value={p.horizonYears}
                     onChange={set("horizonYears")}
                     min={1} max={30} step={1} suffix="yr" accent={C.buy} />
        </div>

        {iv.dscr < 1 && (
          <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: 3,
                        background: C.rentWash, fontFamily: SANS, fontSize: 11.5, color: C.rent }}>
            Net operating income does not cover the mortgage
            (it covers {isFinite(iv.dscr) ? iv.dscr.toFixed(2) : "—"}× of it). Most lenders
            will not write this loan as an investment mortgage, and it needs
            {" "}{usd(-iv.monthlyCF)} a month out of your pocket before tax.
          </div>
        )}
      </Panel>

      {/* ---- the units ---- */}
      <Panel className="mb-5">
        <h2 style={{ fontFamily: SERIF, fontSize: 21, marginBottom: 2 }}>Rental units</h2>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
          {usd(iv.grossMonthlyRent)} a month across {units}{" "}
          {units === 1 ? "unit" : "units"}, before vacancy.
        </p>

        <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 14 }}>
          <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>Units</span>
          <Segmented
            options={[1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])}
            value={units}
            onChange={(n) => set("ivUnitCount")(n)}
          />
          <label className="flex items-center gap-2 cursor-pointer" style={{ marginLeft: 4 }}>
            <input
              type="checkbox"
              checked={same}
              onChange={(e) => set("ivSameRent")(e.target.checked)}
              style={{ accentColor: C.buy, width: 14, height: 14 }}
            />
            <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
              Same rent for every unit
            </span>
          </label>
        </div>

        <div className="rvb-units">
          {IV_UNITS.slice(0, units).map((k, idx) => (
            <Field
              key={k}
              label={"Unit " + (idx + 1) + (idx === 0 && same ? " · and every other unit" : "")}
              prefix="$" suffix="/mo" step={50}
              value={same && idx > 0 ? raw.ivU1 : raw[k]}
              onChange={editUnit(idx)}
              hint={same && idx > 0
                ? "Following unit 1 — type here to price it separately"
                : undefined}
            />
          ))}
        </div>
        {same && units > 1 && (
          <p style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 8 }}>
            Unit 1's rent is being applied to all {units}. Untick the box and
            your original per-unit figures come back exactly as they were; type
            over any unit instead and it keeps what is on screen, with that one
            unit set to whatever you typed.
          </p>
        )}
      </Panel>

      {/* ---- inputs ---- */}
      <div className="rvb-pair mb-5">
        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 12 }}>The purchase</h2>
          <div className="rvb-fields">
            <Field label="Purchase price" prefix="$" step={25000}
                   value={raw.ivPrice} onChange={set("ivPrice")} />
            <Field label="Down payment" suffix="%" step={5}
                   value={raw.ivDownPct} onChange={set("ivDownPct")}
                   hint={usd(iv.down) + " · " + (us ? "20–25% is typical" : "20% minimum on a rental")}
                   tip="Rentals cannot be insured in either country, so there is no low-down-payment option the way there is on a home you live in." />
            <Field label="Mortgage rate" suffix="%" step={0.25}
                   value={raw.ivRate} onChange={set("ivRate")}
                   tip="Set separately from the rate on the first tab, because lenders price investment mortgages roughly half a point to a full point above the rate on a home you live in." />
            <Field label="Years to pay it off" suffix="yr" step={5}
                   value={raw.ivAmort} onChange={set("ivAmort")}
                   tip="The amortization: how long the mortgage takes to reach zero. Stretching it lowers the payment and improves cash flow, at the cost of far more interest over the life of the loan." />
            <Field label="Appreciation" suffix="%/yr" step={0.5}
                   value={raw.ivApprPct} onChange={set("ivApprPct")}
                   tip="How fast you expect the property itself to gain value. This is a guess about the future rather than a fact about the present, and over a long horizon it drives the result more than the rent does." />
            <Field label="Work before the first tenant" prefix="$" step={5000}
                   value={raw.ivInitialCapex} onChange={set("ivInitialCapex")}
                   tip="Paint, appliances, permits, anything the place needs before it can be let. It comes out of your pocket at closing and it raises your cost base, so it reduces the taxable gain when you eventually sell." />
          </div>
          <div className="mt-4">
            <Row label="Mortgage" value={usd(iv.loan)} />
            <Row label="Mortgage payment" value={usd(iv.payment) + "/mo"}
                 tip="Principal and interest only. Property tax, insurance and everything else are counted separately, in the panel beside this one." />
            <Row label={us ? "Closing costs" : "Property transfer tax and legal"}
                 value={usd(iv.closing)} />
            <Row label="Cash to close" value={usd(iv.cashToClose)} strong
                 tip="Everything you hand over on day one: down payment, closing costs and any up-front work. This is the figure the market alternative starts with." />
            <Row label="Price as a multiple of yearly rent"
                 value={iv.grm > 0 ? iv.grm.toFixed(1) + "\u00d7" : "—"}
                 tip="The gross rent multiplier — price divided by a year of rent, before any costs. Crude, but it is the quickest way to sanity-check a price against others in the same area." />
          </div>
        </Panel>

        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 12 }}>Running it</h2>
          <div className="rvb-fields">
            <Field label="Vacancy" suffix="%" step={1}
                   value={raw.ivVacancyPct} onChange={set("ivVacancyPct")}
                   hint="Of the rent, every year"
                   tip="The share of the year a unit sits empty between tenants, plus rent you never manage to collect. Even a well-run place rarely does better than 3–5%." />
            <Field label="Rent growth" suffix="%/yr" step={0.5}
                   value={raw.ivRentGrowthPct} onChange={set("ivRentGrowthPct")} />
            <Field label="Property tax" suffix="%" step={0.05}
                   value={raw.ivPropTaxPct} onChange={set("ivPropTaxPct")}
                   hint="Of the property's value, which grows with it"
                   tip="Charged on the value, so this cost rises as the property appreciates. A rising valuation is not free." />
            <Field label="Insurance" prefix="$" suffix="/yr" step={200}
                   value={raw.ivInsYr} onChange={set("ivInsYr")} />
            <Field label={us ? "HOA dues" : "Strata fee"} prefix="$" suffix="/mo" step={50}
                   value={raw.ivHoaMo} onChange={set("ivHoaMo")} />
            <Field label="Utilities you pay" prefix="$" suffix="/yr" step={200}
                   value={raw.ivUtilYr} onChange={set("ivUtilYr")} />
            <Field label="Other fixed costs" prefix="$" suffix="/yr" step={200}
                   value={raw.ivOtherYr} onChange={set("ivOtherYr")}
                   hint="Licensing, accounting, landscaping" />
            <Field label="Repairs and maintenance" suffix="%" step={1}
                   value={raw.ivMaintPct} onChange={set("ivMaintPct")}
                   hint="Of the rent you collect"
                   tip="Day-to-day upkeep: a blocked drain, a broken window, turning a unit over between tenants. Set as a share of rent because a place that rents for more generally costs more to keep." />
            <Field label="Set aside for big items" suffix="%" step={1}
                   value={raw.ivCapexPct} onChange={set("ivCapexPct")}
                   hint="Of the rent you collect"
                   tip="Money put by for the roof, the furnace, the appliances — things that come round once a decade and sink a year's cash flow if nobody saved for them. It also raises your cost base, so it lowers the taxable gain at sale." />
            <Field label="Property management" suffix="%" step={1}
                   value={raw.ivMgmtPct} onChange={set("ivMgmtPct")}
                   hint="Of the rent you collect"
                   tip="What an agency charges to find tenants, collect rent and take the 2am phone call. Set it to zero if you will do it yourself — but that is a job, not a saving." />
          </div>
          <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 12, lineHeight: 1.45 }}>
            Fixed costs grow with inflation at {trim(p.inflPct)}%; the three
            percentages scale with collected rent. None of them are part of net
            operating income's opposite number — the mortgage deliberately stays
            out of it, which is what keeps the three ratios above comparable to
            any other deal you look at.
          </p>
        </Panel>
      </div>

      {/* ---- what the money would otherwise have done ---- */}
      <Panel className="mb-5">
        <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>
          What the money would otherwise have done
        </h2>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14, maxWidth: 860, lineHeight: 1.5 }}>
          The whole verdict on this page is a comparison against investing
          instead, so this rate is the single assumption it leans on hardest.
          It is shared with the other tabs — change it here and the rent-versus-buy
          answer moves with it.
        </p>

        <div className="rvb-fields">
          <Field label="Investment return" suffix="%/yr" step={0.5}
                 value={raw.investPct} onChange={set("investPct")}
                 tip="What the money would have earned in the market instead. This is the rate the whole comparison turns on: a point either way moves the answer more than almost anything else on the page." />
          <Field label="Fees and tax drag" suffix="%/yr" step={0.1}
                 value={raw.feeDragPct} onChange={set("feeDragPct")}
                 tip="Subtracted from the investment return every year. Covers the fund's management fee and the tax you pay along the way on dividends and distributions, as distinct from the tax on the gain when you finally sell."
                 hint={"Net " + trim(Math.max(0, p.investPct - p.feeDragPct)) + "%/yr after fees"} />
          <Field label="Tax on investment gains" suffix="%" step={1}
                 value={raw.capGainsPct} onChange={set("capGainsPct")}
                 tip={us
                   ? "Charged on the growth when the investments are sold at the end. 15% is the long-term rate for most households; set it to 0 if the money would sit in a Roth."
                   : "Charged on the growth when the investments are sold at the end. Set it to 0 if the money would sit in a TFSA."} />
          <Field label="Your marginal tax rate" suffix="%" step={1}
                 value={raw.marginalTaxPct} onChange={set("marginalTaxPct")}
                 tip="The rate on the next dollar you earn. Rental profit is taxed at this rate, and a rental loss is worth this much back to you." />
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid " + C.line, paddingTop: 12 }}>
          <Eyebrow>What counts as opportunity cost here</Eyebrow>
          <div className="mt-2">
            <Row label="Cash to close, invested instead from day one"
                 value={usd(iv.cashToClose)} tone={C.buy}
                 tip="Down payment, closing costs and any up-front work. The market alternative starts with all of it and compounds from month one." />
            <Row label="Money you feed the property, invested instead"
                 value={iv.totCF < 0 ? usd(-iv.totCF) : "None — it pays for itself"}
                 tone={iv.totCF < 0 ? C.buy : C.mute}
                 tip="Every month the property costs more than it collects, that shortfall is handed to the market side too. Otherwise a property that bleeds money would look free." />
            <Row label="Both sides sold and taxed at the horizon" value="Yes"
                 tip="Neither side gets to finish holding an untaxed gain. The property pays selling costs, capital gains and depreciation recapture; the portfolio pays tax on its growth." />
          </div>
          <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 10, maxWidth: 860, lineHeight: 1.5 }}>
            Positive cash flow goes the other way — into a portfolio on the
            property's side, at the same rate — so neither side gets free money
            sitting idle in a chequing account.
          </p>
        </div>
      </Panel>

      {/* ---- depreciation and tax ---- */}
      <Panel className="mb-5">
        <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>
          Depreciation and tax
        </h2>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14, maxWidth: 820 }}>
          {us
            ? "Residential rental property is written off straight-line over 27.5 years, " +
              "and it is not optional — the IRS recaptures it at sale whether or not you " +
              "claimed it. Recapture is taxed at 25%, above the capital gains rate."
            : "Capital cost allowance is optional in Canada, and often worth skipping: it " +
              "comes back as ordinary income at your full marginal rate on sale, while the " +
              "gain it shelters is only half-taxed. It also cannot create or increase a " +
              "rental loss."}
        </p>
        <div className="rvb-fields">
          <Field label="Building share of value" suffix="%" step={5}
                 value={raw.ivBuildingPct} onChange={set("ivBuildingPct")}
                 hint="Land is never depreciated. 55–70% is usual" />
          {us && (
            <Field label="Your other income" prefix="$" step={10000}
                   value={raw.usIncome} onChange={set("usIncome")}
                   hint="Sets how much of a rental loss you can deduct now" />
          )}
        </div>
        {!us && (
          <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={!!raw.ivCCA}
              onChange={(e) => set("ivCCA")(e.target.checked)}
              style={{ accentColor: C.buy, width: 14, height: 14 }}
            />
            <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
              Claim capital cost allowance (Class 1, 4% declining)
            </span>
          </label>
        )}

        <div className="mt-4">
          <Row label={us ? "Depreciation taken" : "CCA claimed"} value={usd(iv.totDep)} />
          {us && iv.suspendedPAL > 0.5 && (
            <Row label="Losses suspended to sale" value={usd(iv.suspendedPAL)} tone={C.signal} />
          )}
          <Row label="Tax on the sale" value={usd(iv.exitTax)} tone={C.rent} />
        </div>
        {us && iv.suspendedPAL > 0.5 && (
          <p style={{ fontFamily: SANS, fontSize: 11, color: C.signal, marginTop: 8, maxWidth: 820 }}>
            Your income is high enough that the $25,000 active-participation
            allowance is partly or fully phased out, so {usd(iv.suspendedPAL)} of
            rental losses cannot be deducted as they happen. They are not lost —
            they are released against the gain when you sell.
          </p>
        )}
        {!us && (
          <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 8, maxWidth: 820 }}>
            Canadian rental losses are deductible against your other income in
            the year they happen — the opposite of the US rule, where a
            high earner's losses wait until the sale.
          </p>
        )}
      </Panel>

      {/* ---- year one, line by line ---- */}
      <div className="rvb-pair mb-5">
        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>Year one</h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
            Annual figures. This is the statement a lender or a partner asks for.
          </p>
          <div>
            {stmt.map(([label, v, strong]) => (
              <Row key={label} label={label} value={usd(v)} strong={strong}
                   tone={strong ? (v >= 0 ? C.ink : C.rent) : v < 0 ? C.mute : undefined} />
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>
            Over {trim(p.horizonYears)} years
          </h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
            Everything the property collected, spent and owed, then what is left
            when you sell.
          </p>
          <div>
            <Row label="Rent collected" value={usd(iv.totEgi)} />
            <Row label="Operating expenses" value={usd(-iv.totOpex)} tone={C.mute} />
            <Row label="Mortgage interest" value={usd(-iv.totInterest)} tone={C.mute} />
            <Row label="Income tax" value={usd(-iv.totTax)} tone={C.mute} />
            <Row label="Cash flow, cumulative" value={usd(iv.totCF)}
                 tone={iv.totCF >= 0 ? C.buy : C.rent} strong />
            <Row label="Value at the horizon" value={usd(iv.finalValue)} />
            <Row label="Mortgage still owing" value={usd(iv.finalBalance)} tone={C.mute} />
            <Row label="Tax on the sale" value={usd(-iv.exitTax)} tone={C.mute} />
            <Row label="Net if you sell" value={usd(iv.series[iv.series.length - 1].buy)} strong />
            <Row label="The market instead" value={usd(iv.series[iv.series.length - 1].rent)} strong
                 tone={C.rent} />
          </div>
        </Panel>
      </div>

      {/* ---- the chart ---- */}
      <Panel>
        <div className="flex items-baseline justify-between mb-1">
          <h2 style={{ fontFamily: SERIF, fontSize: 21 }}>Property against the market</h2>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span style={{ width: 14, height: 3, background: C.buy, display: "inline-block" }} />
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.buy }}>Property</span>
            </span>
            <span className="flex items-center gap-2">
              <span style={{ width: 14, height: 3, background: C.rent, display: "inline-block" }} />
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.rent }}>The market</span>
            </span>
          </div>
        </div>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 10 }}>
          Both lines are after selling costs and tax, at every month — what you
          would actually walk away with if you got out that day.
        </p>
        <div className="rvb-chart">
          <ResponsiveContainer>
            <ComposedChart data={iv.series} margin={{ top: 18, right: 10, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis
                dataKey="t" type="number" domain={[0, p.horizonYears]}
                tickFormatter={(v) => (v === 0 ? "now" : "yr " + v)}
                tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                stroke={C.line}
              />
              <YAxis
                tickFormatter={compact}
                tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                stroke={C.line} width={58}
              />
              <Tooltip
                cursor={{ stroke: C.mute, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const d = payload[0].payload;
                  const lead = d.buy - d.rent;
                  return (
                    <div style={{
                      background: C.field, border: "1px solid " + C.line,
                      borderRadius: 3, padding: "8px 10px", fontFamily: MONO, fontSize: 12,
                    }}>
                      <div style={{ color: C.mute, fontSize: 10.5, marginBottom: 4 }}>
                        {d.t === 0 ? "Today" : "Year " + d.t.toFixed(1)}
                      </div>
                      <div style={{ color: C.buy }}>Property · {usd(d.buy)}</div>
                      <div style={{ color: C.rent }}>Market · {usd(d.rent)}</div>
                      <div style={{ color: C.ink, marginTop: 4, borderTop: "1px solid " + C.line, paddingTop: 4 }}>
                        {lead >= 0 ? "Property" : "Market"} ahead {usd(Math.abs(lead))}
                      </div>
                    </div>
                  );
                }}
              />
              {iv.breakeven !== null && iv.breakeven > 0 && (
                <ReferenceLine
                  x={iv.breakeven} stroke={C.signal} strokeWidth={2}
                  label={{ value: "break even", position: "top", offset: 6,
                           fontFamily: MONO, fontSize: 10, fill: C.signal }}
                />
              )}
              <Line dataKey="buy" stroke={C.buy} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="rent" stroke={C.rent} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 12, maxWidth: 900, lineHeight: 1.5 }}>
          The rate of return, the fee drag and the capital gains rate all come
          from the first tab, so this is measured against the same market you
          are comparing your own home to. Negative cash flow is paid to the
          property and credited to the market side, which is why a property
          that loses money every month is not automatically behind.
        </p>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Mortgage prepayment
 * ------------------------------------------------------------------ */
function PrepayTab({ raw, set, p, pp, onCopyConditions }) {
  const R = REGIONS[p.us ? "us" : "ca"];
  const us = !!p.us;
  const modeB = !!p.ppMode;
  const noLoan = pp.loan <= 0;
  const ahead = pp.advantage >= 0;

  const headline = noLoan
    ? "Enter a mortgage to see what prepaying it is worth."
    : pp.hurdleReason === "no-extras"
    ? "Add an extra payment to see what it's worth."
    : pp.hurdle === null
    ? "Prepaying wins at any plausible return."
    : (
      <>
        Investing instead beats prepaying above{" "}
        <span style={{ color: C.rent, borderBottom: "3px solid " + C.rent }}>
          {trim(pp.hurdle)}%
        </span>{" "}
        a year.
      </>
    );

  return (
    <>
      {/* ---- the verdict ---- */}
      <Panel className="mb-5">
        <Eyebrow as="h1">
          Mortgage Prepayment Calculator · {us ? "United States" : "British Columbia"} ·
          {" "}pay down the mortgage, or invest the difference
        </Eyebrow>
        <p style={{ fontFamily: SERIF, fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, marginTop: 10 }}>
          {headline}
        </p>
        <p style={{ fontFamily: SANS, fontSize: 12, color: C.mute, marginTop: 8, maxWidth: 820, lineHeight: 1.5 }}>
          A mortgage prepayment is a guaranteed, tax-free return equal to your
          rate. The market is a higher expected return that is neither
          guaranteed nor tax-free. The hurdle above is where those two trade
          off — it barely moves with how hard you prepay, because it is a
          property of your rate and your tax, not of the extra payment.
        </p>

        <div className="rvb-metrics mt-4">
          <Metric
            label="Paid off in"
            value={noLoan ? "—" : trim(pp.payoffMonth / 12) + " yr"}
            note={noLoan ? undefined
              : pp.monthsSaved > 0
              ? trim(pp.monthsSaved / 12) + " years earlier"
              : "same as the original schedule"}
          />
          <Metric
            label="Interest saved"
            value={noLoan ? "—" : usd(pp.interestSaved)}
            note={noLoan ? undefined : "vs. " + usd(pp.investInterest) + " without prepaying"}
          />
          <Metric
            label="Hurdle rate"
            value={pp.hurdle === null ? "—" : trim(pp.hurdle) + "%"}
            note={pp.hurdleVsRate === null ? undefined
              : (pp.hurdleVsRate >= 0 ? "+" : "") + trim(pp.hurdleVsRate) + "pp over your effective rate"}
            tip="The annual return the market would have to clear for investing the extras to beat prepaying, evaluated at the end of the original amortization."
          />
          <Metric
            label={"At " + trim(p.investPct) + "%, advantage of"}
            value={noLoan ? "—" : usd(Math.abs(pp.advantage)) + (ahead ? " prepaying" : " investing")}
            tone={noLoan ? undefined : ahead ? C.buy : C.rent}
            note="using the return you set below"
          />
        </div>
      </Panel>

      {/* ---- terms + levers ---- */}
      <div className="rvb-pair mb-5">
        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>Mortgage terms</h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
            A standalone loan — not tied to the price on the first tab.
          </p>
          <div className="rvb-fields">
            <Field label="Mortgage amount" prefix="$" step={10000} value={raw.ppLoan} onChange={set("ppLoan")} />
            <Field label="Interest rate" suffix="%" step={0.05} value={raw.ppRate} onChange={set("ppRate")} />
            <Field label="Amortization" suffix="yr" step={1} value={raw.ppAmort} onChange={set("ppAmort")} />
            {R.renews && (
              <Field label="Term" suffix="yr" step={1} value={raw.ppTermYears} onChange={set("ppTermYears")} />
            )}
            {R.renews && (
              <Field label="Rate at renewal" suffix="%" step={0.05} value={raw.ppRenewalRate}
                     onChange={set("ppRenewalRate")} hint="The big unknown" />
            )}
          </div>
          <Button
            type="button"
            onClick={onCopyConditions}
            style={{
              marginTop: 14, fontFamily: SANS, fontSize: 12, color: C.buy,
              background: "transparent", border: "1px solid " + C.line,
              borderRadius: 3, padding: "7px 11px", cursor: "pointer",
            }}
          >
            Use my rent-vs-buy conditions
          </Button>
        </Panel>

        <Panel>
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 10 }}>How you're paying it down</h2>
          <Segmented
            options={[[false, "Add extra payments"], [true, "Target an amortization"]]}
            value={modeB}
            onChange={set("ppMode")}
          />

          {modeB ? (
            <>
              <div className="rvb-fields mt-3">
                <Field
                  label="Pay it off in" suffix="yr" step={1}
                  value={raw.ppTargetAmort} onChange={set("ppTargetAmort")}
                  hint={!noLoan && pp.modeBPmt
                    ? usd(pp.modeBPmt) + "/mo to start, vs " + usd(pp.basePmt) + " today"
                    : undefined}
                />
              </div>
              <p style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 10, lineHeight: 1.5 }}>
                The extra-payment levers are off in this mode: a lump sum would
                make the target date wrong, and bi-weekly is redundant once the
                payment has already been solved for.
                {pp.targetTooLong && (
                  <><br /><span style={{ color: C.signal }}>
                    {trim(p.ppTargetAmort)} years isn't shorter than the{" "}
                    {trim(p.ppAmort)}-year amortization, so the closest valid
                    target is shown instead.
                  </span></>
                )}
              </p>
            </>
          ) : (
            <>
              <div className="rvb-fields mt-3">
                <Field label="Extra payment" prefix="$" suffix="/mo" step={25}
                       value={raw.ppExtraMo} onChange={set("ppExtraMo")} />
                <Field label="Annual lump sum" prefix="$" step={500}
                       value={raw.ppAnnualLump} onChange={set("ppAnnualLump")}
                       hint="Applied once a year, on the loan's anniversary" />
                <Field label="One-time lump sum" prefix="$" step={1000}
                       value={raw.ppOneTime} onChange={set("ppOneTime")} />
                <Field label="In year" step={1}
                       value={raw.ppOneTimeYear} onChange={set("ppOneTimeYear")} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={!!raw.ppBiweekly}
                       onChange={(e) => set("ppBiweekly")(e.target.checked)}
                       style={{ accentColor: C.buy, width: 14, height: 14 }} />
                <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                  Accelerated bi-weekly (one extra monthly payment a year)
                </span>
              </label>
              {p.ppBiweekly && (
                <p style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 8, lineHeight: 1.5 }}>
                  Modelled as that extra payment spread evenly across the
                  months; a true 26-payment schedule pays off one to three
                  months sooner than shown, so this is the conservative figure.
                </p>
              )}
              {pp.oneTimeDropped && (
                <p style={{ fontFamily: SANS, fontSize: 10.5, color: C.signal, marginTop: 8, lineHeight: 1.5 }}>
                  That lump lands after the mortgage would already be paid
                  off, so it isn't applied.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* ---- what the money would otherwise have done ---- */}
      <Panel className="mb-5">
        <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>Opportunity cost</h2>
        <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14, maxWidth: 860, lineHeight: 1.5 }}>
          The hurdle above turns on this rate more than anything else on the
          page. It's shared with the other tabs — change it here and every
          answer that depends on it moves too.
        </p>
        <div className="rvb-fields">
          <Field label="Expected return" suffix="%/yr" step={0.5}
                 value={raw.investPct} onChange={set("investPct")}
                 tip="What the extra payments would have earned in the market instead." />
          <Field label="Fees and tax drag" suffix="%/yr" step={0.1}
                 value={raw.feeDragPct} onChange={set("feeDragPct")}
                 hint={"Net " + trim(Math.max(0, p.investPct - p.feeDragPct)) + "%/yr after fees"} />
          <Field label="Tax on investment gains" suffix="%" step={1}
                 value={raw.capGainsPct} onChange={set("capGainsPct")}
                 tip={us
                   ? "Charged on the growth when the investments are sold at the end. Set it to 0 if the money would sit in a Roth."
                   : "Charged on the growth when the investments are sold at the end. Set it to 0 if the money would sit in a TFSA."} />
          <Field label="Your marginal tax rate" suffix="%" step={1}
                 value={raw.marginalTaxPct} onChange={set("marginalTaxPct")}
                 tip="The rate on the next dollar you earn." />
        </div>

        {R.itemizes && (
          <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={!!raw.ppDeduct}
                   onChange={(e) => set("ppDeduct")(e.target.checked)}
                   style={{ accentColor: C.buy, width: 14, height: 14 }} />
            <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
              I itemize, and my other deductions already exceed the standard
              deduction — credit the mortgage-interest deduction to the side
              that's paying more interest
            </span>
          </label>
        )}

        <div style={{ marginTop: 16, borderTop: "1px solid " + C.line, paddingTop: 12 }}>
          <Eyebrow>What counts as opportunity cost here</Eyebrow>
          <div className="mt-2">
            <Row label="If you prepay: portfolio from the freed-up payment, once the mortgage is gone"
                 value={noLoan ? "—" : usd(pp.prepayNet)}
                 tip="Every extra dollar goes to the lender until payoff, then the entire former payment goes to the market for whatever's left of the term." />
            <Row label="If you invest instead: portfolio from the extras, from month one"
                 value={noLoan ? "—" : usd(pp.investNet)}
                 tip="The mortgage runs its full original course; the extra dollars go to the market immediately instead." />
            <Row label="Difference at the end of the original amortization" strong
                 value={noLoan ? "—" : usd(pp.advantage)}
                 tone={noLoan ? undefined : ahead ? C.buy : C.rent} />
          </div>
          {pp.itemizing && (
            <p style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 10, lineHeight: 1.5 }}>
              Prepaying also forfeits some of the mortgage-interest deduction —{" "}
              {usd(Math.max(0, pp.refundForfeited))} of it, credited back to
              whichever side paid the interest.
            </p>
          )}
        </div>
      </Panel>

      {/* ---- renewal exposure, Canada only ---- */}
      {pp.renews && pp.renewals.length > 0 && (
        <Panel className="mb-5">
          <h2 style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 2 }}>Renewal exposure</h2>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12, maxWidth: 860, lineHeight: 1.5 }}>
            Every {trim(p.ppTermYears)} years the rate resets and the payment
            is recalculated on whatever's left. A smaller balance means a
            smaller jump — but your lender will offer the lower payment a
            smaller balance qualifies for; you have to keep paying the fuller
            amount for the surplus to keep prepaying the mortgage.
          </p>
          {pp.renewals.map((rn, idx) => (
            <div key={idx} className="flex items-baseline justify-between"
                 style={{ padding: "6px 0", borderBottom: idx === pp.renewals.length - 1 ? "none" : "1px dotted " + C.line, gap: 10 }}>
              <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>Year {trim(rn.year)}</span>
              <span style={{ fontFamily: MONO, fontSize: 12 }}>
                <span style={{ color: C.rent }}>invest {usd(rn.investPmt)}/mo</span>
                <span style={{ color: C.mute }}> (bal {usd(rn.investBalance)})  ·  </span>
                <span style={{ color: C.buy }}>prepay {usd(rn.prepayPmt)}/mo</span>
                <span style={{ color: C.mute }}> (bal {usd(rn.prepayBalance)})</span>
              </span>
            </div>
          ))}
        </Panel>
      )}

      {/* ---- prepayment privilege warning, Canada only ---- */}
      {pp.hasPrivilege && pp.privilege && pp.privilege.breached && (
        <div className="mb-5" style={{
          background: C.rentWash, border: "1px solid " + C.line, borderRadius: 4,
          padding: "12px 16px", fontFamily: SANS, fontSize: 11.5, color: C.rent, lineHeight: 1.5,
        }}>
          In year {pp.privilege.worstYear} your extra payments reach{" "}
          {trim(pp.privilege.worstYearPct)}% of the original principal — over
          most lenders' {trim(p.ppPrivilegePct)}% annual prepayment privilege.
          The excess may draw an IRD or three-months'-interest charge, unless
          it lands on a renewal month, when any amount is penalty-free.
        </div>
      )}

      {/* ---- chart ---- */}
      {!noLoan && (
        <Panel>
          <div className="flex items-baseline justify-between mb-1">
            <h2 style={{ fontFamily: SERIF, fontSize: 21 }}>Net position over time</h2>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2">
                <span style={{ width: 14, height: 3, background: C.buy, display: "inline-block" }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.buy }}>Prepay</span>
              </span>
              <span className="flex items-center gap-2">
                <span style={{ width: 14, height: 3, background: C.rent, display: "inline-block" }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.rent }}>Invest instead</span>
              </span>
            </div>
          </div>
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 10 }}>
            After-tax portfolio value minus whatever's still owed, at every
            point along the way.
          </p>
          <div className="rvb-chart">
            <ResponsiveContainer>
              <ComposedChart data={pp.series} margin={{ top: 18, right: 10, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis
                  dataKey="t" type="number" domain={[0, pp.amortMonths / 12]}
                  tickFormatter={(v) => (v === 0 ? "now" : "yr " + v)}
                  tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                  stroke={C.line}
                />
                <YAxis
                  tickFormatter={compact}
                  tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                  stroke={C.line} width={58}
                />
                <Tooltip
                  cursor={{ stroke: C.mute, strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    const lead = d.prepay - d.invest;
                    return (
                      <div style={{
                        background: C.field, border: "1px solid " + C.line,
                        borderRadius: 3, padding: "8px 10px", fontFamily: MONO, fontSize: 12,
                      }}>
                        <div style={{ color: C.mute, fontSize: 10.5, marginBottom: 4 }}>
                          {d.t === 0 ? "Today" : "Year " + d.t.toFixed(1)}
                        </div>
                        <div style={{ color: C.buy }}>Prepay · {usd(d.prepay)}</div>
                        <div style={{ color: C.rent }}>Invest · {usd(d.invest)}</div>
                        <div style={{ color: C.ink, marginTop: 4, borderTop: "1px solid " + C.line, paddingTop: 4 }}>
                          {lead >= 0 ? "Prepay" : "Invest"} ahead {usd(Math.abs(lead))}
                        </div>
                      </div>
                    );
                  }}
                />
                {pp.payoffMonth < pp.amortMonths && (
                  <ReferenceLine
                    x={pp.payoffMonth / 12} stroke={C.signal} strokeWidth={2}
                    label={{ value: "paid off", position: "top", offset: 6,
                             fontFamily: MONO, fontSize: 10, fill: C.signal }}
                  />
                )}
                {pp.crossover !== null && pp.crossover > 0 && (
                  <ReferenceLine
                    x={pp.crossover} stroke={C.mute} strokeDasharray="3 3"
                    label={{ value: "invest overtakes", position: "top", offset: 6,
                             fontFamily: MONO, fontSize: 10, fill: C.mute }}
                  />
                )}
                <Line dataKey="prepay" stroke={C.buy} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="invest" stroke={C.rent} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */
const DEFAULTS = {
  // British Columbia, July 2026
  us: false,               // region: false = Canada. Absence means Canada, forever.
  // US-only. Inert in Canada, never repurposed.
  usIncome: 180000,
  usStateTaxPct: 5,
  usStdDed: 15000,         // single filer; doubled when `couple`
  pmiPct: 0.55,
  usClosingPct: 1.0,
  homePrice: 1450000,
  downPct: 20,
  apprPct: 3,
  firstTime: false,
  legalFees: 2500,
  rate: 4.24,
  renewalRate: 4.24,
  termYears: 5,
  amortYears: 25,
  sellCostPct: 3,
  propTaxPct: 0.36,
  hog: true,
  insYr: 2400,
  maintYr: 6000,
  remodelCost: 0,
  remodelYears: 2,
  remodelRecoveryPct: 50,
  utilYr: 1400,
  strataMo: 0,
  rentMo: 3200,
  rentGrowthPct: 2.5,
  marketRentGrowthPct: 3.5,
  moveEveryYears: 5,
  moveCost: 2000,
  rentInsMo: 20,
  suiteRentMo: 1900,
  suiteGrowthPct: 3.5,
  suiteVacancyPct: 5,
  suiteSharePct: 35,
  marginalTaxPct: 40,
  fhsaUse: 40000,
  hbpUse: 60000,
  taxableUse: 100000,
  cashSavings: 0,
  autoBrokerage: true,
  taxableGainPct: 40,
  hbpRepay: true,
  couple: false,
  investPct: 7,
  feeDragPct: 0.5,
  capGainsPct: 20,
  inflPct: 2.5,
  horizonYears: 10,
  // Appreciation tool
  apprThen: 850000,
  apprThenYear: 2016,
  apprNow: 1450000,
  apprNowYear: 2026,
  apprUseSpan: false,
  apprSpan: 10,
  // Payment comparison
  cmpLoanMode: false,
  cmpRate: 4.24,
  cmpAmort: 25,
  cmpDownPct: 20,
  cmpFirstTime: false,
  cmpA1: 1200000,
  cmpA2: 1350000,
  cmpA3: 1450000,
  cmpA4: 1600000,
  cmpA5: "",
  // Two-property comparison. Defaults sketch the usual trade-off: a dearer
  // detached place with a suite, against a cheaper one carrying strata that
  // needs work done to it.
  cpCash: 500000,
  cpRemodelLOC: false,
  cpLOCRate: 6.5,
  cpAPrice: 1450000, cpADown: 20, cpAAppr: 3, cpAPropTax: 0.36,
  cpAMaint: 6000, cpAStrata: 0, cpASuite: 1900,
  cpARemodel: 0, cpARemodelYears: 2, cpARemodelRec: 50,
  cpBPrice: 1250000, cpBDown: 20, cpBAppr: 3, cpBPropTax: 0.36,
  cpBMaint: 4000, cpBStrata: 350, cpBSuite: 0,
  cpBRemodel: 60000, cpBRemodelYears: 1, cpBRemodelRec: 50,
  // Investment property. A duplex in the Lower Mainland, on an investor rate.
  ivPrice: 1100000, ivDownPct: 25, ivRate: 5.25, ivAmort: 30, ivApprPct: 3,
  ivUnitCount: 2, ivSameRent: false,
  ivU1: 2400, ivU2: 1900, ivU3: 1800, ivU4: 1800, ivU5: 1800, ivU6: 1800,
  ivVacancyPct: 4, ivRentGrowthPct: 3,
  ivPropTaxPct: 0.36, ivInsYr: 2600, ivHoaMo: 0, ivUtilYr: 1400, ivOtherYr: 600,
  ivMaintPct: 8, ivCapexPct: 5, ivMgmtPct: 8,
  ivInitialCapex: 0, ivBuildingPct: 60, ivCCA: false,
  // Prepayment. Mirrors the buy tab's own loan (1450000 at 80%) so the two
  // tabs agree by default; "Use my rent-vs-buy conditions" overwrites it.
  ppLoan: 1160000, ppRate: 4.24, ppAmort: 25, ppTermYears: 5, ppRenewalRate: 4.24,
  ppMode: false, ppTargetAmort: 15,
  ppExtraMo: 500, ppAnnualLump: 0, ppAnnivMonth: 12,
  ppOneTime: 0, ppOneTimeYear: 3, ppBiweekly: false,
  ppDeduct: false, ppPrivilegePct: 20,
};


const KEYS = {
  us: "us", usIncome: "ui", usStateTaxPct: "ux", usStdDed: "ud",
  pmiPct: "um", usClosingPct: "uc",
  homePrice: "p", downPct: "d", apprPct: "a", firstTime: "ft", legalFees: "lf",
  rate: "r", renewalRate: "rr", termYears: "tm", amortYears: "am", sellCostPct: "sc",
  propTaxPct: "pt", hog: "hg", insYr: "ins", maintYr: "mt", utilYr: "ut", strataMo: "st",
  remodelCost: "rc", remodelYears: "ry", remodelRecoveryPct: "rv",
  rentMo: "rm", rentGrowthPct: "rg", marketRentGrowthPct: "mg", moveEveryYears: "mv",
  moveCost: "mc", rentInsMo: "ri", suiteRentMo: "sr", suiteGrowthPct: "sg",
  suiteVacancyPct: "sv", suiteSharePct: "ss", marginalTaxPct: "mx",
  fhsaUse: "fh", hbpUse: "hb", taxableUse: "tx", taxableGainPct: "tg",
  cashSavings: "cs", autoBrokerage: "ab",
  hbpRepay: "hr", couple: "cp",
  investPct: "iv", capGainsPct: "cg", feeDragPct: "fd", inflPct: "if",
  horizonYears: "h",
  apprThen: "at", apprThenYear: "aty", apprNow: "an", apprNowYear: "any",
  apprUseSpan: "aus", apprSpan: "asp",
  cmpLoanMode: "cl", cmpRate: "cr", cmpAmort: "cq", cmpDownPct: "cw",
  cmpFirstTime: "cf",
  cmpA1: "c1", cmpA2: "c2", cmpA3: "c3", cmpA4: "c4", cmpA5: "c5",
  // Digit-first codes: every code above is alpha-led, so these cannot collide.
  cpCash: "0h", cpRemodelLOC: "0l", cpLOCRate: "0c",
  cpAPrice: "1p", cpADown: "1d", cpAAppr: "1a", cpAPropTax: "1t",
  cpAMaint: "1m", cpAStrata: "1s", cpASuite: "1u",
  cpARemodel: "1r", cpARemodelYears: "1y", cpARemodelRec: "1v",
  cpBPrice: "2p", cpBDown: "2d", cpBAppr: "2a", cpBPropTax: "2t",
  cpBMaint: "2m", cpBStrata: "2s", cpBSuite: "2u",
  cpBRemodel: "2r", cpBRemodelYears: "2y", cpBRemodelRec: "2v",
  // Investment tab. `3*` is free: 0/1/2 belong to the compare tab.
  ivPrice: "3p", ivDownPct: "3d", ivRate: "3r", ivAmort: "3q", ivApprPct: "3a",
  ivUnitCount: "3n", ivSameRent: "3e",
  ivU1: "31", ivU2: "32", ivU3: "33", ivU4: "34", ivU5: "35", ivU6: "36",
  ivVacancyPct: "3v", ivRentGrowthPct: "3g", ivPropTaxPct: "3t", ivInsYr: "3i",
  ivMaintPct: "3m", ivCapexPct: "3x", ivMgmtPct: "3w", ivHoaMo: "3h",
  ivUtilYr: "3l", ivOtherYr: "3o", ivInitialCapex: "3c", ivBuildingPct: "3b",
  ivCCA: "3y",
  // Prepayment tab. `4*` is free: 0/1/2/3 belong to the earlier tabs.
  ppLoan: "4l", ppRate: "4r", ppAmort: "4q", ppTermYears: "4t", ppRenewalRate: "4w",
  ppMode: "4o", ppTargetAmort: "4g",
  ppExtraMo: "4e", ppAnnualLump: "4n", ppAnnivMonth: "4v",
  ppOneTime: "41", ppOneTimeYear: "42", ppBiweekly: "4b",
  ppDeduct: "4d", ppPrivilegePct: "4p",
};
const CODE_TO_KEY = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [v, k]));

// Static data, so this either always passes or always throws — a duplicated
// URL code would silently make one field overwrite another in every shared
// link, which is exactly the kind of bug that never shows up on screen.
{
  const codes = Object.values(KEYS);
  if (new Set(codes).size !== codes.length) {
    const seen = new Set(), dupes = [];
    for (const c of codes) { if (seen.has(c)) dupes.push(c); seen.add(c); }
    throw new Error("duplicate URL codes in KEYS: " + dupes.join(", "));
  }
  const missing = Object.keys(KEYS).filter((k) => !(k in DEFAULTS));
  const unserialised = Object.keys(DEFAULTS).filter((k) => !(k in KEYS));
  if (missing.length) throw new Error("KEYS without DEFAULTS: " + missing.join(", "));
  if (unserialised.length) throw new Error("DEFAULTS not in KEYS: " + unserialised.join(", "));
}

function stateToHash(raw) {
  const q = new URLSearchParams();
  for (const key in KEYS) {
    const v = raw[key];
    const d = DEFAULTS[key];
    if (typeof d === "boolean") {
      if (Boolean(v) !== d) q.set(KEYS[key], v ? "1" : "0");
    } else if (String(v) !== String(d)) {
      q.set(KEYS[key], String(v));
    }
  }
  const s = q.toString();
  return s ? "#" + s : "";
}

const ROUTES = routesData.routes;

// Tabs, their labels and their URLs all come from routes.json, which
// build.sh reads too — so the static HTML it emits for each route and the
// routing here can never disagree about what paths exist.
const TABS = ROUTES.map((r) => [r.id, r.label]);
const TAB_IDS = ROUTES.map((r) => r.id);
const ROUTE_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r]));

// Trailing slash optional, so /prepayment and /prepayment/ are the same tab
// rather than one of them silently falling back to the rent-vs-buy page.
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
function routeFromPath() {
  if (typeof window === "undefined") return ROUTES[0];
  const p = norm(window.location.pathname);
  return ROUTES.find((r) => norm(r.path) === p) || null;
}
function tabFromPath() {
  const hit = routeFromPath();
  return hit ? hit.id : "buy";
}
// Cloudflare already answered an unknown path with 404.html and a real 404
// status. This is so the page the visitor actually sees agrees with it,
// instead of silently rendering the rent-vs-buy tab under a 404.
function pathIsUnknown() {
  return routeFromPath() === null && !legacyTabRedirect();
}

// Tabs used to live in the hash as `tab=<id>`. Those links are out in the
// world and must keep working, so translate one to its path on arrival and
// hand the rest of the hash — the actual inputs — straight through.
function legacyTabRedirect() {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/(?:^#|&)tab=([a-z]+)/);
  if (!m || !TAB_IDS.includes(m[1])) return null;
  const rest = window.location.hash
    .replace(/^#/, "")
    .split("&")
    .filter((s) => s && !/^tab=/.test(s))
    .join("&");
  return { id: m[1], path: ROUTE_BY_ID[m[1]].path + (rest ? "#" + rest : "") };
}

function hashToState() {
  if (typeof window === "undefined") return {};
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return {};
  const out = {};
  try {
    for (const [code, val] of new URLSearchParams(h)) {
      const key = CODE_TO_KEY[code];
      if (!key) continue;
      out[key] = typeof DEFAULTS[key] === "boolean" ? val === "1" : val;
    }
  } catch (e) {
    return {};
  }
  return out;
}

export default function RentVsBuy() {
  const [raw, setRaw] = useState(() => ({ ...DEFAULTS, ...hashToState() }));
  // Declared before the URL-mirror effect below: its dependency array reads
  // `tab` inline during render, so a later declaration is a TDZ crash.
  const [tab, setTab] = useState(tabFromPath);
  const [notFound, setNotFound] = useState(pathIsUnknown);
  const [copied, setCopied] = useState(false);
  // Deliberately not in the URL: an undo offer is a property of this session,
  // not of the scenario being shared.
  const [undo, setUndo] = useState(null);

  /* Applied during render, before any child reads C. Idempotent, so a
   * double render costs nothing. */
  const [theme, setTheme] = useState(readTheme);
  applyPalette(theme);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    writeTheme(next);
    setTheme(next);
  };

  /* Switching country resets every figure to that country's defaults: a
   * $1.45M Vancouver price and a 4.24% Canadian rate are not a sane
   * starting point for a US answer, and half-converted inputs are worse
   * than either. Only the horizon and the household carry over, because
   * those are facts about the person rather than the market. The undo
   * makes the reset safe to try. */
  const switchRegion = (toUS) => {
    if (toUS === Boolean(raw.us)) return;
    setUndo({ raw, to: REGIONS[toUS ? "us" : "ca"].label });
    setRaw((s) => ({
      ...DEFAULTS,
      ...(toUS ? REGIONS.us.defaults : {}),
      us: toUS,
      horizonYears: s.horizonYears,
      couple: s.couple,
    }));
  };
  // Long enough to notice and act on, gone before it becomes furniture.
  // Deliberately not cleared by typing: someone who changes one number and
  // then realises still wants the way back.
  React.useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 14000);
    return () => clearTimeout(id);
  }, [undo]);

  // Mirror the inputs into the address bar so any view is a shareable
  // link. The tab now lives in the path rather than the hash, because a
  // fragment is invisible to search engines — each tab is a real URL with
  // its own static HTML file, and this keeps the bar in step with it.
  React.useEffect(() => {
    // Leave an unknown URL alone — rewriting it to "/" would erase the
    // evidence that the visitor asked for something that does not exist.
    if (notFound) return;
    const id = setTimeout(() => {
      const st = stateToHash(raw);
      const next = ROUTE_BY_ID[tab].path + window.location.search + st;
      window.history.replaceState(null, "", next);
    }, 250);
    return () => clearTimeout(id);
  }, [raw, tab, notFound]);

  // Back/forward, and someone pasting a link into the open tab. popstate
  // covers path moves; hashchange covers input-only edits, which do not
  // fire popstate.
  React.useEffect(() => {
    const sync = () => {
      setRaw({ ...DEFAULTS, ...hashToState() });
      // An old `#tab=` link followed from inside the site is a same-document
      // navigation: it fires hashchange and nothing remounts, so the tab has
      // to be recovered here as well as on first load. Without this the path
      // still says "/" and the visitor lands on the wrong tab.
      const legacy = legacyTabRedirect();
      if (legacy) {
        setNotFound(false);
        setTab(legacy.id);
        window.history.replaceState(null, "", legacy.path);
        return;
      }
      setNotFound(pathIsUnknown());
      setTab(tabFromPath());
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  // The same rewrite for a cold load on an old link.
  React.useEffect(() => {
    const legacy = legacyTabRedirect();
    if (!legacy) return;
    setNotFound(false);
    setTab(legacy.id);
    window.history.replaceState(null, "", legacy.path);
  }, []);

  const copyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const [showLedger, setShowLedger] = useState(false);

  const p = useMemo(() => {
    const o = {};
    for (const k in raw) o[k] = typeof raw[k] === "boolean" ? raw[k] : num(raw[k]);
    return o;
  }, [raw]);

  const set = (k) => (v) => setRaw((s) => ({ ...s, [k]: v }));
  // Which country's copy the page is written in. The model reads `p.us`;
  // this is only ever used for words on screen.
  const US = !!p.us;

  /* Every memo below is gated on the open tab. The buy tab alone runs
   * simulate() 26 times per keystroke (once, plus 25 for the sensitivity
   * strips); without the gate every other tab paid for those too. Each
   * result is read only inside its own tab's branch, so the nulls are
   * never dereferenced. */
  const r = useMemo(() => simulate(p), [p]);
  const cmpRows = useMemo(
    () => (tab === "payments" ? comparePayments(p) : null), [p, tab]);
  const cmp = useMemo(() => {
    if (tab !== "compare") return null;
    const pa = compareProps(p, "A"), pb = compareProps(p, "B");
    return { a: simulate(pa), b: simulate(pb), pa, pb };
  }, [p, tab]);
  const iv = useMemo(
    () => (tab === "invest" ? simulateRental(p) : null), [p, tab]);
  const pp = useMemo(
    () => (tab === "prepay" ? simulatePrepay(p) : null), [p, tab]);

  // Appreciation tool
  const appr = useMemo(() => {
    if (tab !== "appreciation") return null;
    const then = p.apprThen;
    const now = p.apprNow;
    const years = p.apprUseSpan ? p.apprSpan : p.apprNowYear - p.apprThenYear;
    const valid = then > 0 && now > 0 && years > 0;
    const cagr = valid ? (Math.pow(now / then, 1 / years) - 1) * 100 : null;
    const totalPct = then > 0 ? (now / then - 1) * 100 : null;
    const doubling = cagr && cagr > 0 ? Math.log(2) / Math.log(1 + cagr / 100) : null;
    const curve = [];
    if (valid) {
      const span = Math.ceil(years);
      for (let k = 0; k <= span + 10; k++) {
        curve.push({
          k,
          label: p.apprUseSpan ? k : p.apprThenYear + k,
          value: then * Math.pow(now / then, k / years),
          projected: k > years,
        });
      }
    }
    return { then, now, years, valid, cagr, totalPct, doubling, curve };
  }, [p, tab]);

  const sens = useMemo(() => {
    if (tab !== "buy") return null;
    const appr = [-2, -1, 0, 1, 2].map((d) => ({
      d,
      cur: d === 0,
      label: trim(p.apprPct + d) + "%",
      v: simulate({ ...p, apprPct: p.apprPct + d }).advantage,
    }));
    const inv = [-2, -1, 0, 1, 2].map((d) => ({
      d,
      cur: d === 0,
      label: trim(p.investPct + d) + "%",
      v: simulate({ ...p, investPct: p.investPct + d }).advantage,
    }));
    const renew = [-1, 0, 1, 2, 3].map((d) => ({
      d,
      cur: d === 0,
      label: trim(Math.max(0, p.renewalRate + d)) + "%",
      v: simulate({ ...p, renewalRate: Math.max(0, p.renewalRate + d) }).advantage,
    }));
    // Slide the window so it never runs below zero or repeats a column
    const step = 400;
    const start = Math.max(0, Math.round((p.suiteRentMo - 2 * step) / step) * step);
    const suite = [0, 1, 2, 3, 4].map((k) => {
      const at = start + k * step;
      return {
        d: k,
        cur: Math.abs(at - p.suiteRentMo) < step / 2,
        label: "$" + at,
        v: simulate({ ...p, suiteRentMo: at }).advantage,
      };
    });
    // How much the answer leans on registered money
    const reg = [0, 0.25, 0.5, 0.75, 1].map((k, idx) => {
      const total = p.fhsaUse + p.hbpUse;
      const shifted = total * k;
      const fh = Math.min(shifted, p.fhsaUse);
      const hb = shifted - fh;
      return {
        d: idx,
        cur: Math.abs(k - 1) < 0.01,
        label: Math.round(k * 100) + "%",
        v: simulate({
          ...p,
          fhsaUse: fh,
          hbpUse: hb,
          taxableUse: p.taxableUse + (total - shifted),
        }).advantage,
      };
    });
    return { appr, inv, renew, suite, reg };
  }, [p, tab]);

  const buyWins = r.advantage >= 0;
  const winner = buyWins ? "Buying" : "Renting";
  const scale = Math.max(Math.abs(r.finalBuy), Math.abs(r.finalRent), 1);
  const tooClose = Math.abs(r.advantage) / scale < 0.02;
  const winColor = tooClose ? C.signal : buyWins ? C.buy : C.rent;

  // Shift the chart so stacked areas never sit below zero.
  const minVal = Math.min(...r.series.map((d) => Math.min(d.buy, d.rent)));
  const OFF = Math.max(0, -minVal) + 1;
  const chartData = r.series.map((d) => ({
    t: d.t,
    buy: d.buy,
    rent: d.rent,
    buyP: d.buy + OFF,
    rentP: d.rent + OFF,
    base: Math.min(d.buy, d.rent) + OFF,
    gapBuy: Math.max(0, d.buy - d.rent),
    gapRent: Math.max(0, d.rent - d.buy),
  }));
  const maxP = Math.max(...chartData.map((d) => Math.max(d.buyP, d.rentP)));
  const minP = Math.min(...chartData.map((d) => Math.min(d.buyP, d.rentP)));
  const pad = (maxP - minP) * 0.08 + 1;
  const tickStep = p.horizonYears <= 12 ? 2 : p.horizonYears <= 25 ? 5 : 10;
  const xTicks = [];
  for (let y = 0; y <= p.horizonYears; y += tickStep) xTicks.push(y);

  const y1 = r.y1Buy || { pi: 0, propTax: 0, maint: 0, ins: 0, util: 0, strata: 0, remodel: 0, gross: 0, suite: 0, total: 0 };
  const y1r = r.y1Rent || { rent: 0, ins: 0, total: 0 };
  const barMax = Math.max(y1.gross, y1r.total) || 1;
  const costParts = [
    ["Principal & interest", y1.pi],
    ["Property tax", y1.propTax],
    ["Maintenance", y1.maint],
    ["Insurance", y1.ins],
    ["City utilities", y1.util],
    ["Strata fee", y1.strata],
    ["Remodelling", y1.remodel],
  ].filter((x) => x[1] > 0.5);

  const beText =
    r.breakeven === null
      ? "not within " + p.horizonYears + " years"
      : r.breakeven === 0
      ? "immediately"
      : "year " +
        Math.floor(r.breakeven) +
        ", month " +
        (Math.round(r.breakeven * 12) % 12 === 0
          ? 12
          : Math.round(r.breakeven * 12) % 12);

  const css = `
    .rvb input:focus-visible, .rvb button:focus-visible { outline: 2px solid ${C.signal}; outline-offset: 1px; }
    .rvb input[type=number]::-webkit-outer-spin-button,
    .rvb input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .rvb input[type=number] { -moz-appearance: textfield; }
    .rvb table { border-collapse: collapse; }
    @media (prefers-reduced-motion: reduce) { .rvb * { transition: none !important; } }

    /* Shell: widen as the screen does, instead of stranding it at 1180px */
    .rvb-shell { max-width: 1180px; margin-left: auto; margin-right: auto; }
    @media (min-width: 1360px) { .rvb-shell { max-width: 1300px; } }
    @media (min-width: 1500px) { .rvb-shell { max-width: 1400px; } }
    @media (min-width: 1700px) { .rvb-shell { max-width: 1580px; } }
    @media (min-width: 1900px) { .rvb-shell { max-width: 1720px; } }
    @media (min-width: 2200px) { .rvb-shell { max-width: 1900px; } }

    /* Inputs beside results */
    .rvb-main { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 1024px) { .rvb-main { grid-template-columns: 340px minmax(0, 1fr); } }
    @media (min-width: 1500px) { .rvb-main { grid-template-columns: 372px minmax(0, 1fr); } }
    @media (min-width: 1900px) { .rvb-main { grid-template-columns: 400px minmax(0, 1fr); } }
    .rvb-col { min-width: 0; }

    /* Cards that pair up once there is room for them */
    .rvb-pair { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 860px) { .rvb-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .rvb-pair-wide { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 1500px) { .rvb-pair-wide { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

    /* Rental units: as many across as fit, rather than two very wide ones */
    .rvb-units { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (min-width: 700px) { .rvb-units { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (min-width: 1100px) { .rvb-units { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

    /* Metric strip: four across when there is room, two up otherwise */
    .rvb-metrics { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (min-width: 1100px) { .rvb-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

    /* Side-by-side comparison; the difference column is the first to go */
    .rvb-cmp { display: grid; grid-template-columns: 1fr auto auto auto; column-gap: 16px; }
    @media (max-width: 760px) {
      .rvb-cmp { grid-template-columns: 1fr auto auto; }
      .rvb-cmp .cmp-d { display: none; }
    }

    /* Tablet: the inputs span the full width, so fit more fields per row */
    .rvb-fields { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (min-width: 640px) and (max-width: 1023px) {
      .rvb-fields { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    /* Ledger: drop the secondary columns rather than force a sideways scroll */
    @media (max-width: 700px) { .rvb-hide-sm { display: none; } }

    /* A wider chart deserves to be taller too */
    .rvb-chart { width: 100%; height: 300px; }
    @media (min-width: 1400px) { .rvb-chart { height: 360px; } }
    @media (min-width: 1900px) { .rvb-chart { height: 400px; } }
  `;

  return (
    <div
      className="rvb w-full"
      style={{ background: C.bg, color: C.ink, fontFamily: SANS, minHeight: "100%" }}
    >
      <style>{css}</style>

      <div className="rvb-shell px-5 py-8">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 mb-5" style={{ borderBottom: "1px solid " + C.line }}>
          {/* Real anchors with real hrefs, not buttons: this is the only
              internal linking on the site, so a crawler needs to be able
              to walk it to reach the other five pages. Clicks are still
              handled in-app — the href is what search engines and
              middle-click follow. */}
          {TABS.map(([id, label]) => (
            <a
              key={id}
              href={ROUTE_BY_ID[id].path}
              aria-current={tab === id ? "page" : undefined}
              onClick={(e) => {
                // Let the browser handle anything that means "open elsewhere"
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
                e.preventDefault();
                if (id === tab && !notFound) return;
                setNotFound(false);
                setTab(id);
                window.history.pushState(null, "", ROUTE_BY_ID[id].path + stateToHash(raw));
              }}
              style={{
                fontFamily: SANS,
                fontSize: 13.5,
                fontWeight: tab === id ? 600 : 400,
                color: tab === id ? C.ink : C.mute,
                textDecoration: "none",
                background: "transparent",
                border: "none",
                borderBottom: "2px solid " + (tab === id ? C.buy : "transparent"),
                padding: "8px 12px",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              {label}
            </a>
          ))}

          {/* Which country's rules the whole page runs on */}
          <div style={{ marginLeft: "auto", marginBottom: 6, marginRight: 10 }}>
            <Segmented
              options={[[false, "Canada"], [true, "United States"]]}
              value={!!raw.us}
              onChange={switchRegion}
            />
          </div>

          {/* the same switch that sits on the two sheets */}
          <Button
            type="button"
            role="switch"
            aria-checked={theme === "light"}
            aria-label={theme === "light"
              ? "Switch to the dark sheet" : "Switch to the light sheet"}
            onClick={toggleTheme}
            style={{
              marginBottom: 6,
              display: "flex", alignItems: "center",
              width: 48, height: 24, padding: 2,
              border: "1px solid " + C.line, borderRadius: 999,
              background: C.panel, cursor: "pointer",
              transition: "background-color .3s ease, border-color .2s ease",
            }}
          >
            <span
              style={{
                display: "grid", placeItems: "center",
                width: 18, height: 18, borderRadius: "50%",
                background: C.buy, color: C.panel,
                fontSize: 10, lineHeight: 1,
                transform: theme === "light" ? "translateX(24px)" : "translateX(0)",
                transition: "transform .3s cubic-bezier(.4,0,.2,1)",
              }}
            >
              {theme === "light" ? "☀" : "☾"}
            </span>
          </Button>
        </div>

        {undo && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 mb-5"
            style={{
              background: C.panelAlt, border: "1px solid " + C.line,
              borderRadius: 4, padding: "10px 14px",
            }}
          >
            <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink }}>
              Switched to <b style={{ fontWeight: 600 }}>{undo.to}</b>. Every tab
              was reset to {undo.to === "United States" ? "US" : "Canadian"}{" "}
              defaults; your time period and household carried over.
            </span>
            <Button
              type="button"
              onClick={() => { setRaw(undo.raw); setUndo(null); }}
              style={{
                fontFamily: MONO, fontSize: 11, color: C.buy,
                background: "transparent", border: "1px solid " + C.buy,
                borderRadius: 3, padding: "4px 9px", cursor: "pointer",
              }}
            >
              Undo
            </Button>
            <Button
              type="button"
              aria-label="Dismiss"
              onClick={() => setUndo(null)}
              style={{
                marginLeft: "auto", fontFamily: MONO, fontSize: 13, color: C.mute,
                background: "transparent", border: "none", cursor: "pointer",
                lineHeight: 1, padding: 2,
              }}
            >
              ✕
            </Button>
          </div>
        )}

        {notFound ? (
          <Panel>
            <Eyebrow as="h1">Page not found</Eyebrow>
            <p style={{ fontFamily: SERIF, fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, marginTop: 10 }}>
              That page doesn't exist.
            </p>
            <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.mute, marginTop: 12, maxWidth: 640, lineHeight: 1.5 }}>
              Nothing lives at <code style={{ fontFamily: MONO }}>{window.location.pathname}</code>.
              Pick a calculator from the tabs above, or start with the{" "}
              <a
                href="/"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
                  e.preventDefault();
                  setNotFound(false);
                  setTab("buy");
                  window.history.pushState(null, "", "/");
                }}
                style={{ color: C.buy }}
              >
                rent vs. buy calculator
              </a>.
            </p>
          </Panel>
        ) : tab === "invest" ? (
          <InvestTab raw={raw} set={set} setRaw={setRaw} p={p} iv={iv} />
        ) : tab === "compare" ? (
          <CompareTab
            raw={raw}
            set={set}
            p={p}
            cmp={cmp}
            onLoadA={() => {
              setRaw((s) => ({
                ...s,
                cpAPrice: s.homePrice, cpADown: s.downPct, cpAAppr: s.apprPct,
                cpAPropTax: s.propTaxPct, cpAMaint: s.maintYr, cpAStrata: s.strataMo,
                cpASuite: s.suiteRentMo, cpARemodel: s.remodelCost,
                cpARemodelYears: s.remodelYears, cpARemodelRec: s.remodelRecoveryPct,
              }));
            }}
          />
        ) : tab === "payments" ? (
          <PaymentsTab
            raw={raw}
            set={set}
            p={p}
            rows={cmpRows}
            onCopyConditions={() => {
              setRaw((s) => ({
                ...s,
                cmpRate: s.rate,
                cmpAmort: s.amortYears,
                cmpDownPct: s.downPct,
                cmpFirstTime: s.firstTime,
              }));
            }}
          />
        ) : tab === "appreciation" ? (
          <AppreciationTab
            raw={raw}
            set={set}
            p={p}
            appr={appr}
            onApply={(v) => {
              set("apprPct")(v.toFixed(2));
              setTab("buy");
            }}
          />
        ) : tab === "prepay" ? (
          <PrepayTab
            raw={raw}
            set={set}
            p={p}
            pp={pp}
            onCopyConditions={() => {
              setRaw((s) => ({
                ...s,
                ppLoan: String(Math.round(r.loan)),
                ppRate: s.rate,
                ppAmort: s.amortYears,
                ppTermYears: s.termYears,
                ppRenewalRate: s.renewalRate,
              }));
            }}
          />
        ) : (
        <>
        {/* HERO — the verdict is the headline */}
        <header className="mb-7">
          <div className="flex items-center justify-between mb-4">
            <Eyebrow as="h1">
              Rent vs. Buy Calculator · {US ? "United States" : "British Columbia"} ·
              {" "}net worth after costs and taxes
            </Eyebrow>
            <div className="flex items-center gap-2">
            <Button
              onClick={copyLink}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: copied ? C.buy : C.ink,
                background: "transparent",
                border: "1px solid " + (copied ? C.buy : C.line),
                borderRadius: 3,
                padding: "4px 9px",
                cursor: "pointer",
              }}
            >
              {copied ? "Link copied" : "Copy link"}
            </Button>
            <Button
              onClick={() => {
                // Reset to the region you are in, not back to Canada
                const us = Boolean(raw.us);
                setRaw({ ...DEFAULTS, ...(us ? REGIONS.us.defaults : {}), us });
                window.history.replaceState(null, "", window.location.pathname);
              }}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: C.mute,
                background: "transparent",
                border: "1px solid " + C.line,
                borderRadius: 3,
                padding: "4px 9px",
                cursor: "pointer",
              }}
            >
              Reset
            </Button>
            </div>
          </div>
          {/* The verdict is the loudest thing on the page but it is not the
              page's heading — it is a computed figure that changes with every
              keystroke. The <h1> is the breadcrumb line above. */}
          <p
            style={{
              fontFamily: SERIF,
              fontWeight: 500,
              fontSize: "clamp(28px, 5vw, 52px)",
              lineHeight: 1.06,
              letterSpacing: "-0.02em",
              margin: 0,
              maxWidth: 1020,
            }}
          >
            {tooClose ? (
              <>
                Over {p.horizonYears} {p.horizonYears === 1 ? "year" : "years"} it's a
                coin flip — the two paths finish{" "}
                <span style={{ color: winColor, borderBottom: "3px solid " + winColor }}>
                  {usd(Math.abs(r.advantage))}
                </span>{" "}
                apart.
              </>
            ) : (
              <>
                {winner} leaves you{" "}
                <span style={{ color: winColor, borderBottom: "3px solid " + winColor }}>
                  {usd(Math.abs(r.advantage))}
                </span>{" "}
                richer after {p.horizonYears}{" "}
                {p.horizonYears === 1 ? "year" : "years"}.
              </>
            )}
          </p>
          <p
            style={{
              fontFamily: SANS,
              fontSize: 14,
              color: C.mute,
              maxWidth: 640,
              marginTop: 12,
              lineHeight: 1.5,
            }}
          >
            Both people spend the same money each month. Whoever pays less puts the
            difference into the market at {p.investPct}%, and the renter starts by
            investing the buyer's whole {usd(r.cashToClose)} of cash to close.
            {p.suiteRentMo > 0 && (
              <>
                {" "}
                The suite brings in{" "}
                <strong style={{ color: C.ink, fontWeight: 600 }}>{usd(y1.suite)}</strong> a
                month after vacancy and tax, straight off the cost of owning.
              </>
            )}{" "}
            Owning pulls ahead{" "}
            <strong style={{ color: C.ink, fontWeight: 600 }}>{beText}</strong>.
          </p>

          {/* The two levers that move the answer most */}
          <div
            className="mt-6"
            style={{
              background: C.panel,
              border: "1px solid " + C.line,
              borderRadius: 4,
              padding: "12px 16px",
            }}
          >
            <SliderRow
              label="How long you stay"
              value={p.horizonYears}
              onChange={set("horizonYears")}
              min={1}
              max={30}
              step={1}
              accent={winColor}
              suffix="yr"
            />
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + C.line }}>
              <SliderRow
                label={US ? "Rental income" : "Suite rent"}
                value={p.suiteRentMo}
                onChange={set("suiteRentMo")}
                min={0}
                max={3500}
                step={50}
                accent={C.buy}
                prefix="$"
                suffix="/mo"
                format="money"
              />
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 10.5,
                  color: C.mute,
                  marginTop: 5,
                  marginLeft: 130,
                }}
              >
                {p.suiteRentMo > 0
                  ? "Nets " + usd(y1.suite) + "/mo after vacancy and tax, covering " +
                    Math.round((y1.suite / Math.max(1, y1.gross)) * 100) + "% of the cost of owning."
                  : US
                  ? "Set to zero — nothing let out, so no rental income and no rental deductions."
                  : "Set to zero — no suite, so no rental income and no rental deductions."}
              </div>
            </div>
          </div>
        </header>

        <div className="rvb-main">
          {/* ---------------- INPUTS ---------------- */}
          <div className="rvb-col">
            <Panel>
              <h2
                style={{
                  fontFamily: SERIF,
                  fontSize: 19,
                  fontWeight: 600,
                  margin: 0,
                  marginBottom: 2,
                }}
              >
                Your numbers
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
                Everything updates as you type.
              </p>

              <Group title="The home">
                <Field label="Purchase price" prefix="$" step={25000} value={raw.homePrice} onChange={set("homePrice")} hint={"Mortgage " + usd(r.loan)} />
                <Field label="Down payment" suffix="%" step={1} value={raw.downPct} onChange={set("downPct")} hint={usd(r.down)} />
                <Field label="Appreciation" suffix="%/yr" step={0.25} value={raw.apprPct} onChange={set("apprPct")} hint={US ? "Long-run US average ≈ 3–4%" : "Detached is down ~5% YoY"} />
                <Field label="Legal, inspection, move" prefix="$" step={500} value={raw.legalFees} onChange={set("legalFees")}
                       tip="Conveyancing, the home inspection, and the cost of physically moving in. Paid on day one and never recovered." />
              </Group>

              <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
                <Eyebrow>{US ? "Closing costs" : "Property transfer tax"}</Eyebrow>
                <div className="flex items-baseline justify-between" style={{ marginTop: 6 }}>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.mute }}>
                    {US ? "Title, escrow, recording and lender fees"
                        : "1% to $200k, 2% to $2M, 3% above"}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: C.rent }}>
                    {usd(r.ptt)}
                  </span>
                </div>
                {US ? (
                  <div className="rvb-fields mt-3">
                    <Field label="As a share of price" suffix="%" step={0.25}
                           value={raw.usClosingPct} onChange={set("usClosingPct")}
                           hint="0.5–2% is typical, and varies a lot by state" />
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={raw.firstTime}
                        onChange={(e) => set("firstTime")(e.target.checked)}
                        style={{ accentColor: C.buy, width: 14, height: 14 }}
                      />
                      <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                        First-time buyer exemption
                      </span>
                    </label>
                    <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 3 }}>
                      Waives up to $8,000, and only under $860k.
                    </div>
                  </>
                )}
              </div>

              <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
                <Eyebrow>Where the down payment comes from</Eyebrow>
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 4, lineHeight: 1.45 }}>
                  {US
                    ? "Selling investments to raise the down payment costs you the tax on the " +
                      "gains — money the renter keeps working. Filing jointly doubles both the " +
                      "standard deduction and the §121 exclusion on the eventual sale."
                    : "Registered money is worth less than it looks. Anything left over is treated as " +
                      "cash savings. FHSA and HBP use the federal first-time test — no home in four " +
                      "years — which is separate from the BC transfer tax exemption above, so you can " +
                      "qualify for these at any price."}
                </div>
                <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={raw.couple}
                    onChange={(e) => set("couple")(e.target.checked)}
                    style={{ accentColor: C.buy, width: 14, height: 14 }}
                  />
                  <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                    {US ? "Married, filing jointly" : "Buying with a partner"}
                  </span>
                </label>
                <div className="rvb-fields mt-3">
                  {!US && (
                    <>
                      <Field label="From a First Home Savings Account" prefix="$" step={1000} value={raw.fhsaUse} onChange={set("fhsaUse")} hint={"Tax-free \u00b7 limit " + usd(r.fhsaCap)}
                             tip="The FHSA. Deductible going in and tax-free coming out if it buys a home, which makes it the cheapest money on this list. Needs the federal first-time test: no home you lived in for four years." />
                      <Field label="From an RRSP, under the Home Buyers' Plan" prefix="$" step={1000} value={raw.hbpUse} onChange={set("hbpUse")} hint={"Repayable \u00b7 limit " + usd(r.hbpCap)}
                             tip="A loan from yourself: you withdraw from the RRSP tax-free, then have to put it back over fifteen years. Miss a repayment and that year's share is added to your income and taxed." />
                    </>
                  )}
                  <Field label="From cash and savings" prefix="$" step={1000} value={raw.cashSavings} onChange={set("cashSavings")} hint="No tax to use it" />
                  <Field
                    label="From brokerage"
                    prefix="$"
                    step={1000}
                    value={p.autoBrokerage ? Math.round(r.taxableUse) : raw.taxableUse}
                    onChange={(v) => setRaw((st) => ({ ...st, taxableUse: v, autoBrokerage: false }))}
                    hint={r.saleTax > 0 ? "Tax to sell " + usd(r.saleTax) : "Triggers capital gains"}
                    badge={
                      p.autoBrokerage ? (
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 9,
                            letterSpacing: "0.03em",
                            color: C.buy,
                            border: "1px solid " + C.buySoft,
                            borderRadius: 2,
                            padding: "1px 4px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Auto
                        </span>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => setRaw((st) => ({ ...st, autoBrokerage: true }))}
                          style={{
                            fontFamily: MONO,
                            fontSize: 9,
                            letterSpacing: "0.03em",
                            color: C.mute,
                            background: "transparent",
                            border: "1px solid " + C.line,
                            borderRadius: 2,
                            padding: "1px 4px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Reset
                        </Button>
                      )
                    }
                  />
                  <Field
                    label="Share of it that is gain"
                    suffix="%"
                    step={5}
                    value={raw.taxableGainPct}
                    onChange={set("taxableGainPct")}
                    hint={
                      r.taxableUse > 0
                        ? usd(r.saleGain) + " of gain \u2192 " + usd(r.saleTax) + " tax at " + p.capGainsPct + "%"
                        : "Only the gain is taxed"
                    }
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <div className="flex" style={{ height: 12, borderRadius: 2, overflow: "hidden" }}>
                    {[
                      ["FHSA", r.fhsaUse, C.buy],
                      ["RRSP", r.hbpUse, BUY_TINTS[2]],
                      ["Cash", r.cashUse, BUY_TINTS[5]],
                      ["Brokerage", r.taxableUse, C.signal],
                    ].map(([n2, v, col]) =>
                      v > 0 ? (
                        <div key={n2} title={n2 + " " + usd(v)} style={{ width: (v / Math.max(1, r.sourcesTotal)) * 100 + "%", background: col }} />
                      ) : null
                    )}
                  </div>
                  <div className="flex items-baseline justify-between" style={{ marginTop: 5 }}>
                    <span style={{ fontFamily: SANS, fontSize: 11, color: C.mute }}>
                      Adds up to your cash to close
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: C.buy }}>
                      {usd(r.sourcesTotal)}
                    </span>
                  </div>
                  {!p.autoBrokerage && r.shortfall > 0.5 && (
                    <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 4, lineHeight: 1.4 }}>
                      Your sources leave {usd(r.shortfall)} uncovered, so it's counted as extra
                      cash. Hit Reset to let the brokerage figure balance again.
                    </div>
                  )}
                </div>
                {r.overCap && !US && (
                  <div style={{ background: C.rentWash, borderRadius: 3, padding: 8, marginTop: 8, fontFamily: SANS, fontSize: 11.5, color: C.rent, lineHeight: 1.4 }}>
                    Over the limit — FHSA caps at {usd(r.fhsaCap)} and the HBP at {usd(r.hbpCap)}
                    {p.couple ? " for a couple" : " per person"}. Capped in the maths.
                  </div>
                )}
                {r.hbpUse > 0 && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 10 }}>
                      <input
                        type="checkbox"
                        checked={raw.hbpRepay}
                        onChange={(e) => set("hbpRepay")(e.target.checked)}
                        style={{ accentColor: C.buy, width: 14, height: 14 }}
                      />
                      <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                        Repay the HBP on schedule
                      </span>
                    </label>
                    <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 3 }}>
                      {p.hbpRepay
                        ? usd(r.hbpAnnual) + "/yr for 15 years, starting in year 3. It goes back into your RRSP and keeps compounding."
                        : "Skipping it adds " + usd(r.hbpAnnual) + " to your taxable income each year for 15 years."}
                    </div>
                  </>
                )}
              </div>

              <Group
                title="The mortgage"
                note={US
                  ? "A 30-year fixed: one rate for the life of the loan, compounded monthly."
                  : "Rates compound semi-annually, the Canadian way."}
              >
                <Field label={US ? "Rate" : "Rate, first term"} suffix="%" step={0.05} value={raw.rate} onChange={set("rate")} hint={US ? "30-yr fixed ≈ 6.5%" : "5-yr fixed ≈ 4.24%"} />
                {!US && (
                  <>
                    <Field label="Rate at renewal" suffix="%" step={0.05} value={raw.renewalRate} onChange={set("renewalRate")} hint="The big unknown" />
                    <Field label="Term" suffix="yr" step={1} value={raw.termYears} onChange={set("termYears")} hint="Rate is locked this long" />
                  </>
                )}
                <Field label="Amortization" suffix="yr" step={5} value={raw.amortYears} onChange={set("amortYears")} hint={US ? "30 is standard" : "25 unless first-time"} />
                {US && (
                  <Field label="Mortgage insurance" suffix="%/yr" step={0.05} value={raw.pmiPct} onChange={set("pmiPct")} hint="Charged monthly. None at 20% down"
                         tip="Private mortgage insurance, or PMI. It protects the lender, not you, and it is charged every month until you owe 78% of what you originally paid. Unlike Canada's CMHC premium it is not added to the loan, and it has not been tax-deductible since 2021." />
                )}
                <Field label="Cost to sell" suffix="%" step={0.25} value={raw.sellCostPct} onChange={set("sellCostPct")} hint={US ? "5–6% all in, agent included" : "7% first $100k, 2.5% after"}
                       tip="Agent commission, legal fees and staging, as a share of the sale price. Charged at every point on the chart, because both lines show what you would actually walk away with if you sold that day." />
              </Group>

              {r.premium > 0 && (
                <div style={{ background: C.panelAlt, borderRadius: 3, padding: 10, marginTop: -8 }} className="mb-6">
                  <Eyebrow>
                    Mortgage insurance{" "}
                    <Info label="mortgage insurance" text="The CMHC premium. Anyone putting down less than 20% has to buy it, and it protects the lender rather than you. It is added to the mortgage instead of paid up front, so you pay interest on it for the life of the loan." />
                  </Eyebrow>
                  <div className="flex items-baseline justify-between" style={{ marginTop: 4 }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>
                      {r.premiumPct}% of the loan, added to it
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600 }}>
                      {usd(r.premium)}
                    </span>
                  </div>
                </div>
              )}
              {US && r.totPMI > 0.5 && (
                <div style={{ background: C.panelAlt, borderRadius: 3, padding: 10, marginTop: -8 }} className="mb-6">
                  <Eyebrow>
                    Mortgage insurance{" "}
                    <Info label="mortgage insurance" text="Private mortgage insurance, or PMI. Required below 20% down, it protects the lender rather than you, and it stops automatically once you owe 78% of the original purchase price." />
                  </Eyebrow>
                  <div className="flex items-baseline justify-between" style={{ marginTop: 4 }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>
                      {r.pmiEndsMonth
                        ? "Drops off in year " + Math.ceil(r.pmiEndsMonth / 12)
                        : "Still running at the horizon"}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600 }}>
                      {usd(r.totPMI)}
                    </span>
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 4, lineHeight: 1.4 }}>
                    Cancels automatically at 78% of the original price, not of
                    what the home is worth by then — so appreciation does not
                    get you out of it early. It is not deductible.
                  </div>
                </div>
              )}
              {r.belowMin && (
                <div style={{ background: C.rentWash, borderRadius: 3, padding: 10, marginTop: -8 }} className="mb-6">
                  <div style={{ fontFamily: SANS, fontSize: 12, color: C.rent, lineHeight: 1.4 }}>
                    {US
                      ? "Below 3% down, which is the floor on a conventional loan. You need at least " + usd(r.minDown) + "."
                      : r.insurable
                      ? "Below the legal minimum. You need at least " + usd(r.minDown) + " down — 5% of the first $500k, 10% of the rest."
                      : "Homes at $1.5M and up can't be insured. You need 20% down, or " + usd(r.minDown) + "."}
                  </div>
                </div>
              )}

              <Group title="Owning costs">
                <Field label="Property tax" suffix="%/yr" step={0.01} value={raw.propTaxPct} onChange={set("propTaxPct")} hint={US ? "1.1% national median; 2%+ in TX and NJ" : "Metro Vancouver ≈ 0.3–0.4%"} />
                <Field label="Home insurance" prefix="$" suffix="/yr" step={100} value={raw.insYr} onChange={set("insYr")} />
                <Field label="Maintenance" prefix="$" suffix="/yr" step={500} value={raw.maintYr} onChange={set("maintYr")} hint="Roof, furnace, repairs" />
                <Field label="City utilities" prefix="$" suffix="/yr" step={100} value={raw.utilYr} onChange={set("utilYr")} hint="Water, sewer, garbage" />
                <Field label={US ? "HOA dues" : "Strata fee"} prefix="$" suffix="/mo" step={25} value={raw.strataMo} onChange={set("strataMo")} hint={US ? "0 if there's no association" : "0 for detached"} />
                <Field label="Remodelling budget" prefix="$" step={5000} value={raw.remodelCost} onChange={set("remodelCost")} hint={p.remodelCost > 0 ? usd(r.remodelMo) + "/mo while it runs" : "0 if move-in ready"} />
                {p.remodelCost > 0 && (
                  <>
                    <Field label="Remodel over" suffix="yr" step={1} value={raw.remodelYears} onChange={set("remodelYears")} hint="Spread evenly" />
                    <Field
                      label="Value it adds to the home"
                      suffix="%"
                      step={5}
                      value={raw.remodelRecoveryPct}
                      onChange={set("remodelRecoveryPct")}
                      hint={usd(r.remodelValue) + " \u00b7 most work recovers 50\u201380%"}
                      tip="How much of what you spend actually shows up in what the place is worth. Kitchens and bathrooms recover most of it; a swimming pool recovers very little."
                    />
                  </>
                )}
              </Group>
              {!US && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: -12 }}>
                    <input
                      type="checkbox"
                      checked={raw.hog}
                      onChange={(e) => set("hog")(e.target.checked)}
                      style={{ accentColor: C.buy, width: 14, height: 14 }}
                    />
                    <span style={{ fontFamily: SANS, fontSize: 12.5 }}>
                      Claim the Home Owner Grant
                    </span>
                  </label>
                  <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute, marginTop: 3, marginBottom: 20 }}>
                    $570 off your tax bill, phasing out above $2.075M assessed.
                  </div>
                </>
              )}

              {/* The US deduction is worth nothing at all for most buyers, and
                  the only honest way to show that is to compute both sides. */}
              {US && (
                <Group
                  title="Federal and state tax"
                  note="Both sides are compared against the standard deduction, which is why the mortgage deduction is often worth exactly nothing."
                >
                  <Field label="Household income" prefix="$" step={10000} value={raw.usIncome} onChange={set("usIncome")} hint="Sets the passive-loss allowance on rentals" />
                  <Field label="State income tax" suffix="%" step={0.5} value={raw.usStateTaxPct} onChange={set("usStateTaxPct")} hint="0 in TX, FL, WA, NV, TN" />
                  <Field label="Standard deduction" prefix="$" step={500} value={raw.usStdDed} onChange={set("usStdDed")} hint={p.couple ? "Doubled to " + usd(p.usStdDed * 2) + " filing jointly" : "Single filer"} />
                </Group>
              )}
              {US && (
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: -12, marginBottom: 20, lineHeight: 1.45 }}>
                  {r.totTaxBenefit > 0.5
                    ? "Itemizing beats the standard deduction, and the mortgage is worth " +
                      usd(r.totTaxBenefit) + " over " + p.horizonYears + " years. " +
                      "Interest is capped at the first $750,000 of the loan and " +
                      "state and property tax together at $10,000."
                    : "At this price the mortgage interest deduction is worth nothing: " +
                      "you would take the standard deduction either way, so owning buys " +
                      "you no deduction a renter doesn't already have. That is the case " +
                      "for most buyers since 2018, and most calculators get it wrong."}
                </div>
              )}

              <Group title="Renting">
                <Field label="Rent today" prefix="$" suffix="/mo" step={50} value={raw.rentMo} onChange={set("rentMo")} hint={US ? "Whatever the same house rents for" : "3-bed, Metro Vancouver"} />
                <Field label="Increase while you stay" suffix="%/yr" step={0.1} value={raw.rentGrowthPct} onChange={set("rentGrowthPct")} hint={US ? "Uncapped in most states" : "BC caps it: 2.3% in 2026"} />
                <Field label="Market rent growth" suffix="%/yr" step={0.25} value={raw.marketRentGrowthPct} onChange={set("marketRentGrowthPct")} hint="What you'd re-rent at" />
                <Field label="You move every" suffix="yr" step={1} value={raw.moveEveryYears} onChange={set("moveEveryYears")} hint="0 if you never move" />
                <Field label="Cost of a move" prefix="$" step={250} value={raw.moveCost} onChange={set("moveCost")} />
                <Field label="Tenant insurance" prefix="$" suffix="/mo" step={5} value={raw.rentInsMo} onChange={set("rentInsMo")} />
              </Group>

              <Group
                title={US ? "Rental income" : "Mortgage helper"}
                note={US
                  ? "A garage apartment, a basement flat or a room let out. Zero if there isn't one."
                  : "The suite downstairs. Set the rent to zero if there isn't one."}
              >
                <Field label={US ? "Rent from it" : "Suite rent"} prefix="$" suffix="/mo" step={50} value={raw.suiteRentMo} onChange={set("suiteRentMo")} hint={p.suiteRentMo > 0 ? (US ? "One bedroom \u2248 $1,200" : "Two bedroom \u2248 $1,900") : "None"} />
                {p.suiteRentMo > 0 && (
                  <>
                    <Field label="Suite rent increase" suffix="%/yr" step={0.25} value={raw.suiteGrowthPct} onChange={set("suiteGrowthPct")} hint="Resets on turnover" />
                    <Field label="Vacancy allowance" suffix="%" step={1} value={raw.suiteVacancyPct} onChange={set("suiteVacancyPct")}
                       tip="The share of the year it sits empty between tenants, plus rent you never collect." />
                    <Field label="Share of the house it takes up" suffix="%" step={5} value={raw.suiteSharePct} onChange={set("suiteSharePct")} hint="Sets how much you can deduct"
                       tip="The rented portion by floor area. That share of the mortgage interest, property tax, insurance, utilities and upkeep becomes deductible against the rent it earns." />
                  </>
                )}
              </Group>
              {p.suiteRentMo <= 0 && (
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: -12, marginBottom: 20, lineHeight: 1.45 }}>
                  No suite, so no rental income, no vacancy risk, and none of the house is
                  deductible. The whole place is treated as your principal residence.
                </div>
              )}

              <Group title="Your money" note="What the cash does when it isn't in a house.">
                <Field label="Investment return" suffix="%/yr" step={0.5} value={raw.investPct} onChange={set("investPct")}
                       tip="What the money earns in the market instead of sitting in a house. The renter's whole case rests on this, and a point either way moves the answer more than almost anything else here." />
                <Field label="Your marginal tax rate" suffix="%" step={1} value={raw.marginalTaxPct} onChange={set("marginalTaxPct")} hint={US ? "Your top federal bracket" : p.suiteRentMo > 0 ? "Taxes the suite income" : "Values registered money"}
                       tip={US
                         ? "The rate on your next dollar of income. It sets what the mortgage interest deduction is worth, and what you pay on any rental income."
                         : "The rate on your next dollar of income. It taxes the suite income, and it is also how the calculator discounts RRSP and FHSA money, since you would eventually pay this rate to withdraw it."} />
                <Field label="Tax on investment gains" suffix="%" step={1} value={raw.capGainsPct} onChange={set("capGainsPct")} hint={US ? "15% long-term for most; 0 inside a Roth" : "0 inside a TFSA"}
                       tip="Charged on the growth when the investments are finally sold. It applies to both sides, so it is not a thumb on the scale for either." />
                <Field label="Fees and tax drag" suffix="%/yr" step={0.1} value={raw.feeDragPct} onChange={set("feeDragPct")} hint="Subtracted from the return above"
                       tip="The fund's yearly management fee, plus the tax you pay along the way on dividends and distributions \u2014 as distinct from the tax on the gain when you finally sell, which is the field above." />
                <Field label="Inflation" suffix="%/yr" step={0.25} value={raw.inflPct} onChange={set("inflPct")} />
              </Group>
            </Panel>
          </div>

          {/* ---------------- RESULTS ---------------- */}
          <div className="rvb-col">
            {/* Signature chart */}
            <Panel className="mb-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0 }}>
                  Net worth, side by side
                </h2>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-2">
                    <span style={{ width: 14, height: 3, background: C.buy, display: "inline-block" }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.buy }}>Owning</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span style={{ width: 14, height: 3, background: C.rent, display: "inline-block" }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.rent }}>Renting</span>
                  </span>
                </div>
              </div>
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 10 }}>
                The shaded gap is whoever is ahead. It changes color the month the lead flips.
              </p>

              <div className="rvb-chart">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 18, right: 10, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={[0, p.horizonYears]}
                      ticks={xTicks}
                      tickFormatter={(v) => (v === 0 ? "now" : "yr " + v)}
                      tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                      stroke={C.line}
                    />
                    <YAxis
                      domain={[minP - pad, maxP + pad]}
                      tickFormatter={(v) => compact(v - OFF)}
                      tick={{ fontFamily: MONO, fontSize: 10.5, fill: C.mute }}
                      stroke={C.line}
                      width={58}
                    />
                    <Tooltip
                      cursor={{ stroke: C.mute, strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        const lead = d.buy - d.rent;
                        return (
                          <div
                            style={{
                              background: C.field,
                              border: "1px solid " + C.line,
                              borderRadius: 3,
                              padding: "8px 10px",
                              fontFamily: MONO,
                              fontSize: 12,
                            }}
                          >
                            <div style={{ color: C.mute, fontSize: 10.5, marginBottom: 4 }}>
                              {d.t === 0 ? "Today" : "Year " + d.t.toFixed(1)}
                            </div>
                            <div style={{ color: C.buy }}>Own · {usd(d.buy)}</div>
                            <div style={{ color: C.rent }}>Rent · {usd(d.rent)}</div>
                            <div style={{ color: C.ink, marginTop: 4, borderTop: "1px solid " + C.line, paddingTop: 4 }}>
                              {lead >= 0 ? "Own" : "Rent"} ahead {usd(Math.abs(lead))}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area dataKey="base" stackId="g" stroke="none" fill="none" isAnimationActive={false} />
                    <Area dataKey="gapRent" stackId="g" stroke="none" fill={C.rentSoft} fillOpacity={0.85} isAnimationActive={false} />
                    <Area dataKey="gapBuy" stackId="g" stroke="none" fill={C.buySoft} fillOpacity={0.85} isAnimationActive={false} />
                    {r.breakeven !== null && r.breakeven > 0 && (
                      <ReferenceLine
                        x={r.breakeven}
                        stroke={C.signal}
                        strokeWidth={2}
                        label={{
                          value: "break even",
                          position: "top",
                          offset: 6,
                          fontFamily: MONO,
                          fontSize: 10,
                          fill: C.signal,
                        }}
                      />
                    )}
                    <Line dataKey="buyP" stroke={C.buy} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="rentP" stroke={C.rent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div style={{ borderLeft: "3px solid " + C.buy, paddingLeft: 10 }}>
                  <Eyebrow tone={C.buy}>Owner at year {p.horizonYears}</Eyebrow>
                  <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>{usd(r.finalBuy)}</div>
                  <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute }}>
                    Home equity plus {usd(r.buyTaxableEnd)} invested
                    {r.buyRegEnd > 0 ? " and " + usd(r.buyRegEnd * (1 - p.marginalTaxPct / 100)) + " in RRSP after tax" : ""}
                  </div>
                </div>
                <div style={{ borderLeft: "3px solid " + C.rent, paddingLeft: 10 }}>
                  <Eyebrow tone={C.rent}>Renter at year {p.horizonYears}</Eyebrow>
                  <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>{usd(r.finalRent)}</div>
                  <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute }}>
                    {usd(r.rentTaxableEnd)} taxable
                    {r.rentRegEnd > 0 ? " plus " + usd(r.rentRegEnd * (1 - p.marginalTaxPct / 100)) + " registered, after tax" : ""}
                  </div>
                </div>
              </div>
            </Panel>

            {/* Monthly cost + mortgage helper */}
            <div className="rvb-pair mb-5">
              <Panel>
                <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
                  What you pay each month
                </h2>
                <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 14 }}>
                  First-year average.
                </p>

                <div className="mb-1 flex items-baseline justify-between">
                  <Eyebrow tone={C.buy}>Own · full cost</Eyebrow>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>
                    {usd(y1.gross)}
                  </span>
                </div>
                <div className="flex" style={{ height: 14, width: (y1.gross / barMax) * 100 + "%" }}>
                  {costParts.map(([n2, v], idx) => (
                    <div
                      key={n2}
                      title={n2 + " " + usd(v)}
                      style={{ width: (v / y1.gross) * 100 + "%", background: BUY_TINTS[idx % BUY_TINTS.length] }}
                    />
                  ))}
                </div>
                {y1.suite > 0.5 && (
                  <div className="mb-3" style={{ width: (y1.gross / barMax) * 100 + "%" }}>
                    <div
                      style={{
                        height: 5,
                        marginTop: 2,
                        width: Math.min(100, (y1.suite / y1.gross) * 100) + "%",
                        background: C.signal,
                      }}
                    />
                    <div style={{ fontFamily: MONO, fontSize: 10, color: C.mute, marginTop: 2 }}>
                      SUITE COVERS {Math.round((y1.suite / y1.gross) * 100)}%
                    </div>
                  </div>
                )}
                {y1.suite <= 0.5 && <div className="mb-3" />}

                <div className="mb-1 flex items-baseline justify-between">
                  <Eyebrow tone={C.rent}>Rent</Eyebrow>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>
                    {usd(y1r.total)}
                  </span>
                </div>
                <div
                  className="mb-4"
                  style={{ height: 14, width: (y1r.total / barMax) * 100 + "%", background: C.rent }}
                />

                {costParts.map(([n2, v], idx) => (
                  <div key={n2} className="flex items-center justify-between" style={{ padding: "3px 0" }}>
                    <span className="flex items-center gap-2">
                      <span style={{ width: 8, height: 8, background: BUY_TINTS[idx % BUY_TINTS.length], display: "inline-block" }} />
                      <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>{n2}</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{usd(v)}</span>
                  </div>
                ))}
                {y1.suite > 0.5 && (
                  <div className="flex items-center justify-between" style={{ padding: "3px 0" }}>
                    <span className="flex items-center gap-2">
                      <span style={{ width: 8, height: 8, background: C.signal, display: "inline-block" }} />
                      <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>
                        {y1.suiteTax > 0.5
                          ? "Suite rent, after vacancy and tax"
                          : "Suite rent — deductions cover the tax"}
                      </span>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.buy }}>
                      −{usd(y1.suite)}
                    </span>
                  </div>
                )}
                <div style={{ borderTop: "1px solid " + C.line, marginTop: 8, paddingTop: 8 }}>
                  <Row label="Owning, out of your pocket" value={usd(y1.total)} strong />
                  <Row
                    label={y1.total > y1r.total ? "Owning costs more, per month" : "Renting costs more, per month"}
                    value={usd(Math.abs(y1.total - y1r.total))}
                    tone={y1.total > y1r.total ? C.rent : C.buy}
                    strong
                  />
                  <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 6, lineHeight: 1.45 }}>
                    That difference is exactly what the cheaper side invests every month.
                  </div>
                </div>
              </Panel>

              <Panel>
                <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
                  Your mortgage
                </h2>
                <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
                  {usd(r.loan)} at {p.rate}%, {p.amortYears}-year amortization.
                </p>

                <div style={{ background: C.panelAlt, borderRadius: 3, padding: 12, marginBottom: 12 }}>
                  <Eyebrow>Principal &amp; interest</Eyebrow>
                  <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
                    {usd(r.payment)}
                    <span style={{ fontSize: 13, color: C.mute, fontWeight: 400 }}> /mo</span>
                  </div>
                </div>

                <Row label="Down payment" value={usd(r.down)} />
                <Row label={US ? "Title, escrow and lender fees" : "Property transfer tax"}
                     value={usd(r.ptt)} tone={C.rent} />
                <Row label="Legal, inspection, move" value={usd(r.legalFees)} />
                <Row label="Cash needed at closing" value={usd(r.cashToClose)} strong />
                {r.saleTax > 0 && (
                  <Row
                    label={"Capital gains tax to raise " + usd(r.taxableUse)}
                    value={usd(r.saleTax)}
                    tone={C.rent}
                  />
                )}
                {r.hbpUse > 0 && (
                  <Row
                    label={p.hbpRepay ? "HBP repayment, from year 3" : "Tax on skipped HBP repayments"}
                    value={usd(p.hbpRepay ? r.hbpMonthly : r.hbpTaxMonthly) + "/mo"}
                    tone={p.hbpRepay ? C.mute : C.rent}
                  />
                )}
                {r.premium > 0 && (
                  <Row label={"CMHC premium, " + r.premiumPct + "% financed"} value={usd(r.premium)} tone={C.rent} />
                )}
                {r.totPMI > 0.5 && (
                  <Row
                    label={r.pmiEndsMonth
                      ? "PMI, until it cancels in year " + Math.ceil(r.pmiEndsMonth / 12)
                      : "PMI over " + p.horizonYears + " years"}
                    value={usd(r.totPMI)}
                    tone={C.rent}
                  />
                )}
                {US && (
                  <Row
                    label={"Mortgage interest deduction, " + p.horizonYears + " years"}
                    tip="Worth the difference between itemizing and taking the standard deduction \u2014 and that comparison is made for the renter as well, so this counts only the deduction owning actually buys you. At most prices that is nothing."
                    value={usd(r.totTaxBenefit)}
                    tone={r.totTaxBenefit > 0.5 ? C.buy : C.mute}
                  />
                )}
                {US && r.gainTaxEnd > 0.5 && (
                  <Row
                    label="Tax on the gain above the exclusion"
                    value={usd(r.gainTaxEnd)}
                    tone={C.rent}
                    tip={"Selling your main home shelters the first " +
                         usd(p.couple ? 500000 : 250000) + " of gain from tax, so long as " +
                         "you owned and lived in it for two of the last five years. This is " +
                         "the tax on whatever is above that."}
                  />
                )}
                {r.renewalPayment !== null && (
                  <Row
                    label={"Payment after year " + p.termYears + " renewal"}
                    value={usd(r.renewalPayment) + "/mo"}
                    tone={r.renewalPayment > r.payment ? C.rent : C.buy}
                  />
                )}
                <Row label="Interest over the full amortization" value={usd(r.fullInterest)} tone={C.rent} />
                <Row label={"Interest paid by year " + p.horizonYears} value={usd(r.totInterest)} />
                <Row label={"Principal paid by year " + p.horizonYears} value={usd(r.totPrincipal)} tone={C.buy} />
                <Row label={"Balance left at year " + p.horizonYears} value={usd(r.balanceEnd)} />
                {r.totRemodel > 0.5 && (
                  <Row label={"Remodelling by year " + p.horizonYears} value={usd(r.totRemodel)} tone={C.rent} />
                )}
                {p.suiteRentMo > 0 && (
                  <Row label={"Suite income by year " + p.horizonYears} value={usd(r.totSuite)} tone={C.buy} />
                )}
                <Row
                  label={
                    r.breakPenalty > 0
                      ? "Penalty for breaking mid-term"
                      : "You'd sell at a term end — no penalty"
                  }
                  value={r.breakPenalty > 0 ? usd(r.breakPenalty) : "$0"}
                  tone={r.breakPenalty > 0 ? C.rent : C.buy}
                />

                <div className="mt-3" style={{ width: "100%", height: 110 }}>
                  <ResponsiveContainer>
                    <BarChart data={r.amort} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
                      <XAxis
                        dataKey="year"
                        tick={{ fontFamily: MONO, fontSize: 9.5, fill: C.mute }}
                        stroke={C.line}
                        interval={Math.max(0, Math.floor(r.amort.length / 6) - 1)}
                      />
                      <YAxis hide />
                      <Tooltip
                        cursor={{ fill: "rgba(0,0,0,0.04)" }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div style={{ background: C.field, border: "1px solid " + C.line, padding: "6px 9px", fontFamily: MONO, fontSize: 11.5 }}>
                              <div style={{ color: C.mute, fontSize: 10 }}>YEAR {label}</div>
                              <div style={{ color: C.buy }}>Principal {usd(d.principal)}</div>
                              <div style={{ color: C.rent }}>Interest {usd(d.interest)}</div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="interest" stackId="a" fill={C.rentSoft} isAnimationActive={false} />
                      <Bar dataKey="principal" stackId="a" fill={C.buy} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.mute }}>
                  Each bar is one year of payments. Dark is equity you keep; light is interest
                  the bank keeps.
                </div>
              </Panel>
            </div>

            {/* Sensitivity and caveats pair up on wide screens */}
            <div className="rvb-pair-wide mb-5">
            <Panel>
              <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
                What would change the answer
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
                Owning's lead at year {p.horizonYears} if one assumption moves. Negative means
                renting wins.
              </p>
              {[
                ["Home appreciation", sens.appr],
                ["Investment return", sens.inv],
                ["Rate at renewal", sens.renew],
                ["Mortgage helper income", sens.suite],
                ["Share of registered money used", sens.reg],
              ].map(([label, rows]) => (
                <div key={label} className="mb-3">
                  <Eyebrow>{label}</Eyebrow>
                  <div className="grid grid-cols-5 gap-1 mt-1">
                    {rows.map((s) => (
                      <div
                        key={s.d}
                        style={{
                          background: s.cur ? C.panelAlt : "transparent",
                          border: "1px solid " + (s.cur ? C.line : "transparent"),
                          borderRadius: 3,
                          padding: "5px 4px",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.mute }}>
                          {s.label}
                        </div>
                        <div
                          style={{
                            fontFamily: MONO,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: s.v >= 0 ? C.buy : C.rent,
                          }}
                        >
                          {s.v >= 0 ? "+" : "−"}
                          {compact(Math.abs(s.v))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Panel>

            <Panel>
              <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0, marginBottom: 2 }}>
                What this still can't tell you
              </h2>
              <p style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, marginBottom: 12 }}>
                Every one of these can outweigh the number at the top of the page.
              </p>
              <div>
                {[
                  ["You're not comparing like with like", "A detached house with a yard and a suite is more home than a 3-bed rental. Some of the gap is consumption, not investment."],
                  ...(p.suiteRentMo > 0
                    ? US
                      ? [
                          ["The second unit has to exist and be legal", "Building one runs $100\u2013250k, raises your insurance, and zoning still forbids it across much of the country."],
                          ["Renting part of your home splits the \u00a7121 exclusion", "The rented share is not a principal residence, and depreciation on it is recaptured whether or not you ever claimed it."],
                        ]
                      : [
                        ["The suite has to exist and be legal", "Building or legalising one runs $80\u2013150k, raises your insurance, and needs a city licence."],
                        ["Claiming CCA can cost you", "Depreciating the rental portion can forfeit part of your principal-residence exemption. Most accountants say don't."],
                      ]
                    : [["No suite means no cushion", "A mortgage helper is usually the difference between owning working and not. Move the suite slider to see what one would be worth."]]),
                  ["Leverage cuts both ways", "A steady 3% hides the fact that 20% down is 5x leverage. A 15% drop erases three quarters of your down payment."],
                  ["The renter has to actually invest", "The whole case for renting assumes the monthly difference goes into the market every month, for years, untouched."],
                  US
                    ? ["The 30-year fixed is worth more than it looks", "Your payment is frozen for thirty years while rents are not. That is real insurance, and none of its value shows up in the number above."]
                    : ["Rate risk is real, not theoretical", "Renewal is modelled, but a job loss at renewal, or failing the stress test, isn't."],
                  US
                    ? ["Big lumpy costs", "Special assessments, a roof, and whatever the policy leaves out — flood and earthquake are almost always separate, and premiums are rising fast in exposed states."]
                    : ["Big lumpy costs", "Special assessments, a roof, earthquake coverage — commonly excluded in BC — and floodplain exposure near the rivers."],
                  ...(US
                    ? [["Property tax is not really a flat percentage", "Reassessment rules, local levies and caps like California's Prop 13 make the real path very different from a fixed rate on a rising value."]]
                    : []),
                  ["Life doesn't hold still", "The breakeven year assumes you stay. Job moves, kids, and separations don't wait for it."],
                ].map(([t, d]) => (
                  <div key={t} style={{ padding: "8px 0", borderBottom: "1px dotted " + C.line }}>
                    <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{t}</div>
                    <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, lineHeight: 1.45 }}>{d}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, lineHeight: 1.5, marginTop: 12 }}>
                {US
                  ? "State and local programmes — first-time buyer credits, homestead exemptions, " +
                    "assessment caps — vary enormously and are not modelled. Nor are points paid " +
                    "to buy the rate down, or a refinance if rates fall."
                  : "First-time buyers also have the FHSA and Home Buyers' Plan, worth up to $40k of " +
                    "deductions and a $60k RRSP withdrawal — money you only get if you buy. Not modelled here."}
              </div>
            </Panel>

            </div>

            {/* Ledger — full width, it is a wide table */}
            <Panel className="mb-5">
              <div className="flex items-baseline justify-between">
                <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0 }}>
                  Year-by-year ledger
                </h2>
                <Button
                  onClick={() => setShowLedger((s) => !s)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: C.ink,
                    background: "transparent",
                    border: "1px solid " + C.line,
                    borderRadius: 3,
                    padding: "4px 9px",
                    cursor: "pointer",
                  }}
                >
                  {showLedger ? "Hide" : "Show"}
                </Button>
              </div>

              {showLedger && (
                <div className="mt-3 overflow-x-auto" style={{ maxHeight: 340, overflowY: "auto" }}>
                  <table className="w-full" style={{ fontFamily: MONO, fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: C.panel }}>
                        {[
                          ["Year", false],
                          ["Home value", false],
                          ["Mortgage", true],
                          ["Equity", true],
                          ["Own paid", true],
                          ["Rent paid", true],
                          ["Own worth", false],
                          ["Rent worth", false],
                          ["Lead", false],
                        ].map(
                          ([h, small]) => (
                            <th
                              key={h}
                              className={small ? "rvb-hide-sm" : undefined}
                              style={{
                                position: "sticky",
                                top: 0,
                                background: C.panel,
                                textAlign: h === "Yr" ? "left" : "right",
                                padding: "6px 7px",
                                borderBottom: "1px solid " + C.ink,
                                fontSize: 10,
                                letterSpacing: "0.03em",
                                color: C.mute,
                                fontWeight: 500,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {r.years.map((y) => {
                        const lead = y.buyNW - y.rentNW;
                        return (
                          <tr key={y.year} style={{ borderBottom: "1px solid " + C.line }}>
                            <td style={{ padding: "5px 7px", color: C.mute }}>{y.year}</td>
                            <td style={{ padding: "5px 7px", textAlign: "right" }}>{compact(y.homeValue)}</td>
                            <td className="rvb-hide-sm" style={{ padding: "5px 7px", textAlign: "right", color: C.mute }}>{compact(y.balance)}</td>
                            <td className="rvb-hide-sm" style={{ padding: "5px 7px", textAlign: "right" }}>{compact(y.equity)}</td>
                            <td className="rvb-hide-sm" style={{ padding: "5px 7px", textAlign: "right", color: C.mute }}>{compact(y.buyOut)}</td>
                            <td className="rvb-hide-sm" style={{ padding: "5px 7px", textAlign: "right", color: C.mute }}>{compact(y.rentOut)}</td>
                            <td style={{ padding: "5px 7px", textAlign: "right", color: C.buy }}>{compact(y.buyNW)}</td>
                            <td style={{ padding: "5px 7px", textAlign: "right", color: C.rent }}>{compact(y.rentNW)}</td>
                            <td
                              style={{
                                padding: "5px 7px",
                                textAlign: "right",
                                fontWeight: 600,
                                color: lead >= 0 ? C.buy : C.rent,
                              }}
                            >
                              {(lead >= 0 ? "+" : "−") + compact(Math.abs(lead))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <p
              style={{
                fontFamily: SANS,
                fontSize: 11,
                color: C.mute,
                lineHeight: 1.6,
                marginTop: 16,
              }}
            >
              Assumptions: you sell at the end of the period and pay selling costs, and the
              renter pays tax on investment gains — set that to 0 if the money sits in a{" "}
              {US ? "Roth" : "TFSA"}.{" "}
              {US ? (
                <>
                  The §121 exclusion covers the first {usd(p.couple ? 500000 : 250000)} of the
                  home's gain once you have owned and lived in it two of the last five years,
                  and anything above that is taxed at your capital gains rate — which is why
                  the answer jumps at the two-year mark. Mortgage interest and property tax
                  are deducted only when itemizing beats the standard deduction, and that
                  comparison is made for the renter too, so the calculator credits owning only
                  with the deduction a renter would not already have had. Interest is limited
                  to the first $750,000 of acquisition debt using the average-balance method,
                  and state plus property tax together are capped at $10,000. PMI is charged
                  monthly on the opening balance, is not deductible, and cancels at 78% of the
                  original purchase price — not of the appreciated value. The rate is fixed
                  for the life of the loan and there is no prepayment penalty, so selling
                  early costs nothing beyond the selling costs.
                </>
              ) : (
                <>
                  A principal residence is exempt from capital gains tax in Canada, so no tax is
                  charged on the home's gain, and there is no mortgage interest deduction here the
                  way there is in the US. Your rate is fixed only for the term; after that
                  everything renews at the renewal rate. The CMHC premium is financed into the
                  mortgage, so you pay interest on it.
                </>
              )}{" "}
              Property tax follows the home's assessed
              value, which is assumed to track market value. Remodelling cost is spread evenly
              over your chosen period, and the value it adds lands on the home as the work
              completes, at your chosen recovery rate, then appreciates with the house. It
              does not change the suite's rent — raise that yourself if the reno is what
              creates the suite.{" "}
              {!US && (
                <>
                  RRSP and FHSA money is valued
                  after tax at your marginal rate on both sides, since a renter eventually withdraws
                  it and an FHSA that never buys a home rolls into an RRSP; HBP repayments go back
                  into the RRSP and compound there at the same market return.{" "}
                </>
              )}
              If the suite's deductions exceed
              its rent the loss is treated as zero, though in practice it can offset other income. Maintenance, insurance, utilities
              and {US ? "HOA dues" : "strata fees"} grow with inflation.{" "}
              {US
                ? "State and local transfer taxes, points, and any refinance are not modelled."
                : "GST applies to new builds only and is not included."}{" "}
              Everything is in nominal dollars. This is a model, not advice.
            </p>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: C.mute,
                marginTop: 8,
                letterSpacing: "0.06em",
              }}
            >
              {"v" +
                (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev") +
                " \u00b7 build " +
                (typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "local")}
            </p>
          </div>
        </div>
        </>
        )}

        {/* The page's only other links. Without these a crawler that lands
            on one calculator has no route to the other five, and no way
            back out to the rest of the site. */}
        <footer
          style={{
            marginTop: 40, paddingTop: 20,
            borderTop: "1px solid " + C.line,
            fontFamily: SANS, fontSize: 12, color: C.mute, lineHeight: 1.9,
          }}
        >
          <nav aria-label="All calculators" style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.04em" }}>
              ALL CALCULATORS ·{" "}
            </span>
            {ROUTES.map((rt, i) => (
              <React.Fragment key={rt.id}>
                {i > 0 && <span style={{ color: C.line }}> · </span>}
                <a
                  href={rt.path}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
                    e.preventDefault();
                    if (rt.id === tab && !notFound) return;
                    setNotFound(false);
                    setTab(rt.id);
                    window.history.pushState(null, "", rt.path + stateToHash(raw));
                  }}
                  style={{ color: tab === rt.id ? C.ink : C.buy, textDecoration: "none" }}
                >
                  {rt.h1}
                </a>
              </React.Fragment>
            ))}
          </nav>
          <div>
            <a href="https://rishabhdoshi.com" style={{ color: C.buy, textDecoration: "none" }}>
              rishabhdoshi.com
            </a>
            <span style={{ color: C.line }}> · </span>
            <a href="https://experiments.rishabhdoshi.com" style={{ color: C.buy, textDecoration: "none" }}>
              More experiments
            </a>
            <span style={{ color: C.line }}> · </span>
            <a href="mailto:hello@rishabhdoshi.com" style={{ color: C.buy, textDecoration: "none" }}>
              hello@rishabhdoshi.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
