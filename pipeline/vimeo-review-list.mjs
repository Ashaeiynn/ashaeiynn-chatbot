// List videos inside Vimeo review-link folders (the links the user shared).
// Uses the folder items endpoint with review_id auth — discovered from Vimeo's frontend.
// Prints ONLY video metadata — never tokens.
// Usage: node pipeline/vimeo-review-list.mjs <reviewUrl> [...more] > data/vimeo-videos.json
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function getToken() {
  const r = await fetch("https://vimeo.com/_next/jwt", {
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" },
  });
  if (!r.ok) throw new Error(`jwt endpoint: HTTP ${r.status}`);
  const j = await r.json();
  return j.token || j.jwt;
}

function parseReviewUrl(url) {
  const m = url.match(/reviews\/([0-9a-f-]+)\/users\/(\d+)\/folders\/(\d+)/i);
  if (!m) throw new Error(`unrecognized review URL: ${url}`);
  return { reviewId: m[1], userId: m[2], folderId: m[3] };
}

const token = await getToken();
const all = [];

for (const url of process.argv.slice(2)) {
  const { reviewId, userId, folderId } = parseReviewUrl(url);
  let page = `https://api.vimeo.com/users/${userId}/projects/${folderId}/items?review_id=${reviewId}&per_page=100&fields=type,video.uri,video.name,video.link,video.duration`;
  const videos = [];
  while (page) {
    const r = await fetch(page, {
      headers: { "User-Agent": UA, Authorization: `jwt ${token}` },
    });
    const body = await r.json();
    if (!r.ok) {
      console.error(`folder ${folderId}: HTTP ${r.status} — ${JSON.stringify(body).slice(0, 200)}`);
      break;
    }
    for (const item of body.data ?? []) {
      if (item.type === "video" && item.video) videos.push(item.video);
    }
    page = body.paging?.next ? `https://api.vimeo.com${body.paging.next}` : null;
  }
  console.error(
    `folder ${folderId}: ${videos.length} video(s), ${Math.round(videos.reduce((a, v) => a + (v.duration ?? 0), 0) / 60)} minutes`,
  );
  for (const v of videos) {
    all.push({
      folderId,
      reviewId,
      userId,
      videoId: v.uri?.match(/\d+/)?.[0],
      name: v.name,
      minutes: Math.round((v.duration ?? 0) / 60),
      link: v.link,
    });
  }
}

console.error(
  `TOTAL: ${all.length} videos, ${all.reduce((a, v) => a + v.minutes, 0)} minutes (~${(all.reduce((a, v) => a + v.minutes, 0) / 60).toFixed(1)} hours)`,
);
console.log(JSON.stringify(all, null, 2));
