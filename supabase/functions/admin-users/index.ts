import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigin = 'https://alexandrosh93.github.io';
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Vary': 'Origin',
});
const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, origin);
  if (origin && origin !== allowedOrigin) return reply({ error: 'Origin not allowed.' }, 403, origin);

  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authorization = req.headers.get('Authorization') || '';
    if (!url || !anonKey || !serviceKey || !authorization.startsWith('Bearer ')) {
      return reply({ error: 'Authentication is required.' }, 401, origin);
    }

    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData.user;
    if (callerError || !caller) return reply({ error: 'Your session has expired. Sign in again.' }, 401, origin);
    if (caller.app_metadata?.role !== 'admin') return reply({ error: 'Administrator access is required.' }, 403, origin);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 40);

    if (action === 'list') {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      return reply({ users: data.users.map((user) => ({
        id: user.id,
        email: user.email || '',
        username: clean(user.user_metadata?.username, 100) || (user.email || '').split('@')[0],
        full_name: clean(user.user_metadata?.full_name, 200),
        role: user.app_metadata?.role === 'admin' ? 'admin' : 'user',
        created_at: user.created_at,
      })) }, 200, origin);
    }

    if (action === 'create') {
      const username = clean(body.username, 100);
      const fullName = clean(body.full_name, 200);
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!username || !fullName || !/^[a-zA-Z0-9._@-]+$/.test(username)) return reply({ error: 'Enter a valid username and full name.' }, 400, origin);
      if (password.length < 6) return reply({ error: 'Password must be at least 6 characters.' }, 400, origin);
      const email = username.includes('@') ? username.toLowerCase() : username.toLowerCase() + '@avps.local';
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username, full_name: fullName },
        app_metadata: { role },
      });
      if (error) throw error;
      return reply({ user_id: data.user.id }, 200, origin);
    }

    if (action === 'update') {
      const userId = clean(body.user_id, 80);
      const username = clean(body.username, 100);
      const fullName = clean(body.full_name, 200);
      const email = clean(body.email, 320).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!userId || !username || !fullName || !email) return reply({ error: 'Username, full name and email are required.' }, 400, origin);
      if (password && password.length < 6) return reply({ error: 'Password must be at least 6 characters.' }, 400, origin);
      if (userId === caller.id && role !== 'admin') return reply({ error: 'You cannot remove your own administrator access.' }, 400, origin);
      const attributes: Record<string, unknown> = {
        email, email_confirm: true,
        user_metadata: { username, full_name: fullName },
        app_metadata: { role },
      };
      if (password) attributes.password = password;
      const { error } = await admin.auth.admin.updateUserById(userId, attributes);
      if (error) throw error;
      return reply({ ok: true }, 200, origin);
    }

    if (action === 'delete') {
      const userId = clean(body.user_id, 80);
      if (!userId) return reply({ error: 'User ID is required.' }, 400, origin);
      if (userId === caller.id) return reply({ error: 'You cannot delete your own account.' }, 400, origin);
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (error) throw error;
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: 'Unknown user-management action.' }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'User management failed.';
    return reply({ error: message }, 400, origin);
  }
});
