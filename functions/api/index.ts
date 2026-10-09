// itboy 工具箱 · Cloudflare Pages Functions
// 8 个 action：lunar / news60 / gold / weather / oil / translate / whois / ip
// 上游地址从环境变量 UPSTREAM 读取（CF 控制台配置）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ★ 从环境变量读上游，没配置就报错
  const UPSTREAM = env.UPSTREAM || '';
  if (!UPSTREAM) {
    return json({ code: 500, message: 'UPSTREAM 环境变量未配置' }, 500);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  try {
    let result: any;
    switch (action) {
      case 'lunar':     result = await proxyGet(UPSTREAM, '/v2/lunar'); break;
      case 'news60':    result = await proxyGet(UPSTREAM, '/v2/60s'); break;
      case 'gold':      result = await proxyGet(UPSTREAM, '/v2/gold-price'); break;
      case 'weather':   result = await handleWeather(UPSTREAM, url.searchParams.get('city') || '北京'); break;
      case 'oil':       result = await proxyGet(UPSTREAM, '/v2/fuel-price?region=' + encodeURIComponent(url.searchParams.get('region') || '北京')); break;
      case 'translate': result = await handleTranslate(UPSTREAM, url); break;
      case 'whois':     result = await proxyGet(UPSTREAM, '/v2/whois?domain=' + encodeURIComponent(url.searchParams.get('domain') || '')); break;
      case 'ip':        result = await handleIp(request); break;
      default:
        return json({ code: 400, message: 'unknown action' }, 400);
    }
    return json(result);
  } catch (e: any) {
    return json({ code: 500, message: e?.message || 'error' }, 500);
  }
};

// 通用 GET 代理（带 CF 边缘缓存 5 分钟）
async function proxyGet(upstream: string, path: string): Promise<any> {
  const r = await fetch(upstream + path, {
    headers: { 'User-Agent': 'Mozilla/5.0 itboy-tools' },
    cf: { cacheTtl: 300, cacheEverything: true } as any,
  });
  if (!r.ok) throw new Error('upstream HTTP ' + r.status);
  return await r.json();
}

// 天气：合并实时 + 3天预报
async function handleWeather(upstream: string, city: string): Promise<any> {
  const [now, forecast] = await Promise.all([
    proxyGet(upstream, '/v2/weather?query=' + encodeURIComponent(city)),
    proxyGet(upstream, '/v2/weather/forecast?query=' + encodeURIComponent(city) + '&days=3'),
  ]);
  return {
    code: 200,
    message: 'ok',
    now: now.data || now,
    forecast: forecast.data || forecast,
  };
}

// 翻译
async function handleTranslate(upstream: string, url: URL): Promise<any> {
  const text = url.searchParams.get('text') || '';
  const to = url.searchParams.get('to') || 'auto';
  const from = url.searchParams.get('from') || 'auto';
  return await proxyGet(
    upstream,
    '/v2/fanyi?text=' + encodeURIComponent(text) +
    '&from=' + encodeURIComponent(from) +
    '&to=' + encodeURIComponent(to)
  );
}

// IP：拿 CF 给的真实用户 IP，调 ip-api.com 查属地
async function handleIp(request: Request): Promise<any> {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return { code: 200, data: { ip: 'unknown', country: '查询失败' } };
  try {
    const r = await fetch(
      'http://ip-api.com/json/' + encodeURIComponent(ip) +
      '?lang=zh-CN&fields=status,country,regionName,city,isp,query',
      { cf: { cacheTtl: 1800, cacheEverything: true } as any }
    );
    const j: any = await r.json();
    if (j.status === 'success') {
      return {
        code: 200,
        data: {
          ip: j.query || ip,
          country: j.country || '',
          province: j.regionName || '',
          city: j.city || '',
          isp: j.isp || '',
        },
      };
    }
  } catch {}
  return { code: 200, data: { ip, country: '查询失败' } };
}

// 统一 JSON 响应
function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS,
    },
  });
}
