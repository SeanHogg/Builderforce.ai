/**
 * THE SUBSCRIBE + VERSION-OFFER WIDGET — the only UI a `site_user` gets for paying
 * the person who built the app they are on, and for being told a new version exists.
 *
 * ── WHY THIS IS A STATIC SCRIPT AND NOT A REACT COMPONENT ────────────────────────
 * `siteBilling.ts`'s own header states the rule this module answers to: the
 * consumer is a `site_user`, resolved from a cookie scoped to the SITE's own
 * origin — a custom domain or a platform subdomain, never `builderforce.ai`. A
 * component rendered by this repo's own Next app cannot read that cookie or post
 * to that origin; nothing served from anywhere else can. The published app itself
 * is arbitrary bytes a creator's WebContainer build emitted (`publishStaticSite`
 * takes `dist/` verbatim) — Builderforce controls none of its markup, so there is
 * nowhere to inject a mounted component even if one could run there.
 *
 * The ONE document this platform does still render for every paid app is the shop
 * window (`siteLandingPage.ts` / `renderWebsiteDocument`), and it is already
 * framework-free for the identical reason. This widget follows the same shape —
 * ES5-style vanilla JS, no build step, self-contained — and is served at a
 * reserved, cacheable path so the landing document only ever needs a `<script
 * src>` pointed at it, never a re-render per visitor.
 *
 * ── WHY IT DOES NOT NEED PRICE OR SLUG BAKED IN AT PUBLISH TIME ──────────────────
 * The alternative was templating this script per-publish, which would have meant
 * `siteLandingPage.ts` (owned by site delivery) reaching into the marketplace to
 * resolve a listing every time a creator changes a hero image. Instead the script
 * asks for itself, at load, from `GET /__api/billing/listing` — a public read of
 * exactly what a shop window already shows a stranger. One fewer cross-domain
 * coupling, and the SAME bytes serve every paid app on the platform.
 */

/** Reserved path, analogous to `SITE_LANDING_KEY` — `handleSiteBilling` answers it
 *  publicly, ahead of the sign-in gate every other `/__api/billing/*` action sits
 *  behind. */
export const SITE_COMMERCE_WIDGET_PATH = '/__api/billing/widget.js';

/**
 * The widget's JS source. A plain constant, not a template — nothing here varies
 * per site or per request, which is exactly why it can be served once and cached
 * hard (see `commerceWidgetResponse`).
 */
export const COMMERCE_WIDGET_JS = `
(function(){
"use strict";
var API="/__api/";
function api(path,opts){
  opts=opts||{};
  var init={method:opts.method||"GET",credentials:"same-origin"};
  if(opts.body){init.headers={"content-type":"application/json"};init.body=JSON.stringify(opts.body);}
  return fetch(API+path,init).then(function(res){
    return res.json().catch(function(){return {};}).then(function(body){
      return {ok:res.ok,status:res.status,body:body};
    });
  });
}
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function money(cents,currency){
  try{return new Intl.NumberFormat(undefined,{style:"currency",currency:currency||"USD"}).format((cents||0)/100);}
  catch(e){return ((cents||0)/100).toFixed(2)+" "+(currency||"USD");}
}
function withApp(href){
  var u=new URL(href,location.href);
  u.searchParams.set("app","1");
  return u.toString();
}
function stripQuery(names){
  var u=new URL(location.href);
  var changed=false;
  names.forEach(function(n){ if(u.searchParams.has(n)){u.searchParams.delete(n);changed=true;} });
  if(changed) history.replaceState(null,"",u.toString());
}

var root=document.createElement("div");
root.setAttribute("data-bf-commerce","");
root.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:min(340px,calc(100vw - 32px))";
var style=document.createElement("style");
style.textContent=
  "[data-bf-commerce]{--bf-bg:#fff;--bf-fg:#0a0a0a;--bf-muted:#666;--bf-accent:#1d4ed8;--bf-onaccent:#fff;--bf-line:#e5e5e5;"+
  "font:14px/1.5 ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif}"+
  "@media(prefers-color-scheme:dark){[data-bf-commerce]{--bf-bg:#1a1a1a;--bf-fg:#fafafa;--bf-muted:#a3a3a3;--bf-accent:#7aa2ff;--bf-onaccent:#0a0a0a;--bf-line:#2e2e2e}}"+
  "[data-bf-commerce] .p{background:var(--bf-bg);color:var(--bf-fg);border:1px solid var(--bf-line);border-radius:12px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.18)}"+
  "[data-bf-commerce] p{margin:0 0 10px}"+
  "[data-bf-commerce] .muted{color:var(--bf-muted);font-size:12px}"+
  "[data-bf-commerce] input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bf-line);border-radius:7px;background:transparent;color:inherit;margin-bottom:8px;font:inherit}"+
  "[data-bf-commerce] button{font:inherit;font-weight:650;border:0;border-radius:7px;padding:9px 14px;cursor:pointer;margin:0 8px 0 0}"+
  "[data-bf-commerce] .primary{background:var(--bf-accent);color:var(--bf-onaccent)}"+
  "[data-bf-commerce] .ghost{background:transparent;color:var(--bf-fg);text-decoration:underline;padding:9px 2px}"+
  "[data-bf-commerce] .err{color:#dc2626;font-size:12px}"+
  "[data-bf-commerce] :focus-visible{outline:2px solid var(--bf-accent);outline-offset:2px}";
document.head.appendChild(style);

function paint(html){
  root.innerHTML='<div class="p" role="status">'+html+"</div>";
  if(!root.isConnected) document.body.appendChild(root);
}
function unmount(){ if(root.isConnected) root.remove(); }
function err(msg){
  var e=root.querySelector("[data-error]");
  if(e){ e.textContent=msg; e.hidden=!msg; }
}

function renderUpdate(listing){
  paint(
    "<p><strong>"+esc(listing.name)+"</strong> has a new version available.</p>"+
    '<div><button type="button" class="primary" data-update>Update now</button>'+
    '<button type="button" class="ghost" data-continue>Continue with current version</button></div>'+
    '<p class="err" data-error hidden></p>'
  );
  var updateBtn=root.querySelector("[data-update]");
  updateBtn.addEventListener("click",function(){
    updateBtn.disabled=true;
    api("billing/accept-update",{method:"POST"}).then(function(r){
      if(!r.ok){ updateBtn.disabled=false; err((r.body&&r.body.error)||"Could not apply the update."); return; }
      location.href=withApp(location.href);
    });
  });
  root.querySelector("[data-continue]").addEventListener("click",function(){
    location.href=withApp(location.href);
  });
}

function renderSubscribe(listing){
  paint(
    "<p><strong>Subscribe to "+esc(listing.name)+"</strong></p>"+
    '<p class="muted">'+esc(money(listing.priceCents,listing.currency))+" / month</p>"+
    '<div><button type="button" class="primary" data-start>Subscribe</button>'+
    '<button type="button" class="ghost" data-dismiss>Not now</button></div>'+
    '<p class="err" data-error hidden></p>'
  );
  root.querySelector("[data-start]").addEventListener("click",function(){ renderEmail(listing); });
  root.querySelector("[data-dismiss]").addEventListener("click",function(){
    try{ sessionStorage.setItem("bf-commerce-dismissed","1"); }catch(e){}
    unmount();
  });
}

function renderEmail(listing){
  paint(
    "<p><strong>Sign in to subscribe</strong></p>"+
    '<input type="email" placeholder="you@example.com" autocomplete="email" data-email>'+
    '<div><button type="button" class="primary" data-send>Send sign-in code</button>'+
    '<button type="button" class="ghost" data-dismiss>Cancel</button></div>'+
    '<p class="err" data-error hidden></p>'
  );
  root.querySelector("[data-send]").addEventListener("click",function(){
    var input=root.querySelector("[data-email]");
    var email=(input.value||"").trim();
    if(!email){ err("Enter your email address."); return; }
    var btn=root.querySelector("[data-send]"); btn.disabled=true;
    api("auth/request",{method:"POST",body:{email:email}}).then(function(){
      renderCode(listing,email);
    });
  });
  root.querySelector("[data-dismiss]").addEventListener("click",function(){ renderSubscribe(listing); });
}

function renderCode(listing,email){
  paint(
    "<p><strong>Enter the code sent to "+esc(email)+"</strong></p>"+
    '<input inputmode="numeric" maxlength="6" placeholder="123456" data-code>'+
    '<div><button type="button" class="primary" data-verify>Verify</button>'+
    '<button type="button" class="ghost" data-dismiss>Cancel</button></div>'+
    '<p class="err" data-error hidden></p>'
  );
  root.querySelector("[data-verify]").addEventListener("click",function(){
    var input=root.querySelector("[data-code]");
    var code=(input.value||"").trim();
    if(!/^\\d{6}$/.test(code)){ err("Enter the 6-digit code."); return; }
    var btn=root.querySelector("[data-verify]"); btn.disabled=true;
    api("auth/verify",{method:"POST",body:{email:email,code:code}}).then(function(r){
      if(!r.ok){ btn.disabled=false; err((r.body&&r.body.error)||"That code did not work."); return; }
      startCheckout(listing);
    });
  });
  root.querySelector("[data-dismiss]").addEventListener("click",function(){ renderSubscribe(listing); });
}

function startCheckout(listing){
  paint("<p>Starting checkout\\u2026</p>");
  api("billing/subscribe",{method:"POST",body:{slug:listing.slug}}).then(function(r){
    if(!r.ok || !r.body || !r.body.checkoutUrl){
      renderSubscribe(listing);
      err((r.body&&r.body.error)||"Could not start checkout.");
      return;
    }
    location.href=r.body.checkoutUrl;
  });
}

function finishReturnedCheckout(sessionId,after){
  paint("<p>Finishing up\\u2026</p>");
  api("billing/complete",{method:"POST",body:{checkoutSessionId:sessionId}}).then(function(r){
    stripQuery(["subscribed"]);
    if(r.ok){ location.href=withApp(location.href); return; }
    after();
  });
}

function boot(){
  var params=new URL(location.href).searchParams;
  var subscribed=params.get("subscribed");
  if(subscribed==="cancelled"){ stripQuery(["subscribed"]); }

  api("billing/listing").then(function(listingRes){
    var listing=listingRes.ok?listingRes.body.listing:null;
    if(!listing || !(listing.priceCents>0)){ return; }

    if(subscribed && subscribed!=="cancelled"){
      finishReturnedCheckout(subscribed,function(){ evaluate(listing); });
      return;
    }
    evaluate(listing);
  });

  function isDismissed(){
    try{ return sessionStorage.getItem("bf-commerce-dismissed")==="1"; }catch(e){ return false; }
  }

  function evaluate(listing){
    api("billing/me").then(function(meRes){
      if(!meRes.ok){
        if(!isDismissed()) renderSubscribe(listing);
        return;
      }
      var standing=meRes.body||{};
      if(standing.versionOffer && standing.versionOffer.updateAvailable){
        // Never dismissible for a session — "Continue with current version" IS the
        // dismiss action, and it still lets them into the app.
        renderUpdate(listing);
        return;
      }
      if(!standing.subscription && !isDismissed()){
        renderSubscribe(listing);
      }
      // A live, current subscriber has nothing this widget needs to say.
    });
  }
}

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot);
else boot();
})();
`;

/** Cacheable — this is the same public, non-personalised script for every paid
 *  app on the platform, so an intermediary caching it costs nobody a stale
 *  entitlement (unlike `forkedDocumentHeaders`, which must never be cached). */
export function commerceWidgetResponse(): Response {
  return new Response(COMMERCE_WIDGET_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
