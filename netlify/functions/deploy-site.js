// deploy-site.js — Netlify Function
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
  if (!NETLIFY_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { html, siteName, siteId: existingSiteId } = body;
  if (!html) return { statusCode: 400, body: JSON.stringify({ error: 'No content provided' }) };

  const cleanName = (siteName || 'our-wedding')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 55) || 'our-wedding';

  const headers = { 'Authorization': `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' };

  try {
    let siteId = existingSiteId;
    let siteUrl = '';

    // Create site if needed
    if (!siteId) {
      let nameToUse = cleanName;
      let createRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST', headers, body: JSON.stringify({ name: nameToUse })
      });
      if (!createRes.ok) {
        nameToUse = `${cleanName}-${Math.random().toString(36).substring(2, 6)}`;
        createRes = await fetch('https://api.netlify.com/api/v1/sites', {
          method: 'POST', headers, body: JSON.stringify({ name: nameToUse })
        });
      }
      if (!createRes.ok) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not create site' }) };
      }
      const site = await createRes.json();
      siteId = site.id;
      siteUrl = site.ssl_url || site.url || `https://${nameToUse}.netlify.app`;
    } else {
      const infoRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, { headers });
      if (infoRes.ok) { const info = await infoRes.json(); siteUrl = info.ssl_url || info.url; }
    }

    // Deploy using file digest API
    const htmlBuffer = Buffer.from(html, 'utf-8');
    const sha1 = crypto.createHash('sha1').update(htmlBuffer).digest('hex');

    const digestRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST', headers,
      body: JSON.stringify({ files: { '/index.html': sha1 }, async: false })
    });
    if (!digestRes.ok) {
      const e = await digestRes.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'Deploy init failed: ' + e }) };
    }
    const deployData = await digestRes.json();
    const deployId = deployData.id;

    // Upload file if Netlify needs it
    if (deployData.required && deployData.required.length > 0) {
      const uploadRes = await fetch(
        `https://api.netlify.com/api/v1/deploys/${deployId}/files/index.html`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
          body: htmlBuffer
        }
      );
      if (!uploadRes.ok) {
        const e = await uploadRes.text();
        return { statusCode: 500, body: JSON.stringify({ error: 'Upload failed: ' + e }) };
      }
    }

    // Poll for live status (max 30s)
    let liveUrl = siteUrl;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}`, { headers });
      if (statusRes.ok) {
        const s = await statusRes.json();
        if (s.state === 'ready' || s.state === 'current') {
          liveUrl = s.ssl_url || s.deploy_ssl_url || siteUrl;
          break;
        }
        if (s.state === 'error') return { statusCode: 500, body: JSON.stringify({ error: 'Deploy error on Netlify' }) };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ siteId, url: liveUrl, deployId })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
