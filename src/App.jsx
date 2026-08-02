import React, { useState, useMemo } from "react";
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
 * literal hex values going to Recharts, which will not resolve CSS
 * variables in its SVG presentation attributes. */
const LIGHT = {
  bg: "#E7E9E3",
  panel: "#FBFBF8",
  panelAlt: "#F1F2ED",
  ink: "#15181A",
  mute: "#6C7370",
  line: "#D2D6CE",
  buy: "#0F5C52",
  buySoft: "#A9C6BF",
  rent: "#8C2F5E",
  rentSoft: "#D9AEC1",
  signal: "#D9A408",
  rentWash: "#F6E9EE",
  grid: "#D2D6CE",
  field: "#FFFFFF",
  onBuy: "#FFFFFF",
};
const DARK = {
  bg: "#0E1C2B",
  panel: "#14273A",
  panelAlt: "#1A2F44",
  ink: "#E8F0F7",
  mute: "#93AABF",
  line: "#2A4258",
  buy: "#5CC0AE",
  buySoft: "#2E6A61",
  rent: "#E68AB4",
  rentSoft: "#7A3355",
  signal: "#E8BC3E",
  rentWash: "#2A1B25",
  grid: "#24394E",
  field: "#0A1622",
  onBuy: "#0E1C2B",
};
const LIGHT_TINTS = ["#0F5C52", "#2E7568", "#4C8D80", "#6BA599", "#8ABDB3", "#AED4CC"];
const DARK_TINTS  = ["#5CC0AE", "#4EAD9C", "#419A8A", "#358878", "#2A7567", "#206356"];

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
const SERIF = "'IBM Plex Serif', Georgia, 'Times New Roman', serif";
const SANS = "'IBM Plex Sans', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/* ------------------------------------------------------------------ *
 *  Formatting
 * ------------------------------------------------------------------ */
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
 *  The model
 * ------------------------------------------------------------------ */
function simulate(p) {
  const price = p.homePrice;
  const downPct = Math.min(100, Math.max(0, p.downPct));
  const down = (price * downPct) / 100;
  const ptt = bcPTT(price, p.firstTime);
  const closing = ptt + p.legalFees;

  const premiumPct = cmhcPct(downPct, p.amortYears);
  const baseLoan = Math.max(0, price - down);
  const premium = (baseLoan * premiumPct) / 100;
  const loan = baseLoan + premium; // the premium is added to the mortgage

  // Where the cash to close comes from. Each dollar carries its own tax character.
  const cashNeeded = down + closing;
  const capMult = p.couple ? 2 : 1;
  const fhsaCap = 40000 * capMult;
  const hbpCap = 60000 * capMult;

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
  const termMonths = Math.max(1, Math.round(p.termYears * 12));
  const months = Math.max(1, Math.round(p.horizonYears * 12));

  let i = monthlyRate(p.rate);
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

  // The renter never liquidates, so their money keeps its original character
  let rentPort = grossSale + cashUse; // taxable: shares stay unsold, cash gets invested
  let rentBasis = grossSale * (1 - gainFrac) + cashUse;
  let rentReg = fhsaUse + hbpUse; // registered: RRSP, plus an FHSA that rolls into one
  let buyPort = 0;
  let buyBasis = 0;
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
    totRemodel = 0;
  let payoffMonth = null;
  let y1Buy = null;
  let y1Rent = null;

  // Breaking a fixed mortgage mid-term costs at least three months' interest
  const penaltyAt = (mIdx) =>
    balance > 0 && termMonths > 0 && mIdx % termMonths !== 0 ? balance * i * 3 : 0;
  const netBuy = (mIdx) =>
    homeValue * (1 - p.sellCostPct / 100) -
    balance -
    penaltyAt(mIdx) +
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
      i = monthlyRate(p.renewalRate);
      pmt = payment(balance, i, amortMonths - (m - 1));
      if (renewalPayment === null) renewalPayment = pmt;
    }

    const interest = balance * i;
    const principal = Math.min(Math.max(pmt - interest, 0), balance);
    const pi = balance > 0 ? interest + principal : 0;
    balance = Math.max(0, balance - principal);
    if (balance === 0 && payoffMonth === null && loan > 0) payoffMonth = m;

    const grossTax = (homeValue * p.propTaxPct) / 100;
    const propTax = Math.max(0, grossTax - homeOwnerGrant(homeValue, p.hog)) / 12;
    const maint = (p.maintYr / 12) * infl;
    const ins = (p.insYr / 12) * infl;
    const util = (p.utilYr / 12) * infl;
    const strata = p.strataMo * infl;
    const remodel = m <= remodelMonths ? remodelMo : 0;
    if (m <= remodelMonths) homeValue += remodelValueMo;
    const gross = pi + propTax + maint + ins + util + strata + remodel;

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
    const diff = buyCost + hbpFlow - rentCost;
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
      y1Buy = { pi, propTax, maint, ins, util, strata, remodel, gross, suite, suiteTax, total: buyCost };
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
    let ii = monthlyRate(p.rate);
    let pp = payment(b, ii, amortMonths);
    for (let m = 1; m <= amortMonths && b > 0.005; m++) {
      if (m > 1 && (m - 1) % termMonths === 0) {
        ii = monthlyRate(p.renewalRate);
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
    cashToClose: down + closing,
    minDown: (price * minDownPct(price)) / 100,
    belowMin: downPct < minDownPct(price) - 0.001,
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
 *  Small UI pieces
 * ------------------------------------------------------------------ */
function Eyebrow({ children, tone }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: tone || C.mute,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, value, onChange, prefix, suffix, step = 1, hint, badge }) {
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
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? step * 10 : step);
    setDropped(false);
    onChange(trim(num(value) + d));
  };

  return (
    <label className="block">
      <span
        className="flex items-baseline justify-between"
        style={{ marginBottom: 4, gap: 6 }}
      >
        <span style={{ fontFamily: SANS, fontSize: 12, color: C.mute }}>{label}</span>
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
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={handle}
          onKeyDown={onKeyDown}
          className="w-full"
          style={{
            fontFamily: MONO,
            fontSize: 13.5,
            color: C.ink,
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "7px 4px",
            minWidth: 0,
          }}
        />
        {suffix && (
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.mute }}>
            {suffix}
          </span>
        )}
      </span>
      {(dropped || hint) && (
        <span
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
    </label>
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

function Group({ title, children, note }) {
  return (
    <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
      <Eyebrow>{title}</Eyebrow>
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

function Row({ label, value, tone, strong }) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ padding: "5px 0", borderBottom: "1px dotted " + C.line }}
    >
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: strong ? C.ink : C.mute }}>
        {label}
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
        <Eyebrow>Compound annual growth rate</Eyebrow>
        <h1
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
        </h1>
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
              <button
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
              </button>
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
 *  Main
 * ------------------------------------------------------------------ */
const DEFAULTS = {
  // British Columbia, July 2026
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
};


const KEYS = {
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
};
const CODE_TO_KEY = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [v, k]));

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
  const [copied, setCopied] = useState(false);

  /* Applied during render, before any child reads C. Idempotent, so a
   * double render costs nothing. */
  const [theme, setTheme] = useState(readTheme);
  applyPalette(theme);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    writeTheme(next);
    setTheme(next);
  };

  // Mirror the inputs into the address bar so any view is a shareable link
  React.useEffect(() => {
    const id = setTimeout(() => {
      const h = stateToHash(raw);
      const next = window.location.pathname + window.location.search + h;
      window.history.replaceState(null, "", next);
    }, 250);
    return () => clearTimeout(id);
  }, [raw]);

  // Someone pasting a link into the same tab, or using back/forward
  React.useEffect(() => {
    const onHash = () => setRaw({ ...DEFAULTS, ...hashToState() });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
  const [tab, setTab] = useState("buy");

  const p = useMemo(() => {
    const o = {};
    for (const k in raw) o[k] = typeof raw[k] === "boolean" ? raw[k] : num(raw[k]);
    return o;
  }, [raw]);

  const set = (k) => (v) => setRaw((s) => ({ ...s, [k]: v }));
  const r = useMemo(() => simulate(p), [p]);

  // Appreciation tool
  const appr = useMemo(() => {
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
  }, [p]);

  const sens = useMemo(() => {
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
  }, [p]);

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
        <div className="flex items-center gap-1 mb-5" style={{ borderBottom: "1px solid " + C.line }}>
          {[
            ["buy", "Rent vs. buy"],
            ["appreciation", "Appreciation calculator"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                fontFamily: SANS,
                fontSize: 13.5,
                fontWeight: tab === id ? 600 : 400,
                color: tab === id ? C.ink : C.mute,
                background: "transparent",
                border: "none",
                borderBottom: "2px solid " + (tab === id ? C.buy : "transparent"),
                padding: "8px 12px",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}

          {/* the same switch that sits on the two sheets */}
          <button
            type="button"
            role="switch"
            aria-checked={theme === "light"}
            aria-label={theme === "light"
              ? "Switch to the dark sheet" : "Switch to the light sheet"}
            onClick={toggleTheme}
            style={{
              marginLeft: "auto", marginBottom: 6,
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
          </button>
        </div>

        {tab === "appreciation" ? (
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
        ) : (
        <>
        {/* HERO — the verdict is the headline */}
        <header className="mb-7">
          <div className="flex items-center justify-between mb-4">
            <Eyebrow>Rent vs. buy · British Columbia · net worth after costs and taxes</Eyebrow>
            <div className="flex items-center gap-2">
            <button
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
            </button>
            <button
              onClick={() => { setRaw(DEFAULTS); window.history.replaceState(null, "", window.location.pathname); }}
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
            </button>
            </div>
          </div>
          <h1
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
          </h1>
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
                label="Suite rent"
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
                <Field label="Appreciation" suffix="%/yr" step={0.25} value={raw.apprPct} onChange={set("apprPct")} hint="Detached is down ~5% YoY" />
                <Field label="Legal, inspection, move" prefix="$" step={500} value={raw.legalFees} onChange={set("legalFees")} />
              </Group>

              <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
                <Eyebrow>Property transfer tax</Eyebrow>
                <div className="flex items-baseline justify-between" style={{ marginTop: 6 }}>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.mute }}>
                    1% to $200k, 2% to $2M, 3% above
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: C.rent }}>
                    {usd(r.ptt)}
                  </span>
                </div>
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
              </div>

              <div style={{ borderTop: "1px solid " + C.line, paddingTop: 14 }} className="mb-6">
                <Eyebrow>Where the down payment comes from</Eyebrow>
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.mute, marginTop: 4, lineHeight: 1.45 }}>
                  Registered money is worth less than it looks. Anything left over is treated as
                  cash savings. FHSA and HBP use the federal first-time test — no home in four
                  years — which is separate from the BC transfer tax exemption above, so you can
                  qualify for these at any price.
                </div>
                <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={raw.couple}
                    onChange={(e) => set("couple")(e.target.checked)}
                    style={{ accentColor: C.buy, width: 14, height: 14 }}
                  />
                  <span style={{ fontFamily: SANS, fontSize: 12.5 }}>Buying with a partner</span>
                </label>
                <div className="rvb-fields mt-3">
                  <Field label="From FHSA" prefix="$" step={1000} value={raw.fhsaUse} onChange={set("fhsaUse")} hint={"Tax-free \u00b7 cap " + usd(r.fhsaCap)} />
                  <Field label="From RRSP (HBP)" prefix="$" step={1000} value={raw.hbpUse} onChange={set("hbpUse")} hint={"Repayable \u00b7 cap " + usd(r.hbpCap)} />
                  <Field label="From cash / savings" prefix="$" step={1000} value={raw.cashSavings} onChange={set("cashSavings")} hint="No tax to use it" />
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
                            letterSpacing: "0.1em",
                            color: C.buy,
                            border: "1px solid " + C.buySoft,
                            borderRadius: 2,
                            padding: "1px 4px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          AUTO
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRaw((st) => ({ ...st, autoBrokerage: true }))}
                          style={{
                            fontFamily: MONO,
                            fontSize: 9,
                            letterSpacing: "0.1em",
                            color: C.mute,
                            background: "transparent",
                            border: "1px solid " + C.line,
                            borderRadius: 2,
                            padding: "1px 4px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          RESET
                        </button>
                      )
                    }
                  />
                  <Field
                    label="Share of it that's gain"
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
                      cash. Hit RESET to let the brokerage figure balance again.
                    </div>
                  )}
                </div>
                {r.overCap && (
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

              <Group title="The mortgage" note="Rates compound semi-annually, the Canadian way.">
                <Field label="Rate, first term" suffix="%" step={0.05} value={raw.rate} onChange={set("rate")} hint="5-yr fixed ≈ 4.24%" />
                <Field label="Rate at renewal" suffix="%" step={0.05} value={raw.renewalRate} onChange={set("renewalRate")} hint="The big unknown" />
                <Field label="Term" suffix="yr" step={1} value={raw.termYears} onChange={set("termYears")} hint="Rate is locked this long" />
                <Field label="Amortization" suffix="yr" step={5} value={raw.amortYears} onChange={set("amortYears")} hint="25 unless first-time" />
                <Field label="Cost to sell" suffix="%" step={0.25} value={raw.sellCostPct} onChange={set("sellCostPct")} hint="7% first $100k, 2.5% after" />
              </Group>

              {r.premium > 0 && (
                <div style={{ background: C.panelAlt, borderRadius: 3, padding: 10, marginTop: -8 }} className="mb-6">
                  <Eyebrow>CMHC insurance</Eyebrow>
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
              {r.belowMin && (
                <div style={{ background: C.rentWash, borderRadius: 3, padding: 10, marginTop: -8 }} className="mb-6">
                  <div style={{ fontFamily: SANS, fontSize: 12, color: C.rent, lineHeight: 1.4 }}>
                    {r.insurable
                      ? "Below the legal minimum. You need at least " + usd(r.minDown) + " down — 5% of the first $500k, 10% of the rest."
                      : "Homes at $1.5M and up can't be insured. You need 20% down, or " + usd(r.minDown) + "."}
                  </div>
                </div>
              )}

              <Group title="Owning costs">
                <Field label="Property tax" suffix="%/yr" step={0.01} value={raw.propTaxPct} onChange={set("propTaxPct")} hint="Metro Vancouver ≈ 0.3–0.4%" />
                <Field label="Home insurance" prefix="$" suffix="/yr" step={100} value={raw.insYr} onChange={set("insYr")} />
                <Field label="Maintenance" prefix="$" suffix="/yr" step={500} value={raw.maintYr} onChange={set("maintYr")} hint="Roof, furnace, repairs" />
                <Field label="City utilities" prefix="$" suffix="/yr" step={100} value={raw.utilYr} onChange={set("utilYr")} hint="Water, sewer, garbage" />
                <Field label="Strata fee" prefix="$" suffix="/mo" step={25} value={raw.strataMo} onChange={set("strataMo")} hint="0 for detached" />
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
                      hint={usd(r.remodelValue) + " \u00b7 most renos recover 50\u201380%"}
                    />
                  </>
                )}
              </Group>
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

              <Group title="Renting">
                <Field label="Rent today" prefix="$" suffix="/mo" step={50} value={raw.rentMo} onChange={set("rentMo")} hint="3-bed, Metro Vancouver" />
                <Field label="Increase while you stay" suffix="%/yr" step={0.1} value={raw.rentGrowthPct} onChange={set("rentGrowthPct")} hint="BC caps it: 2.3% in 2026" />
                <Field label="Market rent growth" suffix="%/yr" step={0.25} value={raw.marketRentGrowthPct} onChange={set("marketRentGrowthPct")} hint="What you'd re-rent at" />
                <Field label="You move every" suffix="yr" step={1} value={raw.moveEveryYears} onChange={set("moveEveryYears")} hint="0 if you never move" />
                <Field label="Cost of a move" prefix="$" step={250} value={raw.moveCost} onChange={set("moveCost")} />
                <Field label="Tenant insurance" prefix="$" suffix="/mo" step={5} value={raw.rentInsMo} onChange={set("rentInsMo")} />
              </Group>

              <Group title="Mortgage helper" note="The suite downstairs. Set the rent to zero if there isn't one.">
                <Field label="Suite rent" prefix="$" suffix="/mo" step={50} value={raw.suiteRentMo} onChange={set("suiteRentMo")} hint={p.suiteRentMo > 0 ? "2-bed \u2248 $1,900" : "No suite"} />
                {p.suiteRentMo > 0 && (
                  <>
                    <Field label="Suite rent increase" suffix="%/yr" step={0.25} value={raw.suiteGrowthPct} onChange={set("suiteGrowthPct")} hint="Resets on turnover" />
                    <Field label="Vacancy allowance" suffix="%" step={1} value={raw.suiteVacancyPct} onChange={set("suiteVacancyPct")} />
                    <Field label="Suite share of the house" suffix="%" step={5} value={raw.suiteSharePct} onChange={set("suiteSharePct")} hint="Sets what you deduct" />
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
                <Field label="Investment return" suffix="%/yr" step={0.5} value={raw.investPct} onChange={set("investPct")} />
                <Field label="Your marginal tax rate" suffix="%" step={1} value={raw.marginalTaxPct} onChange={set("marginalTaxPct")} hint={p.suiteRentMo > 0 ? "Suite income + RRSP" : "Values RRSP/FHSA money"} />
                <Field label="Tax on gains" suffix="%" step={1} value={raw.capGainsPct} onChange={set("capGainsPct")} hint="0 inside a TFSA" />
                <Field label="Fees & tax drag" suffix="%/yr" step={0.1} value={raw.feeDragPct} onChange={set("feeDragPct")} hint="MER + tax on payouts" />
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
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.buy }}>OWN</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span style={{ width: 14, height: 3, background: C.rent, display: "inline-block" }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.rent }}>RENT</span>
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
                              {d.t === 0 ? "TODAY" : "YEAR " + d.t.toFixed(1)}
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
                <Row label="Property transfer tax" value={usd(r.ptt)} tone={C.rent} />
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
                    ? [
                        ["The suite has to exist and be legal", "Building or legalising one runs $80\u2013150k, raises your insurance, and needs a city licence."],
                        ["Claiming CCA can cost you", "Depreciating the rental portion can forfeit part of your principal-residence exemption. Most accountants say don't."],
                      ]
                    : [["No suite means no cushion", "A mortgage helper is usually the difference between owning working and not. Move the suite slider to see what one would be worth."]]),
                  ["Leverage cuts both ways", "A steady 3% hides the fact that 20% down is 5x leverage. A 15% drop erases three quarters of your down payment."],
                  ["The renter has to actually invest", "The whole case for renting assumes the monthly difference goes into the market every month, for years, untouched."],
                  ["Rate risk is real, not theoretical", "Renewal is modelled, but a job loss at renewal, or failing the stress test, isn't."],
                  ["Big lumpy costs", "Special assessments, a roof, earthquake coverage — commonly excluded in BC — and floodplain exposure near the rivers."],
                  ["Life doesn't hold still", "The breakeven year assumes you stay. Job moves, kids, and separations don't wait for it."],
                ].map(([t, d]) => (
                  <div key={t} style={{ padding: "8px 0", borderBottom: "1px dotted " + C.line }}>
                    <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{t}</div>
                    <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, lineHeight: 1.45 }}>{d}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.mute, lineHeight: 1.5, marginTop: 12 }}>
                First-time buyers also have the FHSA and Home Buyers' Plan, worth up to $40k of
                deductions and a $60k RRSP withdrawal — money you only get if you buy. Not modelled here.
              </div>
            </Panel>

            </div>

            {/* Ledger — full width, it is a wide table */}
            <Panel className="mb-5">
              <div className="flex items-baseline justify-between">
                <h2 style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, margin: 0 }}>
                  Year-by-year ledger
                </h2>
                <button
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
                </button>
              </div>

              {showLedger && (
                <div className="mt-3 overflow-x-auto" style={{ maxHeight: 340, overflowY: "auto" }}>
                  <table className="w-full" style={{ fontFamily: MONO, fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: C.panel }}>
                        {[
                          ["Yr", false],
                          ["Home value", false],
                          ["Loan", true],
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
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
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
              renter pays tax on investment gains — set that to 0 if the money sits in a TFSA.
              A principal residence is exempt from capital gains tax in Canada, so no tax is
              charged on the home's gain, and there is no mortgage interest deduction here the
              way there is in the US. Your rate is fixed only for the term; after that
              everything renews at the renewal rate. The CMHC premium is financed into the
              mortgage, so you pay interest on it. Property tax follows the home's assessed
              value, which is assumed to track market value. Remodelling cost is spread evenly
              over your chosen period, and the value it adds lands on the home as the work
              completes, at your chosen recovery rate, then appreciates with the house. It
              does not change the suite's rent — raise that yourself if the reno is what
              creates the suite. RRSP and FHSA money is valued
              after tax at your marginal rate on both sides, since a renter eventually withdraws
              it and an FHSA that never buys a home rolls into an RRSP; HBP repayments go back
              into the RRSP and compound there at the same market return. If the suite's deductions exceed
              its rent the loss is treated as zero, though in practice it can offset other income. Maintenance, insurance, utilities
              and strata fees grow with inflation. GST applies to new builds only and is not
              included. Everything is in nominal dollars. This is a model, not advice.
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
      </div>
    </div>
  );
}
