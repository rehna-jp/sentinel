use {
    anchor_lang::{
        prelude::{Pubkey, Clock},
        solana_program::{instruction::Instruction, sysvar::SysvarId},
        AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
    },
    consumer::{
        instruction::{AttemptLiquidate, OpenPosition},
        instructions::open_position::OpenPositionParams,
        state::LendingPosition,
    },
    litesvm::LiteSVM,
    pyth_solana_receiver_sdk::price_update::{
        PriceFeedMessage, PriceUpdateV2, VerificationLevel,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const EQUITY_FEED_ID: [u8; 32] = [1u8; 32];
const XSTOCK_FEED_ID: [u8; 32] = [2u8; 32];
const NOW: i64 = 1_700_000_000;

fn create_price_account_data(
    feed_id: [u8; 32],
    price: i64,
    exponent: i32,
    publish_time: i64,
) -> Vec<u8> {
    let update = PriceUpdateV2 {
        write_authority: Pubkey::default(),
        verification_level: VerificationLevel::Partial { num_signatures: 1 },
        price_message: PriceFeedMessage {
            feed_id,
            price,
            conf: 1000,
            exponent,
            publish_time,
            prev_publish_time: publish_time - 1,
            ema_price: price,
            ema_conf: 1000,
        },
        posted_slot: 100,
    };
    let mut data = Vec::new();
    update.try_serialize(&mut data).unwrap();
    data
}

struct ConsumerTestEnv {
    svm: LiteSVM,
    payer: Keypair,
    sentinel_id: Pubkey,
    consumer_id: Pubkey,
    sentinel_config: Pubkey,
}

fn setup_consumer_env() -> ConsumerTestEnv {
    let sentinel_id = sentinel::id();
    let consumer_id = consumer::id();
    let payer = Keypair::new();

    let mut svm = LiteSVM::new();

    let sentinel_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/sentinel.so"
    ));
    svm.add_program(sentinel_id, sentinel_bytes).unwrap();

    let consumer_bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/consumer.so"
    ));
    svm.add_program(consumer_id, consumer_bytes).unwrap();

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = NOW;
    svm.set_sysvar::<Clock>(&clock);

    // Initialize Sentinel config (max_staleness = 300s, max_deviation = 200 bps)
    let (sentinel_config, _bump) = Pubkey::find_program_address(
        &[b"sentinel_config", payer.pubkey().as_ref()],
        &sentinel_id,
    );

    let params = sentinel::instructions::initialize::InitializeParams {
        max_staleness_seconds: 300,
        max_deviation_bps: 200,
        equity_feed_id: EQUITY_FEED_ID,
        xstock_feed_id: XSTOCK_FEED_ID,
    };

    let init_ix = Instruction::new_with_bytes(
        sentinel_id,
        &sentinel::instruction::Initialize { params }.data(),
        sentinel::accounts::Initialize {
            authority: payer.pubkey(),
            config: sentinel_config,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx).expect("Failed to init Sentinel config");

    ConsumerTestEnv {
        svm,
        payer,
        sentinel_id,
        consumer_id,
        sentinel_config,
    }
}

fn open_test_position(env: &mut ConsumerTestEnv, borrower: &Keypair) -> Pubkey {
    env.svm.airdrop(&borrower.pubkey(), 1_000_000_000).unwrap();

    let (position_pda, _bump) = Pubkey::find_program_address(
        &[b"lending_position", borrower.pubkey().as_ref()],
        &env.consumer_id,
    );

    // Open position: 10 AAPLX tokens @ $184.70 = $1,847.00 collateral, $1,400.00 USDC borrowed
    // LTV = 1400 / 1847 = 75.79% >= 75.00% threshold (liquidatable!)
    let params = OpenPositionParams {
        collateral_tokens: 10_000_000,
        collateral_value_usd: 1_847_000_000,
        borrowed_usdc: 1_400_000_000,
    };

    let open_ix = Instruction::new_with_bytes(
        env.consumer_id,
        &OpenPosition { params }.data(),
        consumer::accounts::OpenPosition {
            owner: borrower.pubkey(),
            position: position_pda,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[open_ix], Some(&borrower.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[borrower]).unwrap();
    env.svm.send_transaction(tx).expect("Failed to open position");

    position_pda
}

fn execute_attempt_liquidate(
    env: &mut ConsumerTestEnv,
    position: Pubkey,
    equity_price: i64,
    equity_time: i64,
    xstock_price: i64,
    xstock_time: i64,
) -> Result<(), String> {
    let eq_pubkey = Pubkey::new_unique();
    let xs_pubkey = Pubkey::new_unique();

    let eq_data = create_price_account_data(EQUITY_FEED_ID, equity_price, -6, equity_time);
    let xs_data = create_price_account_data(XSTOCK_FEED_ID, xstock_price, -6, xstock_time);

    env.svm
        .set_account(
            eq_pubkey,
            Account {
                lamports: 1_000_000_000,
                data: eq_data,
                owner: pyth_solana_receiver_sdk::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    env.svm
        .set_account(
            xs_pubkey,
            Account {
                lamports: 1_000_000_000,
                data: xs_data,
                owner: pyth_solana_receiver_sdk::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let liquidate_ix = Instruction::new_with_bytes(
        env.consumer_id,
        &AttemptLiquidate {}.data(),
        consumer::accounts::AttemptLiquidate {
            liquidator: env.payer.pubkey(),
            position,
            sentinel_config: env.sentinel_config,
            equity_price_update: eq_pubkey,
            xstock_price_update: xs_pubkey,
            sentinel_program: env.sentinel_id,
            clock: Clock::id(),
        }
        .to_account_metas(None),
    );

    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[liquidate_ix], Some(&env.payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&env.payer]).unwrap();

    match env.svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(failed) => Err(format!("{:?}", failed)),
    }
}

#[test]
fn test_consumer_safe_liquidation() {
    let mut env = setup_consumer_env();
    let borrower = Keypair::new();
    let position = open_test_position(&mut env, &borrower);

    // Both feeds fresh, prices match within 10 bps
    let res = execute_attempt_liquidate(&mut env, position, 184_500_000, NOW, 184_700_000, NOW);
    assert!(res.is_ok(), "Safe liquidation should succeed: {:?}", res);

    // Verify position is marked liquidated on-chain
    let pos_acc = env.svm.get_account(&position).unwrap();
    let mut data: &[u8] = &pos_acc.data;
    let pos_state = LendingPosition::try_deserialize(&mut data).unwrap();
    assert!(pos_state.is_liquidated, "Position should be marked liquidated");
}

#[test]
fn test_consumer_stale_blocked() {
    let mut env = setup_consumer_env();
    let borrower = Keypair::new();
    let position = open_test_position(&mut env, &borrower);

    // Equity feed is 494s old (stale)
    let res = execute_attempt_liquidate(
        &mut env,
        position,
        184_500_000,
        NOW - 494,
        184_700_000,
        NOW,
    );

    assert!(res.is_err(), "Stale feed must block liquidation");
    let err_str = res.unwrap_err();
    assert!(
        err_str.contains("PriceStale") || err_str.contains("Custom(6001)"),
        "Expected PriceStale error, got: {}",
        err_str
    );

    // Verify position was NOT liquidated
    let pos_acc = env.svm.get_account(&position).unwrap();
    let mut data: &[u8] = &pos_acc.data;
    let pos_state = LendingPosition::try_deserialize(&mut data).unwrap();
    assert!(!pos_state.is_liquidated, "Position must NOT be liquidated");
}

#[test]
fn test_consumer_divergent_blocked() {
    let mut env = setup_consumer_env();
    let borrower = Keypair::new();
    let position = open_test_position(&mut env, &borrower);

    // Feeds fresh, but prices diverge by ~406 bps (> 200 bps threshold)
    let res = execute_attempt_liquidate(
        &mut env,
        position,
        184_500_000,
        NOW,
        192_000_000,
        NOW,
    );

    assert!(res.is_err(), "Divergent feed must block liquidation");
    let err_str = res.unwrap_err();
    assert!(
        err_str.contains("PriceDivergent") || err_str.contains("Custom(6002)"),
        "Expected PriceDivergent error, got: {}",
        err_str
    );

    // Verify position was NOT liquidated
    let pos_acc = env.svm.get_account(&position).unwrap();
    let mut data: &[u8] = &pos_acc.data;
    let pos_state = LendingPosition::try_deserialize(&mut data).unwrap();
    assert!(!pos_state.is_liquidated, "Position must NOT be liquidated");
}
