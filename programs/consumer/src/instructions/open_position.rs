use anchor_lang::prelude::*;
use crate::state::LendingPosition;
use crate::constants::{ANCHOR_DISCRIMINATOR, DEFAULT_LIQUIDATION_THRESHOLD_BPS};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct OpenPositionParams {
    /// Number of AAPLX tokens as collateral (scaled by 10^6)
    pub collateral_tokens: u64,
    /// Current USD value of the collateral (scaled by 10^6)
    pub collateral_value_usd: u64,
    /// Amount borrowed in USDC (scaled by 10^6)
    pub borrowed_usdc: u64,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = ANCHOR_DISCRIMINATOR + LendingPosition::INIT_SPACE,
        seeds = [b"lending_position", owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, LendingPosition>,

    pub system_program: Program<'info, System>,
}

pub fn handle_open_position(
    ctx: Context<OpenPosition>,
    params: OpenPositionParams,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    position.owner = ctx.accounts.owner.key();
    position.collateral_tokens = params.collateral_tokens;
    position.collateral_value_usd = params.collateral_value_usd;
    position.borrowed_usdc = params.borrowed_usdc;
    position.liquidation_threshold_bps = DEFAULT_LIQUIDATION_THRESHOLD_BPS;
    position.is_liquidated = false;
    position.bump = ctx.bumps.position;

    msg!(
        "Position opened: collateral=${} borrowed=${} LTV={}bps threshold={}bps",
        position.collateral_value_usd / 1_000_000,
        position.borrowed_usdc / 1_000_000,
        position.ltv_bps(),
        position.liquidation_threshold_bps,
    );

    Ok(())
}
