use {
    anchor_lang::{
        prelude::{Pubkey, Clock},
        solana_program::{instruction::Instruction, sysvar::SysvarId},
        AccountSerialize, AnchorDeserialize, InstructionData, ToAccountMetas,
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
    sentinel::state::PriceSafetyResult,
};

const EQUITY_FEED_ID: [u8; 32] = [1u8; 32];
const XSTOCK_FEED_ID: [u8; 32] = [2u8; 32];

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

struct TestContext {
    svm: LiteSVM,
    payer: Keypair,
    program_id: Pubkey,
    config: Pubkey,
    current_time: i64,
}

fn setup_test_context(max_staleness: u64, max_deviation_bps: u64) -> TestContext {
    let program_id = sentinel::id();
    let payer = Keypair::new();
    let (config, _bump) = Pubkey::find_program_address(
        &[b"sentinel_config", payer.pubkey().as_ref()],
        &program_id,
    );

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/sentinel.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_700_000_000;
    svm.set_sysvar::<Clock>(&clock);
    let current_time = clock.unix_timestamp;

    // Initialize config
    let params = sentinel::instructions::initialize::InitializeParams {
        max_staleness_seconds: max_staleness,
        max_deviation_bps,
        equity_feed_id: EQUITY_FEED_ID,
        xstock_feed_id: XSTOCK_FEED_ID,
    };

    let instruction = Instruction::new_with_bytes(
        program_id,
        &sentinel::instruction::Initialize { params }.data(),
        sentinel::accounts::Initialize {
            authority: payer.pubkey(),
            config,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx).expect("Failed to initialize sentinel config");

    TestContext {
        svm,
        payer,
        program_id,
        config,
        current_time,
    }
}

fn check_safety(
    ctx: &mut TestContext,
    equity_price: i64,
    equity_time: i64,
    xstock_price: i64,
    xstock_time: i64,
) -> PriceSafetyResult {
    let equity_pubkey = Pubkey::new_unique();
    let xstock_pubkey = Pubkey::new_unique();

    let eq_data = create_price_account_data(EQUITY_FEED_ID, equity_price, -6, equity_time);
    let xs_data = create_price_account_data(XSTOCK_FEED_ID, xstock_price, -6, xstock_time);

    ctx.svm
        .set_account(
            equity_pubkey,
            Account {
                lamports: 1_000_000_000,
                data: eq_data,
                owner: pyth_solana_receiver_sdk::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    ctx.svm
        .set_account(
            xstock_pubkey,
            Account {
                lamports: 1_000_000_000,
                data: xs_data,
                owner: pyth_solana_receiver_sdk::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let instruction = Instruction::new_with_bytes(
        ctx.program_id,
        &sentinel::instruction::CheckPriceSafety {}.data(),
        sentinel::accounts::CheckPriceSafety {
            config: ctx.config,
            equity_price_update: equity_pubkey,
            xstock_price_update: xstock_pubkey,
            clock: Clock::id(),
        }
        .to_account_metas(None),
    );

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&ctx.payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.payer]).unwrap();

    let tx_res = ctx.svm.send_transaction(tx).expect("CheckPriceSafety ix failed");
    
    // Deserialize return data
    let return_data = tx_res.return_data.data;
    PriceSafetyResult::try_from_slice(&return_data)
        .expect("Failed to deserialize PriceSafetyResult from return data")
}

#[test]
fn test_safe_state() {
    let mut ctx = setup_test_context(300, 200); // 300s staleness, 200 bps max diff
    let now = ctx.current_time;

    // Equity: $184.50 (184_500_000 with exp -6)
    // xStock: $184.70 (184_700_000 with exp -6)
    // Spread: |184.70 - 184.50| / 184.50 = 0.20 / 184.50 = ~10.8 bps <= 200 bps
    // Both published at `now`
    let result = check_safety(&mut ctx, 184_500_000, now, 184_700_000, now);

    assert_eq!(result, PriceSafetyResult::Safe, "Expected Safe state");
}

#[test]
fn test_stale_state() {
    let mut ctx = setup_test_context(300, 200);
    let now = ctx.current_time;

    // Equity updated 494s ago (exceeds max_staleness 300s)
    let equity_time = now - 494;
    let xstock_time = now - 10;

    let result = check_safety(&mut ctx, 184_500_000, equity_time, 184_700_000, xstock_time);

    match result {
        PriceSafetyResult::Stale { seconds_stale } => {
            assert!(
                seconds_stale >= 494,
                "Expected staleness >= 494s, got {}s",
                seconds_stale
            );
        }
        other => panic!("Expected Stale result, got {:?}", other),
    }
}

#[test]
fn test_divergent_state() {
    let mut ctx = setup_test_context(300, 200); // max 200 bps (2.0%)
    let now = ctx.current_time;

    // Equity: $184.50 (184_500_000)
    // xStock: $190.25 (190_250_000)
    // Diff: 5.75 / 184.50 = ~3.116% = 311 bps (> 200 bps limit)
    let result = check_safety(&mut ctx, 184_500_000, now, 190_250_000, now);

    match result {
        PriceSafetyResult::Divergent { actual_bps, limit_bps } => {
            assert_eq!(limit_bps, 200);
            assert!(
                actual_bps > 200,
                "Expected actual_bps > 200, got {}",
                actual_bps
            );
        }
        other => panic!("Expected Divergent result, got {:?}", other),
    }
}
