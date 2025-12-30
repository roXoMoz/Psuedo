export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    const DEBUG = true;
    const log = (...args: unknown[]) => DEBUG && console.log('[Pseudo]', ...args);

    let resolveRequest: ((value: { approved: boolean; usePseudo: boolean }) => void) | null = null;
    let rejectRequest: ((error: Error) => void) | null = null;
    let currentRequest: { chain: string; method: string; params?: unknown[] } | null = null;
    let pseudoEnabled = false;

    try {
      pseudoEnabled = localStorage.getItem('pseudo_enabled') === 'true';
    } catch {}

    const styles = `
      #pseudo-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #pseudo-card {
        background: rgba(10, 10, 10, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 20px;
        width: 320px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        animation: pseudo-slide-in 0.25s ease-out;
      }
      @keyframes pseudo-slide-in {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .pseudo-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .pseudo-title {
        font-size: 15px;
        font-weight: 600;
        color: #fff;
        letter-spacing: -0.2px;
      }
      .pseudo-badge {
        font-size: 10px;
        font-weight: 500;
        color: rgba(255,255,255,0.4);
        background: rgba(255,255,255,0.06);
        padding: 4px 8px;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .pseudo-method {
        font-size: 13px;
        font-weight: 500;
        color: rgba(255,255,255,0.7);
        font-family: 'SF Mono', Monaco, Consolas, monospace;
        background: rgba(255,255,255,0.04);
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        word-break: break-all;
      }
      .pseudo-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: rgba(255,255,255,0.03);
        border-radius: 10px;
        margin-bottom: 16px;
      }
      .pseudo-toggle-label {
        font-size: 13px;
        color: rgba(255,255,255,0.8);
      }
      .pseudo-toggle {
        position: relative;
        width: 40px;
        height: 22px;
        cursor: pointer;
      }
      .pseudo-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .pseudo-slider {
        position: absolute;
        inset: 0;
        background: rgba(255,255,255,0.1);
        border-radius: 22px;
        transition: 0.2s;
      }
      .pseudo-slider:before {
        content: "";
        position: absolute;
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background: rgba(255,255,255,0.8);
        border-radius: 50%;
        transition: 0.2s;
      }
      .pseudo-toggle input:checked + .pseudo-slider {
        background: rgba(255,255,255,0.25);
      }
      .pseudo-toggle input:checked + .pseudo-slider:before {
        transform: translateX(18px);
        background: #fff;
      }
      .pseudo-hint {
        font-size: 11px;
        color: rgba(255,255,255,0.35);
        margin-bottom: 16px;
        line-height: 1.4;
      }
      .pseudo-buttons {
        display: flex;
        gap: 10px;
      }
      .pseudo-btn {
        flex: 1;
        padding: 12px 16px;
        border: none;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .pseudo-btn-secondary {
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.7);
      }
      .pseudo-btn-secondary:hover {
        background: rgba(255,255,255,0.1);
      }
      .pseudo-btn-primary {
        background: #fff;
        color: #000;
      }
      .pseudo-btn-primary:hover {
        opacity: 0.9;
      }
    `;

    function injectStyles() {
      if (document.getElementById('pseudo-styles')) return;
      const style = document.createElement('style');
      style.id = 'pseudo-styles';
      style.textContent = styles;
      (document.head || document.documentElement).appendChild(style);
    }

    function createOverlay() {
      if (document.getElementById('pseudo-overlay')) return;
      if (!currentRequest) return;
      injectStyles();

      const { chain, method } = currentRequest;

      const overlay = document.createElement('div');
      overlay.id = 'pseudo-overlay';
      overlay.innerHTML = `
        <div id="pseudo-card">
          <div class="pseudo-header">
            <span class="pseudo-title">Pseudo</span>
            <span class="pseudo-badge">${chain}</span>
          </div>
          <div class="pseudo-method">${method}</div>
          <div class="pseudo-toggle-row">
            <span class="pseudo-toggle-label">Use Pseudo</span>
            <label class="pseudo-toggle">
              <input type="checkbox" id="pseudo-toggle" ${pseudoEnabled ? 'checked' : ''}>
              <span class="pseudo-slider"></span>
            </label>
          </div>
          <div class="pseudo-hint">${pseudoEnabled ? 'Pseudo mode: Request will be simulated' : 'Off: Request goes to your real wallet'}</div>
          <div class="pseudo-buttons">
            <button class="pseudo-btn pseudo-btn-secondary" id="pseudo-reject">Reject</button>
            <button class="pseudo-btn pseudo-btn-primary" id="pseudo-continue">Continue</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const toggle = document.getElementById('pseudo-toggle') as HTMLInputElement;
      const hint = overlay.querySelector('.pseudo-hint') as HTMLElement;

      toggle?.addEventListener('change', () => {
        pseudoEnabled = toggle.checked;
        try { localStorage.setItem('pseudo_enabled', String(pseudoEnabled)); } catch {}
        if (hint) {
          hint.textContent = pseudoEnabled ? 'Pseudo mode: Request will be simulated' : 'Off: Request goes to your real wallet';
        }
      });

      document.getElementById('pseudo-reject')?.addEventListener('click', () => {
        hideOverlay();
        rejectRequest?.(new Error('User rejected the request'));
      });

      document.getElementById('pseudo-continue')?.addEventListener('click', () => {
        hideOverlay();
        resolveRequest?.({ approved: true, usePseudo: pseudoEnabled });
      });
    }

    function hideOverlay() {
      document.getElementById('pseudo-overlay')?.remove();
      currentRequest = null;
    }

    function showOverlayAndWait(request: { chain: string; method: string; params?: unknown[] }): Promise<{ approved: boolean; usePseudo: boolean }> {
      return new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
        currentRequest = request;
        if (document.body) {
          createOverlay();
        } else {
          document.addEventListener('DOMContentLoaded', () => createOverlay(), { once: true });
        }
      });
    }

    // ========== PSEUDO SANDBOX WALLET ==========
    // Valid Solana address (base58, no 0/I/O/l chars, 32-44 chars)
    // Using a valid format that decodes to 32 bytes
    const PSEUDO_SOLANA_ADDRESS = 'Pseudo11111111111111111111111111111111111111';

    // Create a fake PublicKey-like object that dApps will accept
    function createFakePublicKey(address: string) {
      const bytes = new Uint8Array(32);
      // Fill with deterministic bytes based on address
      for (let i = 0; i < 32; i++) {
        bytes[i] = address.charCodeAt(i % address.length) % 256;
      }

      return {
        toString: () => address,
        toBase58: () => address,
        toBuffer: () => bytes.buffer,
        toBytes: () => bytes,
        equals: (other: any) => other?.toString?.() === address,
        // Make it look like a real PublicKey
        _bn: { toArrayLike: () => bytes },
        // Additional properties some dApps check
        toJSON: () => address,
      };
    }

    // Create a fake signature (88 chars, base58)
    function createFakeSignature(): Uint8Array {
      const sig = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        sig[i] = Math.floor(Math.random() * 256);
      }
      return sig;
    }

    // Simulate signing a transaction
    function simulateSignTransaction(tx: any) {
      log('[SANDBOX] Simulating transaction sign...');

      // Clone the transaction-like object and add a fake signature
      const signedTx = {
        ...tx,
        signature: createFakeSignature(),
        signatures: tx.signatures ? [...tx.signatures, createFakeSignature()] : [createFakeSignature()],
      };

      // If it has a serialize method, wrap it
      if (typeof tx.serialize === 'function') {
        signedTx.serialize = () => new Uint8Array(256).fill(0);
      }

      return signedTx;
    }

    // Handle Solana method calls in sandbox mode
    function handleSolanaSandbox(method: string, args: unknown[]): any {
      log(`[SANDBOX] Handling ${method}`);

      switch (method) {
        case 'connect':
          log('[SANDBOX] Returning fake wallet connection');
          return {
            publicKey: createFakePublicKey(PSEUDO_SOLANA_ADDRESS),
          };

        case 'signTransaction':
          log('[SANDBOX] Fake signing transaction');
          return simulateSignTransaction(args[0]);

        case 'signAllTransactions':
          log('[SANDBOX] Fake signing all transactions');
          return (args[0] as any[])?.map(tx => simulateSignTransaction(tx)) || [];

        case 'signMessage':
          log('[SANDBOX] Fake signing message');
          return {
            signature: createFakeSignature(),
            publicKey: createFakePublicKey(PSEUDO_SOLANA_ADDRESS),
          };

        case 'signAndSendTransaction':
          log('[SANDBOX] Fake sign and send (returning fake tx hash)');
          // Return a fake transaction signature (base58, 88 chars)
          const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
          let fakeTxSig = '';
          for (let i = 0; i < 88; i++) {
            fakeTxSig += chars[Math.floor(Math.random() * chars.length)];
          }
          return { signature: fakeTxSig };

        default:
          throw new Error(`[Pseudo Sandbox] Unknown method: ${method}`);
      }
    }

    // Handle Ethereum method calls in sandbox mode
    function handleEthereumSandbox(method: string, _params: unknown[]): any {
      log(`[SANDBOX] Handling ${method}`);

      // Return fake tx hash for all signing operations
      const fakeTxHash = '0x' + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      return fakeTxHash;
    }

    // Methods that require interception
    const SENSITIVE_ETH_METHODS = new Set([
      'eth_sendTransaction',
      'eth_signTransaction',
      'eth_sign',
      'personal_sign',
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4',
    ]);

    const SENSITIVE_SOLANA_METHODS = new Set([
      'connect',  // Intercept connect to block auto-popup phishing
      'signTransaction',
      'signAllTransactions',
      'signMessage',
      'signAndSendTransaction',
    ]);

    // Track which specific method+provider combos we've wrapped
    const wrappedMethods = new WeakMap<object, Set<string>>();

    function getWrappedSet(provider: object): Set<string> {
      if (!wrappedMethods.has(provider)) {
        wrappedMethods.set(provider, new Set());
      }
      return wrappedMethods.get(provider)!;
    }

    function wrapSolanaProvider(provider: any) {
      if (!provider) return;

      const wrapped = getWrappedSet(provider);

      SENSITIVE_SOLANA_METHODS.forEach((method) => {
        if (wrapped.has(method)) return;
        if (typeof provider[method] !== 'function') return;

        const original = provider[method].bind(provider);
        log(`Wrapping Solana.${method}`);

        provider[method] = async (...args: unknown[]) => {
          log(`Intercepted: ${method}`);

          try {
            const result = await showOverlayAndWait({ chain: 'solana', method, params: args });

            if (result.usePseudo) {
              // Use sandbox wallet - return fake but realistic responses
              const response = handleSolanaSandbox(method, args);

              // After sandbox connect, set up fake publicKey on provider
              if (method === 'connect') {
                const fakePublicKey = response.publicKey;

                try {
                  Object.defineProperty(provider, 'publicKey', {
                    value: fakePublicKey,
                    writable: true,
                    configurable: true,
                  });
                  Object.defineProperty(provider, 'isConnected', {
                    value: true,
                    writable: true,
                    configurable: true,
                  });
                  log('[SANDBOX] Set provider.publicKey and isConnected');
                } catch (e) {
                  log('[SANDBOX] Could not set publicKey on provider');
                }

                // Emit connect event - many dApps listen for this
                try {
                  if (typeof provider.emit === 'function') {
                    provider.emit('connect', fakePublicKey);
                    log('[SANDBOX] Emitted connect event');
                  }
                  if (typeof provider.on === 'function' && provider._events?.connect) {
                    // Try to trigger registered listeners
                    log('[SANDBOX] Provider has event listeners');
                  }
                } catch (e) {
                  log('[SANDBOX] Could not emit connect event');
                }

                // Dispatch a custom event on window that some dApps listen for
                try {
                  window.dispatchEvent(new CustomEvent('wallet-connected', {
                    detail: { publicKey: fakePublicKey }
                  }));
                } catch (e) {}
              }

              return response;
            }

            log(`Forwarding to real wallet: ${method}`);
            return await original(...args);
          } catch (e) {
            log(`Error in ${method}:`, e);
            throw e;
          }
        };

        wrapped.add(method);
      });

      if (wrapped.size > 0) {
        log(`Solana provider wrapped (${wrapped.size} methods)`);
      }
    }

    function wrapEthereumProvider(provider: any) {
      if (!provider) return;
      if (typeof provider.request !== 'function') return;

      const wrapped = getWrappedSet(provider);
      if (wrapped.has('request')) return;

      const original = provider.request.bind(provider);
      log('Wrapping Ethereum.request');

      provider.request = async (args: { method: string; params?: unknown[] }) => {
        // Only intercept sensitive methods
        if (!SENSITIVE_ETH_METHODS.has(args.method)) {
          return original(args);
        }

        log(`Intercepted: ${args.method}`);

        try {
          const result = await showOverlayAndWait({ chain: 'ethereum', method: args.method, params: args.params });

          if (result.usePseudo) {
            // Use sandbox wallet
            return handleEthereumSandbox(args.method, args.params || []);
          }

          log(`Forwarding to real wallet: ${args.method}`);
          return await original(args);
        } catch (e) {
          log(`Error in ${args.method}:`, e);
          throw e;
        }
      };

      wrapped.add('request');
      log('Ethereum provider wrapped');
    }

    function tryWrapProviders() {
      const win = window as any;

      // Wrap window.solana
      if (win.solana) {
        wrapSolanaProvider(win.solana);
      }

      // Wrap phantom.solana (might be different object)
      if (win.phantom?.solana && win.phantom.solana !== win.solana) {
        wrapSolanaProvider(win.phantom.solana);
      }

      // Wrap window.ethereum
      if (win.ethereum) {
        wrapEthereumProvider(win.ethereum);
      }

      // Wrap phantom.ethereum
      if (win.phantom?.ethereum && win.phantom.ethereum !== win.ethereum) {
        wrapEthereumProvider(win.phantom.ethereum);
      }
    }

    // Poll aggressively at start to beat phishing sites
    // Then less frequently to catch late-loading providers
    [0, 10, 25, 50, 100, 150, 200, 300, 500, 1000, 2000].forEach((delay) => {
      setTimeout(tryWrapProviders, delay);
    });

    // Also try immediately on various DOM events
    document.addEventListener('DOMContentLoaded', tryWrapProviders);
    document.addEventListener('readystatechange', tryWrapProviders);

    log('Wallet interceptor initialized');
  },
});
