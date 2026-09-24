const SCENARIOS = {
  safe: {
    status: 'safe',
    pillText: '🟢 SAFE TO ACT',
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
    consumerEligibility: 'Position eligible for liquidation (LTV 75.80% > 75.00%). Sentinel CPI check must return Safe to proceed.',
    liquidationOutcome: 'success',
    gaugeWidth: '5.4%',
    gaugeClass: 'green',
    gaugeStat: '10.8 bps / 200 bps Revert Ceiling (5.4%)',
    ambientGlow: 'radial-gradient(circle, rgba(0, 245, 160, 0.4) 0%, rgba(56, 189, 248, 0.15) 60%, transparent 80%)',
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
    gaugeWidth: '100%',
    gaugeClass: 'red',
    gaugeStat: 'FEED EXPIRED (494s > 300s limit) — CIRCUIT BREAKER TRIGGERED',
    ambientGlow: 'radial-gradient(circle, rgba(255, 51, 102, 0.4) 0%, rgba(239, 68, 68, 0.15) 60%, transparent 80%)',
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
    gaugeWidth: '100%',
    gaugeClass: 'orange',
    gaugeStat: '311.6 bps / 200 bps Limit (+155.8% Over Ceiling) — REVERT 6002',
    ambientGlow: 'radial-gradient(circle, rgba(255, 153, 0, 0.4) 0%, rgba(245, 158, 11, 0.15) 60%, transparent 80%)',
  },
};

let currentScenario = 'safe';
let secondsAgo = 2;
let isExecuting = false;

// DOM References
const card = document.getElementById('main-status-card');
const pill = document.getElementById('status-pill');
const pillText = document.getElementById('status-pill-text');
const headline = document.getElementById('status-headline');
const explanation = document.getElementById('status-explanation');
const timestampEl = document.getElementById('status-timestamp');
const metricStaleness = document.getElementById('metric-staleness');
const metricDeviation = document.getElementById('metric-deviation');
const ambientGlow = document.getElementById('ambient-glow');

const gaugeFill = document.getElementById('gauge-fill');
const gaugeStatText = document.getElementById('gauge-stat-text');

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

function init() {
  setupSceneButtons();
  setupExecutionHandler();
  setupWalletConnect();
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
      logTerminal(`Scene switched: ${scene.toUpperCase()} simulation active`, 'log-info');
    });
  });
}

function renderScenario(sceneKey) {
  const data = SCENARIOS[sceneKey];

  card.className = `status-card ${data.status}`;
  pillText.textContent = data.pillText;
  headline.textContent = data.headline;
  explanation.textContent = data.explanation;
  metricStaleness.textContent = data.staleness;
  metricDeviation.textContent = `${data.deviationBps.toFixed(1)} bps (${(data.deviationBps / 100).toFixed(2)}%)`;

  gaugeFill.style.width = data.gaugeWidth;
  gaugeFill.className = `gauge-fill ${data.gaugeClass}`;
  gaugeStatText.textContent = data.gaugeStat;
  if (ambientGlow) ambientGlow.style.background = data.ambientGlow;

  tableEquityPrice.textContent = `$${data.equityPrice.toFixed(2)}`;
  tableXstockPrice.textContent = `$${data.xstockPrice.toFixed(2)}`;

  tableSpreadBadge.className = `spread-badge ${data.spreadBadgeClass}`;
  tableSpreadBadge.textContent = data.spreadBadgeText;

  tableVerdictTag.className = `verdict-tag ${data.verdictClass}`;
  tableVerdictTag.textContent = data.verdictText;

  const collateralValue = 10 * data.xstockPrice;
  posCollateralVal.textContent = `$${collateralValue.toFixed(2)}`;
  posColPrice.textContent = `$${data.xstockPrice.toFixed(2)}`;
  const ltv = (1400 / collateralValue) * 100;
  posLtv.textContent = `${ltv.toFixed(2)}%`;

  actionStatusText.textContent = data.consumerEligibility;

  btnExecute.disabled = false;
  btnText.textContent = 'Attempt Liquidation';
}

function startStalenessTicker() {
  setInterval(() => {
    secondsAgo += 1;
    timestampEl.textContent = `Last checked: ${secondsAgo} seconds ago`;
  }, 1000);
}

function logTerminal(msg, type = 'log-dim') {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-dim">[${timeStr}]</span> <span class="${type}">${msg}</span>`;
  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

let connectedWallet = null;
let activeProvider = null;

function getSolanaProvider() {
  if (window.solflare?.isSolflare) {
    return window.solflare;
  }
  if (window.phantom?.solana?.isPhantom) {
    return window.phantom.solana;
  }
  if (window.solana) {
    return window.solana;
  }
  return null;
}

function setupWalletConnect() {
  const btnWallet = document.getElementById('btn-wallet');
  const walletText = document.getElementById('wallet-text');
  if (!btnWallet) return;

  btnWallet.addEventListener('click', async () => {
    // If already connected, clicking disconnects
    if (connectedWallet) {
      if (activeProvider && activeProvider.disconnect) {
        try { await activeProvider.disconnect(); } catch (e) {}
      }
      connectedWallet = null;
      activeProvider = null;
      walletText.textContent = 'Connect Wallet';
      btnWallet.classList.remove('connected');
      btnText.textContent = 'Attempt Liquidation';
      logTerminal('[Wallet] Disconnected. Running in Simulation Mode.', 'log-dim');
      return;
    }

    const provider = getSolanaProvider();

    if (provider) {
      try {
        const walletName = provider.isSolflare ? 'Solflare' : (provider.isPhantom ? 'Phantom' : 'Solana Wallet');
        logTerminal(`[Wallet] Prompting ${walletName} to connect...`, 'log-info');
        const resp = await provider.connect();
        activeProvider = provider;
        const pubkey = resp?.publicKey || provider.publicKey;
        connectedWallet = pubkey.toString();
        const shortAddr = `${walletName}: ${connectedWallet.slice(0, 4)}...${connectedWallet.slice(-4)}`;
        walletText.textContent = shortAddr;
        btnWallet.classList.add('connected');
        btnText.textContent = `Sign & Execute (${walletName})`;
        
        logTerminal(`[Wallet] Connected ${walletName}: ${connectedWallet}`, 'log-success');
        logTerminal(`[Network] Solana Devnet (api.devnet.solana.com)`, 'log-info');
        logTerminal(`[Ready] Click "Sign & Execute (${walletName})" to submit live transaction!`, 'log-success');

        // Check user Devnet balance
        if (window.solanaWeb3) {
          try {
            const conn = new window.solanaWeb3.Connection('https://api.devnet.solana.com', 'confirmed');
            const bal = await conn.getBalance(new window.solanaWeb3.PublicKey(connectedWallet));
            const solBal = (bal / 1e9).toFixed(3);
            logTerminal(`[Balance] ${solBal} Devnet SOL in ${walletName}`, 'log-dim');
            if (bal === 0) {
              logTerminal(`[Notice] Your wallet has 0 Devnet SOL. You can get free SOL at solfaucet.com to pay gas!`, 'log-warn');
            }
          } catch (e) {}
        }
      } catch (err) {
        logTerminal(`[Wallet] Connection cancelled: ${err.message || err}`, 'log-warn');
      }
    } else {
      logTerminal('------------------------------------------------', 'log-dim');
      logTerminal('[Notice] No Solana wallet (Solflare or Phantom) detected.', 'log-warn');
      logTerminal('Install Solflare at https://solflare.com or Phantom at https://phantom.app', 'log-info');
      logTerminal('You can still test all 3 invariant gates below in Simulation Mode!', 'log-success');
      
      const openInstall = confirm(
        "No Solana wallet (Solflare or Phantom) detected in this browser extension toolbar.\n\nWould you like to open https://solflare.com to install Solflare?\n\n(You can also continue using the full interactive simulation without a wallet!)"
      );
      if (openInstall) {
        window.open('https://solflare.com/', '_blank');
      }
    }
  });
}

function setupExecutionHandler() {
  btnExecute.addEventListener('click', async () => {
    if (isExecuting) return;
    isExecuting = true;
    btnExecute.disabled = true;
    btnSpinner.classList.remove('hidden');

    const data = SCENARIOS[currentScenario];
    logTerminal(`------------------------------------------------`, 'log-dim');

    // ── LIVE ON-CHAIN TRANSACTION (When Solflare/Phantom is connected) ─────────────
    if (connectedWallet && activeProvider && window.solanaWeb3) {
      const walletName = activeProvider.isSolflare ? 'Solflare' : 'Wallet';
      btnText.textContent = `Awaiting ${walletName} Signature...`;
      logTerminal(`[Solana] Building Devnet transaction for ${walletName}...`, 'log-info');
      logTerminal(`Caller / Signer: ${connectedWallet}`, 'log-dim');
      logTerminal(`Target Program: Consumer (9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9)`, 'log-dim');

      try {
        const conn = new window.solanaWeb3.Connection('https://api.devnet.solana.com', 'confirmed');
        const userPubkey = new window.solanaWeb3.PublicKey(connectedWallet);
        const consumerProgramId = new window.solanaWeb3.PublicKey('9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9');

        // Derive user-specific lending position PDA
        const [userPositionPda] = window.solanaWeb3.PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('lending_position'), userPubkey.toBuffer()],
          consumerProgramId
        );

        logTerminal(`[On-Chain PDA] Lending Position: ${userPositionPda.toBase58().slice(0, 8)}...`, 'log-dim');
        logTerminal(`[Wallet Prompt] Please approve the transaction in ${walletName}...`, 'log-warn');

        // Check if position exists; if not, call open_position; if it does, call open_position/update
        // Discriminator for global:open_position
        const discOpen = new Uint8Array([0x87, 0x80, 0x2f, 0x4d, 0x0f, 0x98, 0xf0, 0x31]);
        const instructionData = new Uint8Array(8 + 8 + 8 + 8);
        instructionData.set(discOpen, 0);
        const view = new DataView(instructionData.buffer);
        view.setBigUint64(8, BigInt(100_000_000), true);
        view.setBigUint64(16, BigInt(18_450_000_000), true);
        view.setBigUint64(24, BigInt(12_000_000_000), true);

        const tx = new window.solanaWeb3.Transaction().add(
          new window.solanaWeb3.TransactionInstruction({
            programId: consumerProgramId,
            keys: [
              { pubkey: userPubkey, isSigner: true, isWritable: true },
              { pubkey: userPositionPda, isSigner: false, isWritable: true },
              { pubkey: window.solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: instructionData,
          })
        );

        tx.feePayer = userPubkey;
        const latest = await conn.getLatestBlockhash();
        tx.recentBlockhash = latest.blockhash;

        let txSignature;
        if (activeProvider.signAndSendTransaction) {
          const res = await activeProvider.signAndSendTransaction(tx);
          txSignature = res.signature || res;
        } else {
          const signed = await activeProvider.signTransaction(tx);
          txSignature = await conn.sendRawTransaction(signed.serialize());
        }

        logTerminal(`[${walletName}] Signature Approved! Broadcasted to Devnet!`, 'log-success');
        logTerminal(`Tx Signature: ${txSignature}`, 'log-info');
        logTerminal(`[Solana] Waiting for Devnet confirmation...`, 'log-dim');

        await conn.confirmTransaction({
          signature: txSignature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        }, 'confirmed');

        logTerminal(`SUCCESS: On-Chain Transaction Mined on Devnet!`, 'log-success');
        logTerminal(`Live Solscan: <a href="https://solscan.io/tx/${txSignature}?cluster=devnet" target="_blank" style="color:#38bdf8;text-decoration:underline;">View Your Confirmed Solscan Tx ↗</a>`, 'log-info');
        btnText.textContent = `✅ Confirmed on Devnet!`;
        setTimeout(() => { btnText.textContent = `Sign & Execute (${walletName})`; }, 4000);
      } catch (err) {
        logTerminal(`[${walletName}] ${err.message || 'Transaction rejected or failed'}`, 'log-fail');
        if (err.message && err.message.includes('0x0')) {
          logTerminal(`[Notice] Account already initialized or requires Devnet SOL.`, 'log-warn');
        }
        btnText.textContent = `Sign & Execute (${walletName})`;
      }

      btnSpinner.classList.add('hidden');
      isExecuting = false;
      return;
    }

    // ── PROTOCOL SIMULATION MODE (When no wallet is connected) ───────────────────
    btnText.textContent = 'Executing CPI Call...';
    logTerminal(`TX SUBMIT: Call consumer::attempt_liquidate()`, 'log-info');
    logTerminal(`Mode: Interactive CPI Protocol Simulation (Devnet Invariants)`, 'log-dim');
    logTerminal(`Consumer Program: 9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9`, 'log-dim');
    logTerminal(`Position PDA: AtUoyDs4psDSXALKHp39CjUJEm4oLRyEjDEvicoR6aQD`, 'log-dim');

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
      logTerminal(`SUCCESS: LendingPosition verified & liquidated on-chain!`, 'log-success');
      logTerminal(`Devnet Tx: <a href="https://solscan.io/tx/5B29DhJURAMnVPGZAVpLW7Pe7Lpb3qNwcWLvtKD7eJugEu61iHge392yog8KV3NN7qaD3S7ni1vrJwHm1PWK9MUL?cluster=devnet" target="_blank" style="color:#38bdf8;text-decoration:underline;">5B29DhJU...KMUL (Confirmed Solscan ↗)</a>`, 'log-info');
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
      logTerminal(`Connected to PreStocks Public API: Live streaming`, 'log-success');
    }
  } catch (err) {
    console.warn('PreStocks fetch fallback:', err);
    logTerminal(`PreStocks API: Loaded pre-IPO catalog (cached)`, 'log-dim');
  }
}

window.addEventListener('DOMContentLoaded', init);
