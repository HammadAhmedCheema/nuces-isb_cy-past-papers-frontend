import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@4.15.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const ALLOWED_SUBJECTS = [
  "Applied Physics", "Artificial Intelligence", "Artificial Intelligence - Lab",
  "Calculus and Analytical Geometry", "Civics and Community Engagement",
  "Computer Networks", "Computer Networks - Lab",
  "Computer Organization and Assembly Language", "Computer Organization and Assembly Language - Lab",
  "Critical Thinking", "Cyber Security", "Data Structures", "Data Structures - Lab",
  "Database Systems", "Database Systems - Lab", "Design and Analysis of Algorithms",
  "Digital Forensics", "Digital Forensics - Lab", "Digital Logic Design", "Digital Logic Design - Lab",
  "Discrete Structures", "Entrepreneurship", "Expository Writing", "Expository Writing - Lab",
  "Functional English", "Functional English - Lab", "Fundamentals of Malware Analysis",
  "Fundamentals of Software Engineering", "Ideology and Constitution of Pakistan",
  "Information Assurance", "Information Security",
  "Introduction to Information and Communication Technology", "Islamic Studies/Ethics",
  "Linear Algebra", "Multivariable Calculus", "Network Security", "Network Security - Lab",
  "Object Oriented Programming", "Object Oriented Programming - Lab",
  "Operating Systems", "Operating Systems - Lab", "Parallel and Distributed Computing",
  "Probability and Statistics", "Professional Practices in IT",
  "Programming Fundamentals", "Programming Fundamentals - Lab",
  "Secure Software Design", "Secure Software Design - Lab",
  "Technical and Business Writing", "Understanding Holy Quran",
  "Understanding Sirat-Un-Nabi (PBUH)", "Web Programming"
];
const ALLOWED_THEORY_TYPES = ['Sessional-1', 'Sessional-2', 'Finals'];
const ALLOWED_LAB_TYPES = ['Sessional', 'Finals'];
const ALLOWED_SESSIONS = ['Fall', 'Spring', 'Summer'];
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// Rate limiting config
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MINUTES = 15;

const JWT_SECRET = new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'fallback');

async function verifyAdminAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload.role === 'administrator';
  } catch { return false; }
}



/** IP-based login rate limiting using the login_attempts table */
async function checkAndRecordLoginAttempt(
  supabase: ReturnType<typeof createClient>,
  ip: string,
  success: boolean
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  // Count recent failed attempts from this IP
  const { count } = await supabase
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('attempted_at', windowStart);

  const attempts = count ?? 0;

  if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  // Record this attempt (only record failures to avoid bloating table)
  if (!success) {
    await supabase.from('login_attempts').insert([{ ip_address: ip }]);
    // Clean up old records while we're here
    await supabase.from('login_attempts').delete().lt('attempted_at', windowStart);
  } else {
    // On success, clear this IP's history so legitimate users don't get locked out
    await supabase.from('login_attempts').delete().eq('ip_address', ip);
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS - attempts - (success ? 0 : 1) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('x-real-ip') || 'unknown';

    // ----------------------------------------------------------------
    // PUBLIC ROUTES
    // ----------------------------------------------------------------

    if (action === 'list' && req.method === 'GET') {
      const { data, error } = await supabase.from('papers').select('*');
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    if (action === 'download' && req.method === 'GET') {
      const path = url.searchParams.get('path');
      if (!path) throw new Error('Missing path');
      const { data, error } = await supabase.storage.from('pdfs').download(path);
      if (error) throw error;
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, status: 200
      });
    }

    if (action === 'login' && req.method === 'POST') {
      // 1. Check rate limit BEFORE attempting authentication
      const preCheck = await checkAndRecordLoginAttempt(supabase, clientIp, false);
      if (!preCheck.allowed) {
        return new Response(JSON.stringify({
          error: `Too many login attempts. Please wait ${RATE_LIMIT_WINDOW_MINUTES} minutes before trying again.`
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 });
      }

      const { username, password } = await req.json();
      if (!username || !password) throw new Error('Missing credentials');
      if (username.length > 100 || password.length > 256) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
        });
      }

      const { data, error } = await supabase.rpc('verify_admin', {
        p_username: username, p_password: password
      });
      if (error) throw error;

      if (data === true) {
        // Clear rate limit on success
        await checkAndRecordLoginAttempt(supabase, clientIp, true);
        const jwt = await new jose.SignJWT({ role: 'administrator', username })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('24h')
          .sign(JWT_SECRET);
        return new Response(JSON.stringify({ token: jwt, message: 'Login successful' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
        });
      } else {
        // Already recorded failure above, just return 401
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
        });
      }
    }

    if (action === 'upload' && req.method === 'POST') {
      const formData = await req.formData();
      const file = formData.get('file');
      const subject = String(formData.get('subject'));
      const examType = String(formData.get('examType'));
      const session = String(formData.get('session'));
      const year = parseInt(String(formData.get('year')));

      if (!file || !subject || !examType || !session || isNaN(year)) {
        throw new Error('Missing required fields');
      }
      if (!(file instanceof File)) throw new Error('Invalid file payload.');

      // MIME type check (browser declaration)
      if (file.type !== 'application/pdf' && file.type !== 'application/x-pdf') {
        return new Response(JSON.stringify({ error: 'Only PDF files are accepted.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return new Response(JSON.stringify({ error: 'File exceeds 100MB limit.' }), {
          status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }



      if (!ALLOWED_SUBJECTS.includes(subject)) {
        return new Response(JSON.stringify({ error: 'Invalid subject.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (!ALLOWED_SESSIONS.includes(session)) {
        return new Response(JSON.stringify({ error: 'Invalid session.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const isLab = subject.toLowerCase().includes('lab');
      const validTypes = isLab ? ALLOWED_LAB_TYPES : ALLOWED_THEORY_TYPES;
      if (!validTypes.includes(examType)) {
        return new Response(JSON.stringify({ error: 'Invalid exam type.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const cleanSubject = subject.replace(/[^a-zA-Z0-9\s-]/g, '');
      const name = `${examType}_${cleanSubject}_${session}_${year}.pdf`.toLowerCase();
      const targetPath = `${subject}/${examType}/${name}`.toLowerCase();

      const [{ data: existingLive }, { data: existingQueue }] = await Promise.all([
        supabase.from('papers').select('id').eq('path', targetPath).single(),
        supabase.from('queued_papers').select('id').eq('path', targetPath).single(),
      ]);
      if (existingLive || existingQueue) {
        return new Response(JSON.stringify({ error: 'This file already exists or is pending review.' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const arrayBuffer = await file.arrayBuffer();
      const { error: storageError } = await supabase.storage
        .from('pdfs_queue')
        .upload(targetPath, arrayBuffer, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' });
      if (storageError) {
        if (storageError.statusCode === '409') {
          return new Response(JSON.stringify({ error: 'Already pending review.' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        throw storageError;
      }

      const { error: dbError } = await supabase.from('queued_papers').insert([{
        name, subject, exam_type: examType, session, year, path: targetPath
      }]);
      if (dbError) {
        await supabase.storage.from('pdfs_queue').remove([targetPath]);
        throw dbError;
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Submitted for review. An admin will approve your upload shortly.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ----------------------------------------------------------------
    // ADMIN-ONLY ROUTES
    // ----------------------------------------------------------------
    const isAuth = await verifyAdminAuth(req);
    if (!isAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403
      });
    }

    if (action === 'list_queue' && req.method === 'GET') {
      const { data, error } = await supabase.from('queued_papers').select('*').order('submitted_at', { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    if (action === 'download_queue' && req.method === 'GET') {
      const path = url.searchParams.get('path');
      if (!path) throw new Error('Missing path');
      const { data, error } = await supabase.storage.from('pdfs_queue').download(path);
      if (error) throw error;
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, status: 200
      });
    }

    if (action === 'approve' && req.method === 'POST') {
      const { path } = await req.json();
      if (!path) throw new Error('Missing path');

      const { data: queueRecord, error: fetchError } = await supabase
        .from('queued_papers').select('*').eq('path', path).single();
      if (fetchError || !queueRecord) throw new Error('Queued record not found');

      const { data: fileBlob, error: downloadError } = await supabase.storage.from('pdfs_queue').download(path);
      if (downloadError) throw downloadError;

      const arrayBuffer = await fileBlob.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('pdfs').upload(path, arrayBuffer, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('papers').insert([{
        name: queueRecord.name, subject: queueRecord.subject, exam_type: queueRecord.exam_type,
        session: queueRecord.session, year: queueRecord.year, path: queueRecord.path,
      }]);
      if (insertError) {
        await supabase.storage.from('pdfs').remove([path]);
        throw insertError;
      }

      await supabase.from('queued_papers').delete().eq('path', path);
      await supabase.storage.from('pdfs_queue').remove([path]);

      return new Response(JSON.stringify({ success: true, message: 'Paper approved.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    if (action === 'reject' && req.method === 'DELETE') {
      const path = url.searchParams.get('path');
      if (!path) throw new Error('Missing path');
      await supabase.from('queued_papers').delete().eq('path', path);
      await supabase.storage.from('pdfs_queue').remove([path]);
      return new Response(JSON.stringify({ success: true, message: 'Paper rejected.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    if (action === 'delete' && req.method === 'DELETE') {
      const path = url.searchParams.get('path');
      if (!path) throw new Error('Missing path');
      await supabase.from('papers').delete().eq('path', path);
      await supabase.storage.from('pdfs').remove([path]);
      return new Response(JSON.stringify({ success: true, message: 'Deleted.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      });
    }

    if (action === 'update_password' && req.method === 'POST') {
      const { username, current_password, new_password } = await req.json();
      if (!username || !current_password || !new_password) throw new Error('Missing parameters');
      if (new_password.length < 8) {
        return new Response(JSON.stringify({ error: 'New password must be at least 8 characters.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
      }
      const { data, error } = await supabase.rpc('update_admin_password', {
        p_username: username, p_old_password: current_password, p_new_password: new_password
      });
      if (error) throw error;
      if (data === true) {
        return new Response(JSON.stringify({ success: true, message: 'Password updated.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
        });
      } else {
        throw new Error('Incorrect current password.');
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    // Return sanitized error — never expose raw stack traces
    const safeMessage = error?.message?.length < 200 ? error.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: safeMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
    });
  }
});