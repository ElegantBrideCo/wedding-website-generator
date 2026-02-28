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
    const { action, email, password, token, formData, generatedHtml, storyCopy, siteId, siteUrl } = await context.request.json();
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = context.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: corsHeaders });
    }

    if (action === 'signup') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.error || data.msg) return new Response(JSON.stringify({ error: data.error_description || data.msg || 'Signup failed' }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify({ user: data.user, session: data }), { status: 200, headers: corsHeaders });
    }

    if (action === 'login') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.error || data.error_description) return new Response(JSON.stringify({ error: data.error_description || 'Login failed' }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify({ user: data.user, session: data }), { status: 200, headers: corsHeaders });
    }

    if (action === 'save') {
      // Verify token
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
      });
      const userData = await userRes.json();
      if (!userData.id) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });

      // Check for existing record
      const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/wedding_sites?user_id=eq.${userData.id}&select=id`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
      });
      const existing = await checkRes.json();

      const record = {
        user_id: userData.id,
        form_data: formData,
        generated_html: generatedHtml,
        story_copy: storyCopy,
        site_id: siteId,
        site_url: siteUrl,
        updated_at: new Date().toISOString(),
      };

      let saveRes;
      if (existing && existing.length > 0) {
        saveRes = await fetch(`${SUPABASE_URL}/rest/v1/wedding_sites?user_id=eq.${userData.id}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(record),
        });
      } else {
        saveRes = await fetch(`${SUPABASE_URL}/rest/v1/wedding_sites`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify(record),
        });
      }

      if (!saveRes.ok) {
        const errText = await saveRes.text();
        return new Response(JSON.stringify({ error: errText }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (action === 'load') {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
      });
      const userData = await userRes.json();
      if (!userData.id) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });

      const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/wedding_sites?user_id=eq.${userData.id}&select=*&limit=1`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
      });
      const rows = await dataRes.json();
      return new Response(JSON.stringify({ site: rows && rows.length > 0 ? rows[0] : null }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
