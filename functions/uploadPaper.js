import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  try {
    // Parse form data
    const form = new formidable.IncomingForm();
    
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Error parsing form:', err);
        return res.status(500).json({ error: 'Error parsing form data' });
      }

      const subject = fields.subject?.[0];
      const title = fields.title?.[0];
      const year = fields.year?.[0];
      const file = files.file?.[0];

      if (!subject || !title || !year || !file) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate file type
      const allowedTypes = ['application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
      }

      // Read file content
      const fileBuffer = fs.readFileSync(file.path);

      // Clean subject for filename
      const cleanSubject = subject.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${cleanSubject}_${title}_${year}.pdf`;
      
      // Upload file to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('past-papers')
        .upload(fileName, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading file:', uploadError);
        return res.status(500).json({ error: 'Failed to upload file' });
      }

      // Insert record into database
      const { data: insertData, error: insertError } = await supabase
        .from('papers')
        .insert([{
          subject: subject,
          title: title,
          year: parseInt(year),
          file_url: uploadData.path
        }]);

      if (insertError) {
        console.error('Error inserting record:', insertError);
        
        // Clean up: delete uploaded file if DB insertion fails
        const { error: deleteError } = await supabase
          .storage
          .from('past-papers')
          .remove([fileName]);
          
        if (deleteError) {
          console.error('Error deleting file after DB failure:', deleteError);
        }
        
        return res.status(500).json({ error: 'Failed to save paper information' });
      }

      res.status(200).json({ success: true, message: 'Paper uploaded successfully' });
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Config to disable body parsing for file uploads
export const config = {
  api: {
    bodyParser: false
  }
};