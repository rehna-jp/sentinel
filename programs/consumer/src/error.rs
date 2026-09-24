use anchor_lang::prelude::*;

#[error_code]
pub enum ConsumerError {
    #[msg("Price is stale — cannot act on an outdated price")]
    PriceStale,

    #[msg("Price is divergent — on-chain price has deviated too far from real market")]
    PriceDivergent,

    #[msg("Position is not eligible for liquidation (LTV below threshold)")]
    NotLiquidatable,

    #[msg("Position is already liquidated")]
    AlreadyLiquidated,

    #[msg("Borrow amount would exceed the liquidation threshold")]
    BorrowExceedsThreshold,
}
