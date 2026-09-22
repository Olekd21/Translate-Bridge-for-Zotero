import {
  getOrCreatePairingToken,
  registerBridgeServer,
  unregisterBridgeServer,
} from "./modules/bridgeServer";
import { registerReadingUI } from "./modules/readingUI";

const windowCleanups = new Map<Window, () => void>();

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  getOrCreatePairingToken();
  registerBridgeServer();
  addon.api.getPairingToken = getOrCreatePairingToken;

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  windowCleanups.get(win)?.();
  windowCleanups.set(win, registerReadingUI(win));
}

async function onMainWindowUnload(win: Window): Promise<void> {
  windowCleanups.get(win)?.();
  windowCleanups.delete(win);
}

function onShutdown(): void {
  unregisterBridgeServer();
  windowCleanups.forEach((cleanup) => cleanup());
  windowCleanups.clear();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error Plugin instance is dynamically registered.
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify() {}
async function onPrefsEvent() {}
function onShortcuts() {}
function onDialogEvents() {}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
