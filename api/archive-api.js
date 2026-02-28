export const config = {
  runtime: 'edge', // Run on Vercel's global edge network for lowest latency
};

export default async function handler(req) {
  const url = new URL(req.url);
  
  // Destructure the Supabase URL from Vercel's environment variables
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: Missing environment variables' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Construct target URL to your Supabase Edge Function
  const targetUrl = new URL(`${supabaseUrl}/functions/v1/archive-api${url.search}`);
  
  // Clone request headers so we can modify them safely
  const headers = new Headers(req.headers);
  headers.delete('host'); // Let fetch set the correct host for Supabase
  
  // Replicate the Vite proxy behavior: if no authorization header exists (i.e. not admin), inject the public Anon Key
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${anonKey}`);
  }

  try {
    // Forward the request to Supabase
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: headers,
      // Only include body if it's a POST/PUT/PATCH (e.g. file uploads, login)
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await req.blob() : undefined,
    });
    
    // Copy the response headers back to the client
    const responseHeaders = new Headers(response.headers);

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
