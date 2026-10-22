"use strict";
const extensionOrigin = "chrome-extension://idihkkiapagakajacljibnpekkfpiacm";
let started = false;
window.addEventListener("message", async (event) => {
  if (event.origin !== extensionOrigin || event.source !== parent || started
    || event.data?.type !== "timelens-auth-start" || typeof event.data.nonce !== "string") return;
  started = true;
  const reply = { type: "timelens-auth-result", nonce: event.data.nonce };
  try {
    const auth = firebase.auth();
    await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const { user } = await auth.signInWithPopup(provider);
    reply.auth = { uid: user.uid, email: user.email, idToken: await user.getIdToken(),
      refreshToken: user.refreshToken, expiresAt: Date.now() + 3500000 };
    parent.postMessage(reply, extensionOrigin);
    await auth.signOut();
  } catch (error) {
    reply.error = error.message;
    parent.postMessage(reply, extensionOrigin);
  }
});
parent.postMessage({ type: "timelens-auth-ready" }, extensionOrigin);
