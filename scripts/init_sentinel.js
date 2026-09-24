const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
  const rpcUrl = 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Load deployer keypair
  const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  const payer = Keypair.fromSecretKey(secretKey);

  console.log(`Authority Wallet: ${payer.publicKey.toBase58()}`);

  const PROGRAM_ID = new PublicKey('DfKAoENAneWyLgwt5BKP7PfigPG8Phfv3nywLZnhfCrW');

  // Derive PDA: seeds = [b"sentinel_config", authority.key().as_ref()]
  const [configPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('sentinel_config'), payer.publicKey.toBuffer()],
    PROGRAM_ID
  );
  console.log(`Sentinel Config PDA: ${configPda.toBase58()} (bump: ${bump})`);

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(configPda);
  if (accountInfo !== null) {
    console.log(`\nConfig PDA already exists on Devnet!`);
    console.log(`Solscan Account URL: https://solscan.io/account/${configPda.toBase58()}?cluster=devnet`);
    return;
  }

  // Anchor discriminator for "global:initialize"
  const disc = crypto.createHash('sha256').update('global:initialize').digest().subarray(0, 8);

  // InitializeParams:
  // max_staleness_seconds: u64 = 300 (5 minutes)
  // max_deviation_bps: u64 = 200 (2.00%)
  // equity_feed_id: [u8; 32]
  // xstock_feed_id: [u8; 32]
  const data = Buffer.alloc(88);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(300), 8);
  data.writeBigUInt64LE(BigInt(200), 16);
  // Fill 32 bytes sample feed IDs
  Buffer.from('pyth_aapl_usd_feed_id_devnet_000').copy(data, 24);
  Buffer.from('prestock_xstock_feed_id_devnet_0').copy(data, 56);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = payer.publicKey;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  console.log('Sending initialize transaction to Solana Devnet...');
  const txSignature = await connection.sendTransaction(tx, [payer], { skipPreflight: false });
  console.log(`Tx sent! Signature: ${txSignature}`);
  console.log('Confirming transaction...');

  await connection.confirmTransaction({
    signature: txSignature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, 'confirmed');

  console.log('\n SUCCESS! Sentinel Config Initialized on Devnet!');
  console.log(`Transaction Solscan: https://solscan.io/tx/${txSignature}?cluster=devnet`);
  console.log(`Program Solscan: https://solscan.io/account/${PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`Config PDA Solscan: https://solscan.io/account/${configPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error('Initialization error:', err);
  process.exit(1);
});
