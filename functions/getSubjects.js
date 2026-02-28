import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  try {
    const { data, error } = await supabase
      .from('papers')
      .select('subject')
      .order('subject', { ascending: true });

    if (error) {
      console.error('Error fetching subjects:', error);
      return res.status(500).json({ error: 'Failed to fetch subjects' });
    }

    // Extract unique subjects
    const subjects = [...new Set(data.map(item => item.subject))];

    res.status(200).json({ subjects });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}