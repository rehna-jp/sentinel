use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};
use crate::state::{SentinelConfig, PriceSafetyResult};
use crate::error::SentinelError;

#[derive(Accounts)]
pub struct CheckPriceSafety<'info> {
    /// The Sentinel config for this stock pair
    pub config: Account<'info, SentinelConfig>,

    /// Pyth price update account for the real-world equity feed (e.g. Equity.US.AAPL/USD)
    pub equity_price_update: Account<'info, PriceUpdateV2>,

    /// Pyth price update account for the on-chain xStock feed (e.g. Crypto.AAPLX/USD)
    pub xstock_price_update: Account<'info, PriceUpdateV2>,

    /// Solana clock sysvar, used to determine staleness
    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_check_price_safety(ctx: Context<CheckPriceSafety>) -> Result<PriceSafetyResult> {
    let config = &ctx.accounts.config;
    let clock = &ctx.accounts.clock;
    let now = clock.unix_timestamp as u64;

    // ── 1. Read equity price ──────────────────────────────────────────────────
    let equity_price = ctx
        .accounts
        .equity_price_update
        .get_price_no_older_than_with_custom_verification_level(
            clock,
            // We handle staleness manually below for precise error messages;
            // use a large window here so Pyth doesn't reject before we can check.
            u32::MAX as u64,
            &config.equity_feed_id,
            VerificationLevel::Partial { num_signatures: 1 },
        )
        .map_err(|_| SentinelError::InvalidPrice)?;

    // ── 2. Read xstock price ──────────────────────────────────────────────────
    let xstock_price = ctx
        .accounts
        .xstock_price_update
        .get_price_no_older_than_with_custom_verification_level(
            clock,
            u32::MAX as u64,
            &config.xstock_feed_id,
            VerificationLevel::Partial { num_signatures: 1 },
        )
        .map_err(|_| SentinelError::InvalidPrice)?;

    // ── 3. Staleness check ────────────────────────────────────────────────────
    let equity_age = now.saturating_sub(equity_price.publish_time as u64);
    let xstock_age = now.saturating_sub(xstock_price.publish_time as u64);
    let max_age = config.max_staleness_seconds;

    if equity_age > max_age || xstock_age > max_age {
        let seconds_stale = equity_age.max(xstock_age);
        msg!(
            "STALE: equity_age={}s xstock_age={}s limit={}s",
            equity_age,
            xstock_age,
            max_age
        );
        return Ok(PriceSafetyResult::Stale { seconds_stale });
    }

    // ── 4. Normalise prices to the same exponent ──────────────────────────────
    // Pyth prices come with a (possibly negative) exponent.
    // We convert both to u64 integer cents (price * 10^6) for integer-safe comparison.
    let equity_norm = normalize_price(equity_price.price, equity_price.exponent)?;
    let xstock_norm = normalize_price(xstock_price.price, xstock_price.exponent)?;

    // ── 5. Divergence check ───────────────────────────────────────────────────
    // deviation_bps = |equity - xstock| / equity * 10_000
    let diff = equity_norm.abs_diff(xstock_norm);
    let actual_bps = diff
        .checked_mul(10_000)
        .and_then(|n| n.checked_div(equity_norm))
        .ok_or(SentinelError::ArithmeticOverflow)?;

    if actual_bps > config.max_deviation_bps {
        msg!(
            "DIVERGENT: equity={} xstock={} spread={}bps limit={}bps",
            equity_norm,
            xstock_norm,
            actual_bps,
            config.max_deviation_bps
        );
        return Ok(PriceSafetyResult::Divergent {
            actual_bps,
            limit_bps: config.max_deviation_bps,
        });
    }

    // ── 6. All clear ─────────────────────────────────────────────────────────
    msg!(
        "SAFE: equity={} xstock={} spread={}bps equity_age={}s xstock_age={}s",
        equity_norm,
        xstock_norm,
        actual_bps,
        equity_age,
        xstock_age
    );
    Ok(PriceSafetyResult::Safe)
}

/// Convert a Pyth (price, exponent) pair into a u64 scaled to 6 decimal places.
/// This makes integer arithmetic safe regardless of which feed has a larger exponent.
fn normalize_price(price: i64, exponent: i32) -> Result<u64> {
    // Target: price * 10^6
    // If exponent = -8, scale = 10^(6 - 8) = 10^-2 → divide by 100
    // If exponent = -5, scale = 10^(6 - 5) = 10^1  → multiply by 10
    let target_exp: i32 = -6;
    let shift = exponent - target_exp; // how far the exponent is from our target

    require!(price >= 0, SentinelError::InvalidPrice);
    let price_u64 = price as u64;

    let normalized = if shift >= 0 {
        // Need to multiply
        let multiplier = 10u64
            .checked_pow(shift as u32)
            .ok_or(SentinelError::InvalidExponent)?;
        price_u64
            .checked_mul(multiplier)
            .ok_or(SentinelError::ArithmeticOverflow)?
    } else {
        // Need to divide
        let divisor = 10u64
            .checked_pow((-shift) as u32)
            .ok_or(SentinelError::InvalidExponent)?;
        price_u64 / divisor
    };

    Ok(normalized)
}
