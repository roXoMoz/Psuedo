const toggle = document.getElementById('enabled') as HTMLInputElement;
const status = document.getElementById('status') as HTMLParagraphElement;

async function init() {
  const { enabled = false } = await browser.storage.local.get('enabled');
  toggle.checked = enabled;
  updateStatus(enabled);
}

function updateStatus(enabled: boolean) {
  status.textContent = enabled ? 'Active - Intercepting requests' : 'Disabled';
}

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  await browser.storage.local.set({ enabled });
  updateStatus(enabled);
});

init();
