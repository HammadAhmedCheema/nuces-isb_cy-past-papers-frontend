import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get subject from query parameters
  const { subject } = req.query;

  if (!subject) {
    return res.status(400).json({ error: 'Subject parameter is required' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  try {
    const { data, error } = await supabase
      .from('papers')
      .select('*')
      .eq('subject', subject)
      .order('title', { ascending: true });

    if (error) {
      console.error('Error fetching papers:', error);
      return res.status(500).json({ error: 'Failed to fetch papers' });
    }

    res.status(200).json({ papers: data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}