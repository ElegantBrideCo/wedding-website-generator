// auth.js — Handles signup, login, and session management via Supabase
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { action, email, password } = body;
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ user: data.user, session: data.session }) };
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ user: data.user, session: data.session }) };
    }

    if (action === 'save') {
      const { token, formData, generatedHtml, storyCopy, siteId, siteUrl } = body;
      const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Not authenticated' }) };

      const { data: existing } = await supabase
        .from('wedding_sites')
        .select('id')
        .eq('user_id', user.id)
        .single();

      const record = {
        user_id: user.id,
        form_data: formData,
        generated_html: generatedHtml,
        story_copy: storyCopy,
        site_id: siteId,
        site_url: siteUrl,
        updated_at: new Date().toISOString()
      };

      let result;
      if (existing) {
        result = await supabase.from('wedding_sites').update(record).eq('user_id', user.id);
      } else {
        result = await supabase.from('wedding_sites').insert(record);
      }

      if (result.error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: result.error.message }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    }

    if (action === 'load') {
      const { token } = body;
      const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Not authenticated' }) };

      const { data, error } = await supabase
        .from('wedding_sites')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ site: data || null }) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
