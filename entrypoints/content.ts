// This runs in ISOLATED world - for communication with background script if needed
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',

  main() {
    // Listen for messages from the MAIN world script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'PSEUDO_TO_CONTENT') return;

      browser.runtime.sendMessage({
        type: 'PSEUDO_RPC_REQUEST',
        payload: event.data.payload,
      });
    });
  },
});
