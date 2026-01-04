// Ethereum Sandbox Wallet
// Uses @noble/secp256k1 for real ECDSA signatures

import { getPublicKey, signAsync } from '@noble/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';

// Storage for the sandbox keypair
let privateKey: Uint8Array | null = null;
let publicKey: Uint8Array | null = null;
let address: string = '';

export interface EthereumKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

// Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Derive Ethereum address from public key
function deriveAddress(pubKey: Uint8Array): string {
  // Remove the 0x04 prefix if present (uncompressed key marker)
  const keyWithoutPrefix = pubKey.length === 65 ? pubKey.slice(1) : pubKey;
  // Keccak256 hash of the public key
  const hash = keccak_256(keyWithoutPrefix);
  // Take last 20 bytes
  const addressBytes = hash.slice(-20);
  return '0x' + bytesToHex(addressBytes);
}

// Generate or load sandbox wallet
export async function getEthereumKeypair(log: (...args: unknown[]) => void): Promise<EthereumKeypair> {
  if (privateKey && publicKey && address) {
    return { privateKey, publicKey, address };
  }

  // Try to load from localStorage
  try {
    const stored = localStorage.getItem('pseudo_ethereum_keypair');
    if (stored) {
      const parsed = JSON.parse(stored);
      privateKey = new Uint8Array(parsed.privateKey);
      publicKey = new Uint8Array(parsed.publicKey);
      address = parsed.address;
      log('[ETH] Loaded existing keypair:', address);
      return { privateKey, publicKey, address };
    }
  } catch (e) {
    log('[ETH] Could not load stored keypair:', e);
  }

  // Generate new secp256k1 keypair
  log('[ETH] Generating new secp256k1 keypair...');
  privateKey = crypto.getRandomValues(new Uint8Array(32));
  publicKey = getPublicKey(privateKey, false); // uncompressed
  address = deriveAddress(publicKey);

  // Checksum the address
  address = checksumAddress(address);

  try {
    localStorage.setItem('pseudo_ethereum_keypair', JSON.stringify({
      privateKey: Array.from(privateKey),
      publicKey: Array.from(publicKey),
      address,
    }));
  } catch {
    log('[ETH] Could not store keypair');
  }

  log('[ETH] Generated new wallet:', address);
  return { privateKey, publicKey, address };
}

// EIP-55 checksum address
function checksumAddress(addr: string): string {
  const lowerAddr = addr.toLowerCase().replace('0x', '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lowerAddr)));

  let checksummed = '0x';
  for (let i = 0; i < lowerAddr.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksummed += lowerAddr[i].toUpperCase();
    } else {
      checksummed += lowerAddr[i];
    }
  }
  return checksummed;
}

// Hash message with Ethereum prefix
function hashMessage(message: Uint8Array | string): Uint8Array {
  const msgBytes = typeof message === 'string'
    ? new TextEncoder().encode(message)
    : message;

  const prefix = `\x19Ethereum Signed Message:\n${msgBytes.length}`;
  const prefixBytes = new TextEncoder().encode(prefix);

  const combined = new Uint8Array(prefixBytes.length + msgBytes.length);
  combined.set(prefixBytes);
  combined.set(msgBytes, prefixBytes.length);

  return keccak_256(combined);
}

// Sign a message hash and return signature in Ethereum format
async function signHash(hash: Uint8Array, privKey: Uint8Array): Promise<string> {
  // Sign with recovered format to get recovery bit
  const signature = await signAsync(hash, privKey, {
    lowS: true,
    prehash: false, // hash is already hashed
    format: 'recovered', // returns [recovery, r, s] format
  });

  // signature is 65 bytes: [recovery (1 byte), r (32 bytes), s (32 bytes)]
  const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);

  // Extract recovery, r, s
  const recovery = sigBytes[0];
  const r = bytesToHex(sigBytes.slice(1, 33));
  const s = bytesToHex(sigBytes.slice(33, 65));

  // Ethereum uses v = recovery + 27
  const v = (recovery + 27).toString(16).padStart(2, '0');

  return '0x' + r + s + v;
}

// Sign personal_sign message
export async function signPersonalMessage(
  message: string | Uint8Array,
  privKey: Uint8Array
): Promise<string> {
  // If message is hex string, convert to bytes
  let msgBytes: Uint8Array;
  if (typeof message === 'string' && message.startsWith('0x')) {
    msgBytes = hexToBytes(message);
  } else if (typeof message === 'string') {
    msgBytes = new TextEncoder().encode(message);
  } else {
    msgBytes = message;
  }

  const hash = hashMessage(msgBytes);
  return signHash(hash, privKey);
}

// EIP-712 type hashing
function encodeType(primaryType: string, types: Record<string, Array<{ name: string; type: string }>>): string {
  let result = '';
  const deps = new Set<string>();

  function findDeps(type: string) {
    if (deps.has(type) || !types[type]) return;
    deps.add(type);
    for (const field of types[type]) {
      const baseType = field.type.replace(/\[\d*\]$/, '');
      findDeps(baseType);
    }
  }

  findDeps(primaryType);
  deps.delete(primaryType);

  const sortedDeps = [primaryType, ...Array.from(deps).sort()];
  for (const type of sortedDeps) {
    if (!types[type]) continue;
    result += `${type}(${types[type].map((f) => `${f.type} ${f.name}`).join(',')})`;
  }
  return result;
}

function typeHash(primaryType: string, types: Record<string, any>): Uint8Array {
  return keccak_256(new TextEncoder().encode(encodeType(primaryType, types)));
}

function encodeData(
  primaryType: string,
  data: any,
  types: Record<string, Array<{ name: string; type: string }>>
): Uint8Array {
  const encodedValues: Uint8Array[] = [typeHash(primaryType, types)];

  for (const field of types[primaryType] || []) {
    let value = data[field.name];
    const type = field.type;

    if (type === 'string') {
      encodedValues.push(keccak_256(new TextEncoder().encode(value || '')));
    } else if (type === 'bytes') {
      encodedValues.push(keccak_256(hexToBytes(value || '0x')));
    } else if (types[type]) {
      // Nested struct
      encodedValues.push(keccak_256(encodeData(type, value || {}, types)));
    } else if (type.endsWith('[]')) {
      // Array type
      const baseType = type.slice(0, -2);
      const arrayData = (value || []).map((item: any) =>
        types[baseType] ? keccak_256(encodeData(baseType, item, types)) : encodeValue(baseType, item)
      );
      const concatenated = new Uint8Array(arrayData.reduce((acc: number, arr: Uint8Array) => acc + arr.length, 0));
      let offset = 0;
      for (const arr of arrayData) {
        concatenated.set(arr, offset);
        offset += arr.length;
      }
      encodedValues.push(keccak_256(concatenated));
    } else {
      encodedValues.push(encodeValue(type, value));
    }
  }

  // Concatenate all encoded values
  const totalLength = encodedValues.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of encodedValues) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function encodeValue(type: string, value: any): Uint8Array {
  const result = new Uint8Array(32);

  if (type === 'address') {
    const addr = hexToBytes((value || '0x0000000000000000000000000000000000000000').slice(2).padStart(40, '0'));
    result.set(addr, 12);
  } else if (type === 'bool') {
    result[31] = value ? 1 : 0;
  } else if (type.startsWith('uint') || type.startsWith('int')) {
    const hex = (BigInt(value || 0).toString(16)).padStart(64, '0');
    const bytes = hexToBytes(hex);
    result.set(bytes.slice(-32), 32 - Math.min(bytes.length, 32));
  } else if (type.startsWith('bytes')) {
    const bytes = hexToBytes((value || '0x').slice(2).padEnd(64, '0'));
    result.set(bytes.slice(0, 32));
  }

  return result;
}

function hashStruct(primaryType: string, data: any, types: Record<string, any>): Uint8Array {
  return keccak_256(encodeData(primaryType, data, types));
}

// Sign EIP-712 typed data
export async function signTypedData(
  typedData: any,
  privKey: Uint8Array,
  log: (...args: unknown[]) => void
): Promise<string> {
  try {
    const { domain, types, primaryType, message } = typedData;

    // Remove EIP712Domain from types for struct hashing
    const typesWithoutDomain = { ...types };
    delete typesWithoutDomain.EIP712Domain;

    // Hash the domain separator
    const domainSeparator = hashStruct('EIP712Domain', domain, types);

    // Hash the message
    const messageHash = hashStruct(primaryType, message, typesWithoutDomain);

    // Create the final hash: keccak256("\x19\x01" + domainSeparator + messageHash)
    const prefix = new Uint8Array([0x19, 0x01]);
    const combined = new Uint8Array(2 + 32 + 32);
    combined.set(prefix, 0);
    combined.set(domainSeparator, 2);
    combined.set(messageHash, 34);

    const finalHash = keccak_256(combined);

    log('[ETH] Signing EIP-712 typed data');
    return signHash(finalHash, privKey);
  } catch (e) {
    log('[ETH] Error signing typed data:', e);
    // Fallback: hash the JSON (won't verify but at least returns something)
    const hash = keccak_256(new TextEncoder().encode(JSON.stringify(typedData)));
    return signHash(hash, privKey);
  }
}

// Generate fake tx hash (for send transaction - actual tx won't go through)
export function generateTxHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + bytesToHex(bytes);
}

// Handle Ethereum method calls in sandbox mode
export async function handleEthereumMethod(
  method: string,
  params: unknown[],
  keypair: EthereumKeypair,
  log: (...args: unknown[]) => void
): Promise<any> {
  const { privateKey, address } = keypair;
  log(`[ETH] Handling ${method} with wallet ${address}`);

  switch (method) {
    case 'eth_requestAccounts':
      log('[ETH] Returning sandbox address');
      return [address];

    case 'eth_accounts':
      return [address];

    case 'wallet_requestPermissions':
      log('[ETH] Granting permissions');
      return [{
        parentCapability: 'eth_accounts',
        caveats: [{
          type: 'restrictReturnedAccounts',
          value: [address],
        }],
      }];

    case 'personal_sign': {
      log('[ETH] Signing personal message');
      // personal_sign params: [message, address]
      const message = params[0] as string;
      return signPersonalMessage(message, privateKey);
    }

    case 'eth_sign': {
      log('[ETH] Signing message (eth_sign)');
      // eth_sign params: [address, message]
      const message = params[1] as string;
      return signPersonalMessage(message, privateKey);
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      log('[ETH] Signing typed data');
      // params: [address, typedData]
      const typedData = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      return signTypedData(typedData, privateKey, log);
    }

    case 'eth_sendTransaction':
    case 'eth_signTransaction': {
      log('[ETH] Signing transaction (simulated)');
      return generateTxHash();
    }

    default:
      log('[ETH] Unknown method, returning tx hash');
      return generateTxHash();
  }
}

export const SENSITIVE_ETH_METHODS = new Set([
  'eth_requestAccounts',      // Initial connection request
  'wallet_requestPermissions', // Permission request
  'eth_sendTransaction',       // Sending transactions
  'eth_signTransaction',       // Signing transactions
  'eth_sign',                  // Legacy signing
  'personal_sign',             // Message signing
  'eth_signTypedData',         // Typed data signing
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);
// Note: eth_accounts is NOT included - it's a read-only check called frequently
