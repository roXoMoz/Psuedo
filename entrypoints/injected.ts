import {
  getSolanaKeypair,
  handleSolanaMethod,
  SENSITIVE_SOLANA_METHODS,
} from '../lib/solana';

import {
  getEthereumKeypair,
  handleEthereumMethod,
  SENSITIVE_ETH_METHODS,
} from '../lib/ethereum';

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

    // ========== UI STYLES ==========
    const styles = `
      #pseudo-overlay {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        pointer-events: auto !important;
      }
      #pseudo-overlay * {
        pointer-events: auto !important;
      }
      #pseudo-card {
        background: rgba(10, 10, 10, 0.92) !important;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 16px !important;
        padding: 20px !important;
        width: 320px !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
        animation: pseudo-slide-in 0.25s ease-out;
        position: relative !important;
        overflow: hidden !important;
        pointer-events: auto !important;
      }
      .pseudo-bg-logo {
        position: absolute;
        left: -20px;
        top: -20px;
        width: 160px;
        height: 160px;
        opacity: 0.1;
        pointer-events: none;
        z-index: 0;
      }
      .pseudo-bg-logo svg {
        width: 100%;
        height: 100%;
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
        position: relative;
        z-index: 1;
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
        position: relative;
        z-index: 1;
      }
      .pseudo-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: rgba(255,255,255,0.03);
        border-radius: 10px;
        margin-bottom: 16px;
        position: relative;
        z-index: 1;
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
        background: #22c55e;
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
        position: relative;
        z-index: 1;
      }
      .pseudo-buttons {
        display: flex;
        gap: 10px;
        position: relative;
        z-index: 1;
      }
      .pseudo-btn {
        flex: 1;
        padding: 12px 16px;
        border: none !important;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer !important;
        transition: all 0.15s;
        pointer-events: auto !important;
        -webkit-appearance: none !important;
        appearance: none !important;
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

    // ========== UI FUNCTIONS ==========
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
          <div class="pseudo-bg-logo">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="197.08 117.56 477.37 446.67">
              <path fill="#ffffff" d="M397.321228,518.320435 C370.935760,546.549438 338.104095,560.020813 300.496429,563.127930 C275.755981,565.171997 251.163467,565.143311 227.474915,556.340515 C212.329147,550.712402 200.382278,541.600952 197.726242,524.396973 C195.586487,510.537292 198.695206,497.782349 208.315979,487.252563 C221.411331,472.919891 244.340897,475.681061 253.739319,492.615448 C256.969940,498.436462 259.926483,504.426575 262.704285,510.478943 C273.337555,533.646912 294.413452,535.989075 314.064301,528.341797 C327.345917,523.173157 335.607666,512.486206 342.196838,500.388885 C351.273926,483.723938 357.418365,465.879822 361.452057,447.462860 C371.146881,403.198608 380.356232,358.826477 389.526581,314.449310 C398.664185,270.230621 407.515961,225.952835 416.490295,181.700394 C416.755188,180.394272 416.978821,179.079819 417.239349,177.772751 C417.903564,174.440460 416.288025,173.417923 413.323578,174.112900 C409.108948,175.100998 404.867157,176.051056 400.753296,177.378098 C379.853394,184.120056 360.583496,193.466187 346.357849,211.087250 C335.596771,224.416840 330.517609,239.760223 328.976868,256.593414 C328.340454,263.546143 327.437592,270.519135 326.004486,277.346161 C321.204498,300.212646 308.630066,309.574463 285.459473,307.948364 C270.114258,306.871460 260.679688,298.087311 258.118073,282.963196 C255.545395,267.774139 259.811737,253.779724 265.879456,240.359055 C278.859100,211.650574 301.488129,192.169983 328.495697,177.311661 C360.194580,159.872391 394.643036,151.210419 430.146088,145.937210 C435.849365,145.090103 441.572662,143.573380 446.952698,141.499725 C465.761993,134.249939 484.428955,126.630447 503.139984,119.126518 C506.605103,117.736877 509.907318,116.357010 513.402710,119.308296 C516.692017,122.085541 515.436401,125.341713 514.831787,128.542114 C512.510132,140.831299 512.495239,140.555145 524.962219,141.093307 C554.634949,142.374146 584.244385,144.483322 612.519531,154.637238 C636.524963,163.257874 656.626709,176.787918 667.033508,201.302399 C675.526306,221.308060 675.947937,242.243713 672.192200,263.197876 C665.382385,301.191742 642.577209,328.051544 610.769775,347.972107 C578.263245,368.330475 542.113892,378.423370 504.544647,383.944733 C492.033569,385.783417 479.404907,386.896088 466.798615,387.974030 C462.182404,388.368744 460.655518,390.869598 459.589752,394.782532 C452.081360,422.349792 442.459717,449.121857 428.884003,474.345428 C420.323547,490.250580 410.425018,505.225739 397.321228,518.320435 M542.431335,326.941833 C556.706299,315.446869 567.661072,301.474823 574.767151,284.470367 C581.973022,267.227051 583.393433,249.196686 581.614807,230.971024 C579.488953,209.186066 569.370239,191.546371 549.365234,181.845154 C538.452942,176.553360 526.119751,174.042755 514.259644,170.913345 C507.717987,169.187241 506.728699,170.264221 505.413849,176.750717 C493.697174,234.552444 482.003967,292.358948 470.331787,350.169678 C469.095093,356.294739 469.717621,356.935669 476.052216,355.817047 C500.234528,351.546539 522.472534,342.728546 542.431335,326.941833z"/>
            </svg>
          </div>
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

    // ========== WALLET INITIALIZATION ==========
    const initSolana = getSolanaKeypair(log);
    const initEthereum = getEthereumKeypair(log);

    // ========== PROVIDER WRAPPING ==========
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
              const keypair = await initSolana;
              const response = await handleSolanaMethod(method, args, keypair, log);

              // After sandbox connect, set up publicKey on provider
              if (method === 'connect') {
                const pubKey = response.publicKey;

                try {
                  Object.defineProperty(provider, 'publicKey', {
                    value: pubKey,
                    writable: true,
                    configurable: true,
                  });
                  Object.defineProperty(provider, 'isConnected', {
                    value: true,
                    writable: true,
                    configurable: true,
                  });
                  log('[SOL] Set provider.publicKey:', pubKey.toString());
                } catch {
                  log('[SOL] Could not set publicKey on provider');
                }

                // Emit connect event
                try {
                  if (typeof provider.emit === 'function') {
                    provider.emit('connect', pubKey);
                    log('[SOL] Emitted connect event');
                  }
                } catch {
                  log('[SOL] Could not emit connect event');
                }
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
        if (!SENSITIVE_ETH_METHODS.has(args.method)) {
          return original(args);
        }

        log(`Intercepted: ${args.method}`);

        try {
          const result = await showOverlayAndWait({ chain: 'ethereum', method: args.method, params: args.params });

          if (result.usePseudo) {
            const keypair = await initEthereum;
            return handleEthereumMethod(args.method, args.params || [], keypair, log);
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

      if (win.solana) {
        wrapSolanaProvider(win.solana);
      }

      if (win.phantom?.solana && win.phantom.solana !== win.solana) {
        wrapSolanaProvider(win.phantom.solana);
      }

      if (win.ethereum) {
        wrapEthereumProvider(win.ethereum);
      }

      if (win.phantom?.ethereum && win.phantom.ethereum !== win.ethereum) {
        wrapEthereumProvider(win.phantom.ethereum);
      }
    }

    // ========== INITIALIZATION ==========
    // Poll aggressively at start
    [0, 10, 25, 50, 100, 150, 200, 300, 500, 1000, 2000, 3000, 5000].forEach((delay) => {
      setTimeout(tryWrapProviders, delay);
    });

    document.addEventListener('DOMContentLoaded', tryWrapProviders);
    document.addEventListener('readystatechange', tryWrapProviders);

    // MetaMask initialization event
    window.addEventListener('ethereum#initialized', tryWrapProviders);

    // EIP-6963 provider announcements
    window.addEventListener('eip6963:announceProvider', (event: any) => {
      log('EIP-6963 provider announced:', event.detail?.info?.name);
      if (event.detail?.provider) {
        wrapEthereumProvider(event.detail.provider);
      }
    });

    window.dispatchEvent(new Event('eip6963:requestProvider'));

    log('Wallet interceptor initialized');
  },
});
