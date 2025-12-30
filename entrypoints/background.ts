export default defineBackground(() => {
  console.log('Pseudo background service worker loaded');

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PSEUDO_RPC_REQUEST') {
      // Handle intercepted RPC requests
      console.log('Intercepted RPC:', message.payload);
      // TODO: Decode and analyze the request
      sendResponse({ received: true });
    }
    return true;
  });
});
