// Replicates the Vimeo review-page auth flow to list folder contents.
// Prints only statuses and video metadata — never tokens or cookies.
// Usage: node pipeline/vimeo-review-probe.mjs <reviewUrl>
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const url = process.argv[2];
const m = url.match(/reviews\/([0-9a-f-]+)\/users\/(\d+)\/folders\/(\d+)/i);
if (!m) throw new Error("bad url");
const [, reviewId, userId, folderId] = m;

const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

// 1. Load the review page — establishes session cookies + gives us the xsrft token.
const pageRes = await fetch(url, { headers: { "User-Agent": UA } });
storeCookies(pageRes);
const html = await pageRes.text();
const nextData = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
const vb = nextData.props.pageProps.viewerBootstrap;
console.log("page:", pageRes.status, "| showPasswordPage:", nextData.props.pageProps.showPasswordPage, "| folder:", nextData.props.pageProps.folderData?.name);

// 2. Authenticate the review link (no password case: password omitted).
const authRes = await fetch(`https://vimeo.com/review_links/${reviewId}/auth`, {
  method: "POST",
  headers: {
    "User-Agent": UA,
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Cookie: cookieHeader(),
    Origin: "https://vimeo.com",
    Referer: url,
  },
  body: JSON.stringify({ token: vb.xsrft }),
});
storeCookies(authRes);
console.log("auth:", authRes.status, (await authRes.text()).slice(0, 200));

// 3. Fresh JWT under the authed session.
const jwtRes = await fetch("https://vimeo.com/_next/jwt", {
  headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Cookie: cookieHeader() },
});
const { token } = await jwtRes.json();
console.log("jwt:", jwtRes.status, token ? "(token acquired)" : "(NO TOKEN)");

// 4. Review link object — look for the videos connection URI.
const apiHeaders = { "User-Agent": UA, Authorization: `jwt ${token}` };
const rlRes = await fetch(
  `https://api.vimeo.com/folders/${folderId}/review_links/${reviewId}?review_id=${reviewId}&fields=uri,label,metadata`,
  { headers: apiHeaders },
);
const rlBody = await rlRes.text();
console.log("review_link object:", rlRes.status, rlBody.slice(0, 600));

// 5. Try listing videos a few plausible ways.
for (const candidate of [
  `https://api.vimeo.com/folders/${folderId}/review_links/${reviewId}/videos?review_id=${reviewId}&per_page=100&fields=uri,name,link,duration,review_page`,
  `https://api.vimeo.com/users/${userId}/projects/${folderId}/videos?review_id=${reviewId}&per_page=100&fields=uri,name,link,duration,review_page`,
]) {
  const r = await fetch(candidate, { headers: apiHeaders });
  const t = await r.text();
  console.log("videos try:", r.status, candidate.split("?")[0]);
  if (r.ok) {
    const j = JSON.parse(t);
    console.log("TOTAL:", j.total);
    for (const v of j.data ?? [])
      console.log(`  - ${v.name} | ${Math.round((v.duration ?? 0) / 60)}m | ${v.link} | review:${v.review_page?.link ?? "-"}`);
    break;
  } else {
    console.log("   ", t.slice(0, 150));
  }
}
