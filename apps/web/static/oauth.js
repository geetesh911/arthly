// SPDX-License-Identifier: AGPL-3.0-only
// Google sends its sign-in back here (src/lib/google.ts). In a popup, this hands the answer to the
// app through a BroadcastChannel and closes. After a full-page redirect, which the installed app
// uses, it keeps the answer in sessionStorage and goes back to the app.
const query = new URLSearchParams(location.search);
const result = { state: query.get('state'), code: query.get('code'), error: query.get('error') };

/** The sign-in this window started before going to Google, if it did. */
function started() {
  try {
    return JSON.parse(sessionStorage.getItem('arthly-google') ?? 'null');
  } catch {
    return null;
  }
}

const pending = started();

if (pending && pending.state === result.state) {
  sessionStorage.setItem('arthly-google-result', JSON.stringify(result));
  location.replace(pending.purpose === 'connect' ? './#/settings' : './');
} else {
  new BroadcastChannel('arthly-google').postMessage(result);
  document.getElementById('message').textContent = result.code
    ? 'Signed in. You can close this window and go back to Arthly.'
    : 'The Google sign-in didn’t finish. You can close this window.';
  window.close();
}
