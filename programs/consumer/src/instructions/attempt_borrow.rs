use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use sentinel::state::PriceSafetyResult;
use sentinel::program::Sentinel;
use crate::state::LendingPosition;
use crate::error::ConsumerError;

#[derive(Accounts)]
pub struct AttemptBorrow<'info> {
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [b"lending_position", borrower.key().as_ref()],
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

pub fn handle_attempt_borrow(ctx: Context<AttemptBorrow>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.position.is_liquidated, ConsumerError::AlreadyLiquidated);

    // ── 1. Sentinel safety gate ───────────────────────────────────────────────
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

    match safety_result {
        PriceSafetyResult::Safe => {
            msg!("Sentinel: SAFE — proceeding with borrow");
        }
        PriceSafetyResult::Stale { seconds_stale } => {
            let minutes = seconds_stale / 60;
            let secs = seconds_stale % 60;
            msg!("Sentinel: BLOCKED — price stale by {}m {}s", minutes, secs);
            return err!(ConsumerError::PriceStale);
        }
        PriceSafetyResult::Divergent { actual_bps, limit_bps } => {
            msg!("Sentinel: BLOCKED — spread {}bps exceeds limit {}bps", actual_bps, limit_bps);
            return err!(ConsumerError::PriceDivergent);
        }
    }

    // ── 2. Check new borrow wouldn't breach threshold ─────────────────────────
    let position = &ctx.accounts.position;
    let new_borrowed = position.borrowed_usdc.saturating_add(amount);
    let new_ltv = new_borrowed
        .saturating_mul(10_000)
        .checked_div(position.collateral_value_usd)
        .unwrap_or(10_000);

    require!(
        new_ltv < position.liquidation_threshold_bps,
        ConsumerError::BorrowExceedsThreshold
    );

    // ── 3. Execute borrow ─────────────────────────────────────────────────────
    let position = &mut ctx.accounts.position;
    position.borrowed_usdc = new_borrowed;
    msg!(
        "Borrow executed: amount=${} new_total=${} new_LTV={}bps",
        amount / 1_000_000,
        position.borrowed_usdc / 1_000_000,
        position.ltv_bps(),
    );

    Ok(())
}
