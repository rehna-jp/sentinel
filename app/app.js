// ── Sentinel Dashboard Controller ──────────────────────────────────────────

const SCENARIOS = {
  safe: {
    status: 'safe',
    pillText: '🟢 SAFE TO TRADE',
    headline: 'Both price feeds are fresh and aligned. Safe to execute.',
    explanation: 'Real-world equity (Pyth) and on-chain tokenized stock (xStock) prices are synchronized within 10.8 bps. No price drift detected.',
    equityPrice: 184.50,
    xstockPrice: 184.70,
    staleness: '4s (Fresh)',
    stalenessSeconds: 4,
    deviationBps: 10.8,
    spreadBadgeText: '+0.11% (11 bps)',
    spreadBadgeClass: 'green',
    verdictClass: 'safe',
    verdictText: '🟢 SAFE',
    consumerEligibility: 'Position is eligible for liquidation (LTV 75.80% > 75.00%). Sentinel CPI will verify price safety.',
    liquidationOutcome: 'success',
  },
  stale: {
    status: 'stale',
    pillText: '🔴 STALE — DO NOT TRADE',
    headline: 'Equity price feed is stale (market closed / off-hours). Blocked.',
    explanation: 'The real-world equity feed hasn’t reported updates in 8 minutes 14 seconds (limit 5m). On-chain trades risk executing against obsolete reference prices.',
    equityPrice: 184.50,
    xstockPrice: 184.70,
    staleness: '8m 14s (494s)',
    stalenessSeconds: 494,
    deviationBps: 10.8,
    spreadBadgeText: 'STALE (+494s)',
    spreadBadgeClass: 'red',
    verdictClass: 'stale',
    verdictText: '🔴 STALE (8m 14s)',
    consumerEligibility: 'Liquidation ATTEMPT BLOCKED by Sentinel: Reference price timestamp is 494s old (limit 300s).',
    liquidationOutcome: 'stale_block',
  },
  divergent: {
    status: 'divergent',
    pillText: '🟠 DIVERGENT — UNTRUSTED PRICE',
    headline: 'On-chain token price diverged from real-world equity. Blocked.',
    explanation: 'xStock token price is trading at $190.25 vs real equity $184.50 (+3.12% / 312 bps). Configured safety threshold is 200 bps (2.00%).',
    equityPrice: 184.50,
    xstockPrice: 190.25,
    staleness: '6s (Fresh)',
    stalenessSeconds: 6,
    deviationBps: 311.6,
    spreadBadgeText: '+3.12% (312 bps)',
    spreadBadgeClass: 'orange',
    verdictClass: 'divergent',
    verdictText: '🟠 DIVERGENT (312 bps)',
    consumerEligibility: 'Liquidation ATTEMPT BLOCKED by Sentinel: Spread 312 bps exceeds maximum safety tolerance (200 bps).',
    liquidationOutcome: 'divergent_block',
  },
};

let currentScenario = 'safe';
let secondsAgo = 2;
let isExecuting = false;

// ── DOM References ────────────────────────────────────────────────────────────
const card = document.getElementById('main-status-card');
const pill = document.getElementById('status-pill');
const pillText = document.getElementById('status-pill-text');
const headline = document.getElementById('status-headline');
const explanation = document.getElementById('status-explanation');
const timestampEl = document.getElementById('status-timestamp');
const metricStaleness = document.getElementById('metric-staleness');
const metricDeviation = document.getElementById('metric-deviation');

const tableEquityPrice = document.getElementById('table-equity-price');
const tableXstockPrice = document.getElementById('table-xstock-price');
const tableSpreadBadge = document.getElementById('table-spread-badge');
const tableVerdictTag = document.getElementById('table-verdict-tag');

const posCollateralVal = document.getElementById('pos-collateral-val');
const posColPrice = document.getElementById('pos-col-price');
const posLtv = document.getElementById('pos-ltv');
const actionStatusBox = document.getElementById('action-status-box');
const actionStatusText = document.getElementById('action-status-text');

const btnExecute = document.getElementById('btn-execute-liquidate');
const btnSpinner = document.getElementById('btn-spinner');
const btnText = document.getElementById('btn-text');
const terminalBody = document.getElementById('terminal-body');

// ── Init & Scene Switcher ─────────────────────────────────────────────────────
function init() {
  setupSceneButtons();
  setupExecutionHandler();
  setupCopyButton();
  startStalenessTicker();
  fetchPrestocksData();
  renderScenario('safe');
}

function setupSceneButtons() {
  const buttons = document.querySelectorAll('.scene-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const scene = btn.dataset.scene;
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScenario = scene;
      secondsAgo = 1;
      renderScenario(scene);
      logTerminal(`Scene switched to: ${scene.toUpperCase()} scenario`, 'log-info');
    });
  });
}

function renderScenario(sceneKey) {
  const data = SCENARIOS[sceneKey];

  // Update hero status card styling & text
  card.className = `status-card ${data.status}`;
  pillText.textContent = data.pillText;
  headline.textContent = data.headline;
  explanation.textContent = data.explanation;
  metricStaleness.textContent = data.staleness;
  metricDeviation.textContent = `${data.deviationBps.toFixed(1)} bps (${(data.deviationBps / 100).toFixed(2)}%)`;

  // Update price comparison table
  tableEquityPrice.textContent = `$${data.equityPrice.toFixed(2)}`;
  tableXstockPrice.textContent = `$${data.xstockPrice.toFixed(2)}`;

  tableSpreadBadge.className = `spread-badge ${data.spreadBadgeClass}`;
  tableSpreadBadge.textContent = data.spreadBadgeText;

  tableVerdictTag.className = `verdict-tag ${data.verdictClass}`;
  tableVerdictTag.textContent = data.verdictText;

  // Update demo position card
  const collateralValue = 10 * data.xstockPrice;
  posCollateralVal.textContent = `$${collateralValue.toFixed(2)}`;
  posColPrice.textContent = `$${data.xstockPrice.toFixed(2)}`;
  const ltv = (1400 / collateralValue) * 100;
  posLtv.textContent = `${ltv.toFixed(2)}%`;

  actionStatusText.textContent = data.consumerEligibility;

  // Reset button state
  btnExecute.disabled = false;
  btnText.textContent = 'Attempt Liquidation';
}

function startStalenessTicker() {
  setInterval(() => {
    secondsAgo += 1;
    timestampEl.textContent = `Last checked: ${secondsAgo} seconds ago`;
  }, 1000);
}

// ── Interactive Terminal Simulator ───────────────────────────────────────────
function logTerminal(msg, type = 'log-dim') {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-dim">[${timeStr}]</span> <span class="${type}">${msg}</span>`;
  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

function setupExecutionHandler() {
  btnExecute.addEventListener('click', async () => {
    if (isExecuting) return;
    isExecuting = true;
    btnExecute.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.textContent = 'Executing CPI Call...';

    const data = SCENARIOS[currentScenario];
    logTerminal(`------------------------------------------------`, 'log-dim');
    logTerminal(`TX SUBMIT: Call consumer::attempt_liquidate()`, 'log-info');
    logTerminal(`Program: 9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9`, 'log-dim');

    await sleep(400);
    logTerminal(`[CPI] Invoking Sentinel Program: DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW`, 'log-cpi');
    logTerminal(`[CPI] Instruction: check_price_safety`, 'log-cpi');
    logTerminal(`[Sentinel] Reading Equity Feed: Equity.US.AAPL/USD ($${data.equityPrice.toFixed(2)})`, 'log-dim');
    logTerminal(`[Sentinel] Reading xStock Feed: Crypto.AAPLX/USD ($${data.xstockPrice.toFixed(2)})`, 'log-dim');

    await sleep(500);

    if (data.liquidationOutcome === 'success') {
      logTerminal(`[Sentinel] SAFE: Spread ${data.deviationBps.toFixed(1)} bps <= 200 bps, Age ${data.stalenessSeconds}s <= 300s`, 'log-success');
      logTerminal(`[Sentinel] PriceSafetyResult::Safe returned via CPI`, 'log-success');
      await sleep(300);
      logTerminal(`[Consumer] CPI Check PASSED. Checking LTV eligibility...`, 'log-info');
      logTerminal(`[Consumer] LTV=7580 bps >= Threshold=7500 bps -> LIQUIDATION CONFIRMED`, 'log-success');
      logTerminal(`SUCCESS: LendingPosition marked liquidated on-chain. Signature: 4vW2...pQ8z`, 'log-success');
      btnText.textContent = '✅ Liquidation Executed';
    } else if (data.liquidationOutcome === 'stale_block') {
      logTerminal(`[Sentinel] STALE: equity_age=${data.stalenessSeconds}s exceeds max_staleness=300s`, 'log-fail');
      logTerminal(`[Sentinel] PriceSafetyResult::Stale { seconds_stale: 494 } returned`, 'log-fail');
      await sleep(300);
      logTerminal(`[Consumer] CPI REVERT: PriceStale (Error 6001)`, 'log-fail');
      logTerminal(`BLOCKED: "Sentinel: BLOCKED — price stale by 8m 14s"`, 'log-fail');
      logTerminal(`Transaction rejected by on-chain safety gate. Position protected.`, 'log-warn');
      btnText.textContent = '❌ Blocked (Price Stale)';
    } else if (data.liquidationOutcome === 'divergent_block') {
      logTerminal(`[Sentinel] DIVERGENT: Spread 312 bps exceeds limit 200 bps`, 'log-fail');
      logTerminal(`[Sentinel] PriceSafetyResult::Divergent { actual_bps: 312, limit_bps: 200 } returned`, 'log-fail');
      await sleep(300);
      logTerminal(`[Consumer] CPI REVERT: PriceDivergent (Error 6002)`, 'log-fail');
      logTerminal(`BLOCKED: "Sentinel: BLOCKED — spread 312bps exceeds limit 200bps"`, 'log-fail');
      logTerminal(`Transaction rejected by on-chain safety gate. Position protected.`, 'log-warn');
      btnText.textContent = '❌ Blocked (Price Divergent)';
    }

    btnSpinner.classList.add('hidden');
    isExecuting = false;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Copy Code Snippet ────────────────────────────────────────────────────────
function setupCopyButton() {
  const btnCopy = document.getElementById('btn-copy-code');
  btnCopy.addEventListener('click', () => {
    const code = `let cpi_ctx = CpiContext::new(
    ctx.accounts.sentinel_program.key(),
    CheckPriceSafety {
        config: ctx.accounts.sentinel_config.to_account_info(),
        equity_price_update: ctx.accounts.equity_price.to_account_info(),
        xstock_price_update: ctx.accounts.xstock_price.to_account_info(),
        clock: ctx.accounts.clock.to_account_info(),
    },
);
let safety = sentinel::cpi::check_price_safety(cpi_ctx)?.get();
require!(safety == PriceSafetyResult::Safe, ErrorCode::UnsafePrice);`;

    navigator.clipboard.writeText(code).then(() => {
      btnCopy.textContent = 'Copied!';
      setTimeout(() => btnCopy.textContent = 'Copy', 2000);
    });
  });
}

// ── PreStocks Public API Integration ──────────────────────────────────────────
async function fetchPrestocksData() {
  try {
    const res = await fetch('https://prestocks.com/api/prestocks');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data)) {
      const anduril = data.find(i => i.symbol === 'ANDURIL');
      const anthropic = data.find(i => i.symbol === 'ANTHROPIC');
      const figure = data.find(i => i.symbol === 'FIGUREAI');

      if (anduril) {
        document.getElementById('anduril-token-price').textContent = `$${parseFloat(anduril.tokenPrice).toFixed(2)}`;
        document.getElementById('anduril-mark-price').textContent = `Mark: $${parseFloat(anduril.markPrice).toFixed(2)}`;
      }
      if (anthropic) {
        document.getElementById('anthropic-token-price').textContent = `$${parseFloat(anthropic.tokenPrice).toFixed(2)}`;
        document.getElementById('anthropic-mark-price').textContent = `Mark: $${parseFloat(anthropic.markPrice).toFixed(2)}`;
      }
      if (figure) {
        document.getElementById('figure-token-price').textContent = `$${parseFloat(figure.tokenPrice).toFixed(2)}`;
        document.getElementById('figure-mark-price').textContent = `Mark: $${parseFloat(figure.markPrice).toFixed(2)}`;
      }
      logTerminal(`Connected to PreStocks Public API: Live data ingested`, 'log-success');
    }
  } catch (err) {
    // Graceful fallback to static cached values so the demo never fails
    console.warn('PreStocks fetch fallback:', err);
    logTerminal(`PreStocks API: Loaded pre-IPO catalog (cached)`, 'log-dim');
  }
}

// Start application
window.addEventListener('DOMContentLoaded', init);
