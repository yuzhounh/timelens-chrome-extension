"use strict";
const origin = `https://${self.TimeLensFirebase.authDomain}`;
const nonce = new URL(location.href).searchParams.get("nonce");
const frame = document.createElement("iframe");
frame.src = `${origin}/extension-auth.html`;
window.addEventListener("message", (event) => {
  if (event.origin !== origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === "timelens-auth-ready") {
    frame.contentWindow.postMessage({ type: "timelens-auth-start", nonce }, origin);
  } else if (event.data?.type === "timelens-auth-result" && event.data.nonce === nonce) {
    void chrome.runtime.sendMessage({ ...event.data, type: "cloud-auth-result" });
  }
});
document.body.append(frame);
// Keep the waiting worker alive while a person completes Google's sign-in UI.
setInterval(() => { void chrome.runtime.sendMessage({ type: "cloud-auth-ping" }); }, 20000);
