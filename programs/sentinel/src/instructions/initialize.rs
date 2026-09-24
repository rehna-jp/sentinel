use anchor_lang::prelude::*;
use crate::state::{SentinelConfig};
use crate::constants::ANCHOR_DISCRIMINATOR;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub max_staleness_seconds: u64,
    pub max_deviation_bps: u64,
    pub equity_feed_id: [u8; 32],
    pub xstock_feed_id: [u8; 32],
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR + SentinelConfig::INIT_SPACE,
        seeds = [b"sentinel_config", authority.key().as_ref()],
        bump
    )]
    pub config: Account<'info, SentinelConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.equity_feed_id = params.equity_feed_id;
    config.xstock_feed_id = params.xstock_feed_id;
    config.max_staleness_seconds = params.max_staleness_seconds;
    config.max_deviation_bps = params.max_deviation_bps;
    config.bump = ctx.bumps.config;

    msg!(
        "Sentinel initialized: staleness={}s deviation={}bps",
        config.max_staleness_seconds,
        config.max_deviation_bps
    );

    Ok(())
}
