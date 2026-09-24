pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
// Glob re-export each instruction module's contents to crate root so
// Anchor's #[program] macro can resolve __cpi_client_accounts_* items.
pub use instructions::check_price_safety::*;
pub use instructions::initialize::*;
pub use state::*;

declare_id!("DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW");

#[program]
pub mod sentinel {
    use super::*;

    /// Initialize the Sentinel config account for a given stock pair.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, params)
    }

    /// Check whether the price for a tokenized stock is currently safe to act on.
    /// Returns Safe, Stale, or Divergent.
    /// Designed to be called via CPI from any other Solana program.
    pub fn check_price_safety(ctx: Context<CheckPriceSafety>) -> Result<PriceSafetyResult> {
        instructions::check_price_safety::handle_check_price_safety(ctx)
    }
}
