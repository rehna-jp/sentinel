use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_initialize() {
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
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let params = sentinel::instructions::initialize::InitializeParams {
        max_staleness_seconds: 300,
        max_deviation_bps: 200,
        equity_feed_id: [1u8; 32],
        xstock_feed_id: [2u8; 32],
    };

    let instruction = Instruction::new_with_bytes(
        program_id,
        &sentinel::instruction::Initialize { params }.data(),
        sentinel::accounts::Initialize {
            authority: payer.pubkey(),
            config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "Initialize transaction failed: {:?}", res);

    let config_account = svm.get_account(&config).unwrap();
    let mut data: &[u8] = &config_account.data;
    let config_state = sentinel::state::SentinelConfig::try_deserialize(&mut data).unwrap();
    assert_eq!(config_state.authority, payer.pubkey());
    assert_eq!(config_state.max_staleness_seconds, 300);
    assert_eq!(config_state.max_deviation_bps, 200);
    assert_eq!(config_state.equity_feed_id, [1u8; 32]);
    assert_eq!(config_state.xstock_feed_id, [2u8; 32]);
}
