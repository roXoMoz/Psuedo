// Solana Sandbox Wallet
// Uses Web Crypto Ed25519 for real signatures

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    str += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]];
  }
  return str;
}

// Storage for the sandbox keypair
let sandboxPublicKey: Uint8Array | null = null;
let sandboxPrivateKey: CryptoKey | null = null;
let sandboxAddress: string = '';

export interface SolanaKeypair {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
  address: string;
}

// Generate or load sandbox wallet
export async function getSolanaKeypair(log: (...args: unknown[]) => void): Promise<SolanaKeypair> {
  if (sandboxPublicKey && sandboxPrivateKey && sandboxAddress) {
    return { publicKey: sandboxPublicKey, privateKey: sandboxPrivateKey, address: sandboxAddress };
  }

  // Try to load from localStorage
  try {
    const stored = localStorage.getItem('pseudo_solana_keypair');
    if (stored) {
      const parsed = JSON.parse(stored);
      const publicKey = new Uint8Array(parsed.publicKey);
      const pkcs8 = new Uint8Array(parsed.pkcs8);

      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'Ed25519' },
        false,
        ['sign']
      );

      sandboxPublicKey = publicKey;
      sandboxPrivateKey = privateKey;
      sandboxAddress = parsed.address;
      log('[SOL] Loaded existing keypair:', sandboxAddress);
      return { publicKey, privateKey, address: sandboxAddress };
    }
  } catch (e) {
    log('[SOL] Could not load stored keypair:', e);
  }

  // Generate new Ed25519 keypair
  log('[SOL] Generating new Ed25519 keypair...');
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const pkcs8Buffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKey = new Uint8Array(publicKeyBuffer);
  const pkcs8 = new Uint8Array(pkcs8Buffer);

  sandboxPublicKey = publicKey;
  sandboxPrivateKey = keyPair.privateKey;
  sandboxAddress = base58Encode(publicKey);

  try {
    localStorage.setItem('pseudo_solana_keypair', JSON.stringify({
      publicKey: Array.from(publicKey),
      pkcs8: Array.from(pkcs8),
      address: sandboxAddress,
    }));
  } catch {
    log('[SOL] Could not store keypair');
  }

  log('[SOL] Generated new wallet:', sandboxAddress);
  return { publicKey, privateKey: keyPair.privateKey, address: sandboxAddress };
}

// Create a PublicKey-like object that mimics @solana/web3.js PublicKey
export function createPublicKey(address: string, bytes: Uint8Array) {
  return {
    toString: () => address,
    toBase58: () => address,
    toBuffer: () => bytes.buffer,
    toBytes: () => bytes,
    equals: (other: any) => other?.toString?.() === address,
    _bn: { toArrayLike: () => bytes },
    toJSON: () => address,
  };
}

// Sign a message with Ed25519
export async function signMessage(privateKey: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    message
  );
  return new Uint8Array(signatureBuffer);
}

// Handle Solana method calls in sandbox mode
export async function handleSolanaMethod(
  method: string,
  args: unknown[],
  keypair: SolanaKeypair,
  log: (...args: unknown[]) => void
): Promise<any> {
  const { publicKey, privateKey, address } = keypair;
  log(`[SOL] Handling ${method} with wallet ${address}`);

  switch (method) {
    case 'connect':
      log('[SOL] Connecting with sandbox wallet');
      return {
        publicKey: createPublicKey(address, publicKey),
      };

    case 'signTransaction': {
      log('[SOL] Signing transaction');
      const tx = args[0] as any;
      const message = tx?.serializeMessage?.() || tx?.message?.serialize?.() || new Uint8Array(32);
      const signature = await signMessage(privateKey, message);

      return {
        ...tx,
        signature,
        signatures: [{ publicKey: createPublicKey(address, publicKey), signature }],
      };
    }

    case 'signAllTransactions': {
      log('[SOL] Signing all transactions');
      const txs = args[0] as any[];
      const signed = [];
      for (const tx of txs || []) {
        const message = tx?.serializeMessage?.() || new Uint8Array(32);
        const signature = await signMessage(privateKey, message);
        signed.push({
          ...tx,
          signature,
          signatures: [{ publicKey: createPublicKey(address, publicKey), signature }],
        });
      }
      return signed;
    }

    case 'signMessage': {
      log('[SOL] Signing message');
      const message = args[0] as Uint8Array;
      const signature = await signMessage(privateKey, message);
      return {
        signature,
        publicKey: createPublicKey(address, publicKey),
      };
    }

    case 'signAndSendTransaction': {
      log('[SOL] Sign and send (simulated - no SOL)');
      const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let sig = '';
      for (let i = 0; i < 88; i++) sig += chars[Math.floor(Math.random() * chars.length)];
      return { signature: sig };
    }

    default:
      throw new Error(`[Pseudo] Unknown Solana method: ${method}`);
  }
}

export const SENSITIVE_SOLANA_METHODS = new Set([
  'connect',
  'signTransaction',
  'signAllTransactions',
  'signMessage',
  'signAndSendTransaction',
]);
