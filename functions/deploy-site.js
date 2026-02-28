const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { html, siteName, projectName } = await request.json();
    const CF_API_TOKEN = context.env.CLOUDFLARE_API_TOKEN;
    const CF_ACCOUNT_ID = context.env.CLOUDFLARE_ACCOUNT_ID;

    if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
      return new Response(JSON.stringify({ error: 'Cloudflare credentials not configured' }), { status: 500, headers: corsHeaders });
    }

    let projName = (siteName || 'my-wedding')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 55);
    if (!projName) projName = 'my-wedding';

    let finalProjectName = projectName;

    if (!finalProjectName) {
      let attempt = projName;
      let created = false;
      for (let i = 0; i < 5; i++) {
        const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: attempt, production_branch: 'main' }),
        });
        const createData = await createRes.json();
        if (createData.success) {
          finalProjectName = attempt;
          created = true;
          break;
        } else if (createData.errors && createData.errors[0] && createData.errors[0].code === 8000006) {
          attempt = projName + '-' + Math.random().toString(36).substring(2, 6);
        } else {
          return new Response(JSON.stringify({ error: createData.errors?.[0]?.message || 'Failed to create project' }), { status: 500, headers: corsHeaders });
        }
      }
      if (!created) {
        return new Response(JSON.stringify({ error: 'Could not find an available project name' }), { status: 500, headers: corsHeaders });
      }
    }

    const uploadForm = new FormData();
    uploadForm.append('/index.html', new Blob([html], { type: 'text/html' }), 'index.html');

    const directRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${finalProjectName}/deployments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: uploadForm,
    });
    const directData = await directRes.json();

    if (!directData.success) {
      return new Response(JSON.stringify({ error: directData.errors?.[0]?.message || 'Deploy failed' }), { status: 500, headers: corsHeaders });
    }

    const url = `https://${finalProjectName}.pages.dev`;
    return new Response(JSON.stringify({ success: true, projectName: finalProjectName, url, deployId: directData.result?.id }), { status: 200, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
