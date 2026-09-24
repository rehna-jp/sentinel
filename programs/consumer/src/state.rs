use anchor_lang::prelude::*;

/// A mock lending position.
/// Real-feeling numbers, minimal account structure.
#[account]
#[derive(InitSpace)]
pub struct LendingPosition {
    pub owner: Pubkey,
    /// Collateral in AAPLX tokens (scaled by 10^6)
    pub collateral_tokens: u64,
    /// Collateral value in USD (scaled by 10^6, i.e. $1 = 1_000_000)
    pub collateral_value_usd: u64,
    /// Amount borrowed in USDC (scaled by 10^6)
    pub borrowed_usdc: u64,
    /// Liquidation threshold in basis points (e.g. 7500 = 75%)
    pub liquidation_threshold_bps: u64,
    /// Whether this position has been liquidated
    pub is_liquidated: bool,
    pub bump: u8,
}

impl LendingPosition {
    /// Current LTV in basis points
    pub fn ltv_bps(&self) -> u64 {
        if self.collateral_value_usd == 0 {
            return 10_000; // 100% — fully underwater
        }
        self.borrowed_usdc
            .saturating_mul(10_000)
            / self.collateral_value_usd
    }
}
