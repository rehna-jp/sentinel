# Sentinel 🛡️
### *Know Before You Trade — Tokenized Stock Price Safety, On-Chain*

**Hackathon:** Stocklana (Solana Foundation)  
**Targets:** 
- 🏆 **Pyth Network Bounty ($10,000)**: Pyth price feeds drive the entire safety validation engine.
- 🏆 **PreStocks Bounty ($10,000)**: Live pre-IPO price discovery comparison matrix integrated into the dashboard.
- 🏆 **Infrastructure Track ($100,000 Main Pool)**: CPI-callable price safety gate reusable by any Solana DEX, perps, or lending protocol.

---

## 1. The Problem

Tokenized stocks trade **24/7 on Solana**, but real-world equities do not. When a retail trader buys an on-chain stock at 2:00 AM on Sunday:
- The reference market has been closed for days.
- The on-chain price can drift or depeg silently.
- Lending protocols and liquidation bots can act on stale or divergent prices, triggering unfair liquidations.

Nothing warned them. **Sentinel does.**

---

## 2. What Sentinel Is

Sentinel is a **two-sided solution**:
1. **For Traders (The Dashboard)**: A real-time safety surface showing the complete price discovery chain: **Pre-IPO Tier** (PreStocks API), **On-Chain xStock** (Pyth Crypto feed), and **Real-World Equity** (Pyth Equity feed), with a clear traffic-light verdict: **Safe**, **Stale**, or **Divergent**.
2. **For Protocols (The On-Chain Safety Primitive)**: A high-performance Solana program that any DeFi protocol can invoke via Cross-Program Invocation (CPI) before executing trades or liquidations.

---

## 3. How Protocols Integrate Sentinel (One Line of Rust)

```rust
use sentinel::cpi::accounts::CheckPriceSafety;
use sentinel::state::PriceSafetyResult;

// 1. Call Sentinel CPI before touching prices:
let cpi_ctx = CpiContext::new(
    ctx.accounts.sentinel_program.key(),
    CheckPriceSafety {
        config: ctx.accounts.sentinel_config.to_account_info(),
        equity_price_update: ctx.accounts.equity_price.to_account_info(),
        xstock_price_update: ctx.accounts.xstock_price.to_account_info(),
        clock: ctx.accounts.clock.to_account_info(),
    },
);

let safety = sentinel::cpi::check_price_safety(cpi_ctx)?.get();

// 2. Gate execution:
require!(safety == PriceSafetyResult::Safe, ErrorCode::UnsafePrice);
```

---

## 4. Live Deployed Programs on Solana Devnet

| Component | Program ID | Solscan Link | Solana Explorer |
|---|---|---|---|
| **Sentinel Checker** | `DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW` | [Solscan Devnet](https://solscan.io/account/DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW?cluster=devnet) | [Solana Explorer](https://explorer.solana.com/address/DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW?cluster=devnet) |
| **Consumer Protocol** | `9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9` | [Solscan Devnet](https://solscan.io/account/9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9?cluster=devnet) | [Solana Explorer](https://explorer.solana.com/address/9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9?cluster=devnet) |

- **Upgrade Authority:** `296KKHsmDSA2ENiJ4YdDZ62Hrw5JePKYBtfV3MSsSGnW`
- **Pyth Equity Feed:** `Equity.US.AAPL/USD`
- **Pyth xStock Feed:** `Crypto.AAPLX/USD`
- **Pre-IPO Data:** [PreStocks Public API](https://prestocks.com/api/prestocks)

---

## 5. Verified with LiteSVM (Anchor 1.2.0 + Rust Integration Tests)

Sentinel and the Consumer protocol have been tested in LiteSVM across all three operating conditions:

```bash
cargo test --workspace
```

### Test Results:
```text
running 3 tests
test test_consumer_stale_blocked ... ok
test test_consumer_safe_liquidation ... ok
test test_consumer_divergent_blocked ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; finished in 0.09s

running 3 tests
test test_stale_state ... ok
test test_divergent_state ... ok
test test_safe_state ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; finished in 0.07s

running 1 test
test test_initialize ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; finished in 0.07s
```

All 7 test cases pass deterministically in under 1 second.

---

## 6. Three Demo Scenes

1. **Scene 1: Normal Market (Safe)**
   - Both feeds fresh (< 5s), spread = 10.8 bps (within 200 bps threshold).
   - "Attempt Liquidation" succeeds and updates the position on-chain.
2. **Scene 2: Market Closed / Weekend (Stale)**
   - Equity feed timestamp is 494s old (exceeds 300s limit).
   - Dashboard flags `🔴 STALE — DO NOT TRADE`.
   - "Attempt Liquidation" is rejected with `ConsumerError::PriceStale` (`"Sentinel: BLOCKED — price stale by 8m 14s"`).
3. **Scene 3: Depeg / Liquidity Shock (Divergent)**
   - Token trades at $190.25 vs real equity $184.50 (spread = 312 bps > 200 bps limit).
   - Dashboard flags `🟠 DIVERGENT — UNTRUSTED PRICE`.
   - "Attempt Liquidation" is rejected with `ConsumerError::PriceDivergent` (`"Sentinel: BLOCKED — spread 312bps exceeds limit 200bps"`).

---

## 7. Running the Project Locally

### 1. Build On-Chain Programs
```bash
cargo build-sbf -- --package sentinel
cargo build-sbf -- --package consumer
```

### 2. Run Test Suite
```bash
cargo test --workspace
```

### 3. Launch Dashboard
```bash
python3 -m http.server 3300 --directory app
```
Open [http://localhost:3300](http://localhost:3300) in your browser.
