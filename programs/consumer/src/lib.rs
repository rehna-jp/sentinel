pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::attempt_borrow::*;
pub use instructions::attempt_liquidate::*;
pub use instructions::open_position::*;
pub use state::*;

declare_id!("9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9");

#[program]
pub mod consumer {
    use super::*;

    /// Open a mock lending position — stores collateral and borrow amounts.
    pub fn open_position(ctx: Context<OpenPosition>, params: OpenPositionParams) -> Result<()> {
        instructions::open_position::handle_open_position(ctx, params)
    }

    /// Attempt to liquidate a position.
    /// Calls Sentinel's check_price_safety via CPI first.
    /// Reverts with a descriptive error if the price is not Safe.
    pub fn attempt_liquidate(ctx: Context<AttemptLiquidate>) -> Result<()> {
        instructions::attempt_liquidate::handle_attempt_liquidate(ctx)
    }

    /// Attempt to borrow against a position.
    /// Same safety gate as liquidate.
    pub fn attempt_borrow(ctx: Context<AttemptBorrow>, amount: u64) -> Result<()> {
        instructions::attempt_borrow::handle_attempt_borrow(ctx, amount)
    }
}
