const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost(context) {
  try {
    const { html, siteName, projectName } = await context.request.json();
    const CF_API_TOKEN = context.env.CLOUDFLARE_API_TOKEN;
    const CF_ACCOUNT_ID = context.env.CLOUDFLARE_ACCOUNT_ID;

    if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
      return new Response(JSON.stringify({ error: 'Cloudflare credentials not configured' }), { status: 500, headers: corsHeaders });
    }

    // Sanitize project name
    let projName = (siteName || 'my-wedding')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 55);
    if (!projName) projName = 'my-wedding';

    // Use provided projectName (for updates) or try to create new
    let finalProjectName = projectName;

    if (!finalProjectName) {
      // Try to create the project
      let attempt = projName;
      let created = false;
      for (let i = 0; i < 5; i++) {
        const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: attempt,
            production_branch: 'main',
          }),
        });
        const createData = await createRes.json();
        if (createData.success) {
          finalProjectName = attempt;
          created = true;
          break;
        } else if (createData.errors && createData.errors[0] && createData.errors[0].code === 8000006) {
          // Name taken, try with suffix
          attempt = projName + '-' + Math.random().toString(36).substring(2, 6);
        } else {
          return new Response(JSON.stringify({ error: createData.errors?.[0]?.message || 'Failed to create project' }), { status: 500, headers: corsHeaders });
        }
      }
      if (!created) {
        return new Response(JSON.stringify({ error: 'Could not find an available project name' }), { status: 500, headers: corsHeaders });
      }
    }

    // Create a deployment using direct upload
    const formData = new FormData();
    const manifest = { '/index.html': await sha256(html) };
    formData.append('manifest', JSON.stringify(manifest));

    const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${finalProjectName}/deployments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: formData,
    });
    const deployData = await deployRes.json();

    if (!deployData.success) {
      // If we need to upload files
      if (deployData.errors?.[0]?.code === 8000037 || deployData.result?.file_upload_required) {
        const deployId = deployData.result?.id;
        if (deployId) {
          // Upload the HTML file
          const uploadForm = new FormData();
          uploadForm.append('/index.html', new Blob([html], { type: 'text/html' }), 'index.html');
          await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${finalProjectName}/deployments/${deployId}/files`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
            body: uploadForm,
          });
        }
      }
    }

    // Use simpler direct upload API
    const uploadForm = new FormData();
    uploadForm.append('/index.html', new Blob([html], { type: 'text/html' }), 'index.html');

    const directRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${finalProjectName}/deployments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: uploadForm,
    });
    const directData = await directRes.json();

    const url = `https://${finalProjectName}.pages.dev`;
    return new Response(JSON.stringify({
      success: true,
      projectName: finalProjectName,
      url,
      deployId: directData.result?.id,
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
