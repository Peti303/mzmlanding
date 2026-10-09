// Látogatói jellemzők kinyerése a kérésből: bot-szűrés, eszköz, forrás (Facebook / Instagram / …).

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|meta-externalagent|whatsapp|telegram|curl|wget|python-requests|axios|node-fetch|go-http|java\/|httpclient|scrapy|phantom|puppeteer|playwright/i;

export function isBot(ua) {
  return !ua || BOT_RE.test(ua);
}

export function deviceType(ua, width) {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'mobile';
  if (Number.isFinite(width) && width > 0 && width < 640) return 'mobile';
  return 'desktop';
}

const SOURCE_ALIASES = {
  fb: 'facebook',
  facebook: 'facebook',
  meta: 'facebook',
  'facebook ads': 'facebook',
  ig: 'instagram',
  instagram: 'instagram',
  google: 'google',
  adwords: 'google',
  youtube: 'youtube',
  tiktok: 'tiktok',
};

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const clean = (s, max = 40) =>
  typeof s === 'string' ? s.replace(/[^\p{L}\p{N}_\-. +|]/gu, '').trim().slice(0, max) : '';

/**
 * @param {{search?:string, referrer?:string}} p kliens által küldött adatok
 * @param {string} ua User-Agent
 * @returns {{source:string, campaign:string}}
 */
export function classifySource({ search = '', referrer = '' }, ua = '') {
  let params;
  try {
    params = new URLSearchParams(String(search).slice(0, 600));
  } catch {
    params = new URLSearchParams();
  }
  const campaign = clean(params.get('utm_campaign') || '');
  const utm = clean(params.get('utm_source') || '', 30).toLowerCase();
  if (utm) return { source: SOURCE_ALIASES[utm] || 'other', campaign };

  const host = hostOf(referrer);
  if (/(^|\.)instagram\.com$/.test(host)) return { source: 'instagram', campaign };
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host))
    return { source: 'facebook', campaign };
  if (/(^|\.)google\./.test(host)) return { source: 'google', campaign };

  // Facebook/Instagram appon belüli böngésző
  if (/Instagram/i.test(ua)) return { source: 'instagram', campaign };
  if (/FBAN|FBAV|FB_IAB/i.test(ua) || params.has('fbclid')) return { source: 'facebook', campaign };

  if (!host) return { source: 'direct', campaign };
  return { source: 'other', campaign };
}

export { clean };
