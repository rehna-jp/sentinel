use anchor_lang::prelude::*;

#[error_code]
pub enum SentinelError {
    #[msg("Price feed is stale — timestamp too old")]
    PriceStale,

    #[msg("Prices are divergent — spread exceeds configured limit")]
    PriceDivergent,

    #[msg("Pyth price is not available or invalid")]
    InvalidPrice,

    #[msg("Pyth price exponent out of supported range")]
    InvalidExponent,

    #[msg("Arithmetic overflow in price calculation")]
    ArithmeticOverflow,
}
