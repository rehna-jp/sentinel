use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use sentinel::state::PriceSafetyResult;
use sentinel::program::Sentinel;
use crate::state::LendingPosition;
use crate::error::ConsumerError;

#[derive(Accounts)]
pub struct AttemptLiquidate<'info> {
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lending_position", position.owner.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, LendingPosition>,

    // ── Sentinel accounts ────────────────────────────────────────────────────
    /// CHECK: Sentinel config PDA — owned and validated by the Sentinel program via CPI
    pub sentinel_config: UncheckedAccount<'info>,
    pub equity_price_update: Account<'info, PriceUpdateV2>,
    pub xstock_price_update: Account<'info, PriceUpdateV2>,
    pub sentinel_program: Program<'info, Sentinel>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_attempt_liquidate(ctx: Context<AttemptLiquidate>) -> Result<()> {
    require!(!ctx.accounts.position.is_liquidated, ConsumerError::AlreadyLiquidated);

    // ── 1. Call Sentinel — the safety gate ───────────────────────────────────
    let cpi_ctx = CpiContext::new(
        sentinel::ID,
        sentinel::cpi::accounts::CheckPriceSafety {
            config: ctx.accounts.sentinel_config.to_account_info(),
            equity_price_update: ctx.accounts.equity_price_update.to_account_info(),
            xstock_price_update: ctx.accounts.xstock_price_update.to_account_info(),
            clock: ctx.accounts.clock.to_account_info(),
        },
    );
    let safety_result = sentinel::cpi::check_price_safety(cpi_ctx)?.get();

    // ── 2. Gate on safety result ──────────────────────────────────────────────
    match safety_result {
        PriceSafetyResult::Safe => {
            msg!("Sentinel: SAFE — proceeding with liquidation");
        }
        PriceSafetyResult::Stale { seconds_stale } => {
            let minutes = seconds_stale / 60;
            let secs = seconds_stale % 60;
            msg!(
                "Sentinel: BLOCKED — price stale by {}m {}s",
                minutes,
                secs
            );
            return err!(ConsumerError::PriceStale);
        }
        PriceSafetyResult::Divergent { actual_bps, limit_bps } => {
            msg!(
                "Sentinel: BLOCKED — spread {}bps exceeds limit {}bps",
                actual_bps,
                limit_bps
            );
            return err!(ConsumerError::PriceDivergent);
        }
    }

    // ── 3. Check LTV eligibility ──────────────────────────────────────────────
    let position = &ctx.accounts.position;
    require!(
        position.ltv_bps() >= position.liquidation_threshold_bps,
        ConsumerError::NotLiquidatable
    );

    // ── 4. Execute liquidation ────────────────────────────────────────────────
    let position = &mut ctx.accounts.position;
    position.is_liquidated = true;
    msg!(
        "Liquidation executed: LTV={}bps threshold={}bps collateral=${} borrowed=${}",
        position.ltv_bps(),
        position.liquidation_threshold_bps,
        position.collateral_value_usd / 1_000_000,
        position.borrowed_usdc / 1_000_000,
    );

    Ok(())
}
