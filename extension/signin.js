// Signing a channel tab back in. Some websites sign Chrome out now and then;
// a channel link then lands on their sign-in page instead of the video. If
// the Tohyee TV app has a saved sign-in for that website, the extension fills
// in the sign-in page, presses its button and goes back to the channel.
//
// Each website here has its sign-in on its own page (another web address),
// which also needs the extension's permission: arming a tab on the website
// asks for both.
(function (root) {
  const SITES = [{
    site: 'https://www.skygo.co.nz', name: 'Sky Go', page: 'https://login.sky.co.nz',
    email: 'input[name="email"]', password: 'input[name="password"]', submit: 'button[type="submit"]',
    error: '.auth0-global-message, .auth0-lock-error-msg'
  }];
  const forSite = site => SITES.find(s => s.site === site) ?? null;
  function forPage(url) {
    try { const origin = new URL(url).origin; return SITES.find(s => s.page === origin) ?? null; } catch { return null; }
  }

  // Runs inside the sign-in page. Waits for the form (it's drawn by a script),
  // types the details the way a person would (so the page notices them), then
  // presses the button. Returns {ok} or {ok: false, error}.
  async function fillSignIn(email, password, fields) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const visible = el => el && el.offsetParent !== null;
    let emailBox, passwordBox, button;
    for (let i = 0; i < 40; i++) {
      emailBox = document.querySelector(fields.email);
      passwordBox = document.querySelector(fields.password);
      button = document.querySelector(fields.submit);
      if (visible(emailBox) && visible(passwordBox) && visible(button)) break;
      await sleep(250);
    }
    if (!visible(emailBox) || !visible(passwordBox) || !visible(button)) return {ok: false, error: 'the sign-in form didn’t appear (the page may have changed)'};
    if (document.querySelector('iframe[src*="captcha"], .g-recaptcha, .h-captcha, [class*="captcha"]')) return {ok: false, error: 'the page asks for a robot check'};
    const type = (box, value) => {
      box.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, value);
      box.dispatchEvent(new Event('input', {bubbles: true}));
      box.dispatchEvent(new Event('change', {bubbles: true}));
      box.dispatchEvent(new Event('blur', {bubbles: true}));
    };
    type(emailBox, email);
    type(passwordBox, password);
    await sleep(300);
    button.click();
    return {ok: true};
  }

  // Runs inside the sign-in page: the message it shows, if any.
  function signInMessage(selector) {
    const el = document.querySelector(selector);
    return el && el.offsetParent !== null ? el.innerText.trim().slice(0, 200) : '';
  }

  root.TohyeeSignIn = {SITES, forSite, forPage, fillSignIn, signInMessage};
})(globalThis);
