use anchor_lang::prelude::*;

/// The on-chain config for a Sentinel price-safety check.
/// One account per stock pair (equity feed + xstock feed).
#[account]
#[derive(InitSpace)]
pub struct SentinelConfig {
    /// Authority that can update config params
    pub authority: Pubkey,
    /// Pyth feed ID for the real-world equity price (e.g. Equity.US.AAPL/USD)
    pub equity_feed_id: [u8; 32],
    /// Pyth feed ID for the on-chain xStock price (e.g. Crypto.AAPLX/USD)
    pub xstock_feed_id: [u8; 32],
    /// How old a price timestamp can be (in seconds) before it's considered Stale
    pub max_staleness_seconds: u64,
    /// Max allowed spread between equity and xstock prices, in basis points (1 bps = 0.01%)
    pub max_deviation_bps: u64,
    /// Bump seed for the config PDA
    pub bump: u8,
}

/// The result of a price safety check.
/// Returned from check_price_safety and used by consumer programs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum PriceSafetyResult {
    /// Both feeds are fresh and within the allowed spread — safe to act
    Safe,
    /// One or both feeds are too old — do not act on this price
    Stale {
        /// Seconds since the stale feed was last updated
        seconds_stale: u64,
    },
    /// Feeds are fresh but diverged beyond the allowed threshold — suspicious
    Divergent {
        /// Spread between feeds, in basis points
        actual_bps: u64,
        /// The configured limit
        limit_bps: u64,
    },
}
