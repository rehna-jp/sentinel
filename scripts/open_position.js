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

  console.log(`Payer Wallet: ${payer.publicKey.toBase58()}`);

  const CONSUMER_PROGRAM_ID = new PublicKey('9kLnfpk3dD2hqdG987oac7UXK1j67yLC41s45ebbujj9');

  // Derive PDA: seeds = [b"lending_position", owner.key().as_ref()]
  const [positionPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending_position'), payer.publicKey.toBuffer()],
    CONSUMER_PROGRAM_ID
  );
  console.log(`Lending Position PDA: ${positionPda.toBase58()} (bump: ${bump})`);

  const accountInfo = await connection.getAccountInfo(positionPda);
  if (accountInfo !== null) {
    console.log(`Lending position already exists on Devnet!`);
    console.log(`Solscan Account URL: https://solscan.io/account/${positionPda.toBase58()}?cluster=devnet`);
    return;
  }

  // Anchor discriminator for "global:open_position"
  const disc = crypto.createHash('sha256').update('global:open_position').digest().subarray(0, 8);

  // OpenPositionParams:
  // collateral_tokens: u64 (100 * 10^6)
  // collateral_value_usd: u64 (18450 * 10^6) -> $18,450
  // borrowed_usdc: u64 (12000 * 10^6) -> $12,000 borrowed (LTV ~65%)
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(100_000_000), 8);
  data.writeBigUInt64LE(BigInt(18_450_000_000), 16);
  data.writeBigUInt64LE(BigInt(12_000_000_000), 24);

  const instruction = new TransactionInstruction({
    programId: CONSUMER_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = payer.publicKey;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  console.log('Sending open_position transaction to Solana Devnet...');
  const txSignature = await connection.sendTransaction(tx, [payer], { skipPreflight: false });
  console.log(`Tx sent! Signature: ${txSignature}`);

  await connection.confirmTransaction({
    signature: txSignature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, 'confirmed');

  console.log('\n SUCCESS! Consumer Lending Position Opened on Devnet!');
  console.log(`Transaction Solscan: https://solscan.io/tx/${txSignature}?cluster=devnet`);
  console.log(`Consumer Program Solscan: https://solscan.io/account/${CONSUMER_PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`Position PDA Solscan: https://solscan.io/account/${positionPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error('Open position error:', err);
  process.exit(1);
});
