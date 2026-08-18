/**
 * The Android back button.
 *
 * Capacitor 8's `BridgeActivity` does not handle it at all — there is no
 * `onBackPressed` in the class — so the default Activity behaviour applies and
 * back **finishes the Activity**. In an app that is twelve routes behind one
 * WebView, that means back closes the whole thing from the Analytics screen
 * instead of returning to the Dashboard. Nobody expects that, and it only
 * shows up on a device, which is why it is written down here.
 *
 * Installing `@capacitor/app` is most of the fix: its plugin registers an
 * AndroidX `OnBackPressedCallback`, and with no JavaScript listener attached
 * it calls `webView.goBack()` itself. But only when there *is* somewhere to go
 * back to — at the first history entry the callback still consumes the press
 * and does nothing, so the app becomes impossible to leave with the back
 * button. This listener is what completes it: navigate while history has
 * somewhere to go, exit at the first entry, which is what the button means on
 * a home screen anyway.
 *
 * Reached only from `platform/native.ts` on a Capacitor host, so
 * `@capacitor/app` stays out of the web bundle exactly like the file saver.
 *
 * **Predictive back is not a problem here, though it looks like one.** The
 * plugin goes through `getOnBackPressedDispatcher()`, and AndroidX registers
 * that dispatcher with the system's `OnBackInvokedCallback` when predictive
 * back is active — so this fires on both paths, and targeting SDK 36 does not
 * quietly bypass it. What an enabled callback does cost is the predictive
 * *animation*, which needs the progress APIs to survive. That is a Phase 8
 * question, not a correctness one.
 *
 * What this deliberately does not do is close an open dialog first. Back
 * currently navigates the page underneath a dialog that stays open. Fixing it
 * needs the dialogs to own a history entry each, which is a Phase 8 job.
 */
import {App} from '@capacitor/app';

/** Returns a function that removes the listener; nothing in the app calls it. */
export async function installAndroidBackButton(): Promise<() => void> {
  const handle = await App.addListener('backButton', ({canGoBack}) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });

  return () => {
    void handle.remove();
  };
}
