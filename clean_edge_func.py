import json

with open('/home/shifu/.gemini/antigravity/brain/33ed40d1-a26d-4a60-9941-bd113df5e538/.system_generated/steps/154/output.txt', 'r') as f:
    data = json.load(f)

# The data is an object
content = data['files'][0]['content']

# Find and replace the definition
start_def = content.find('/** Check PDF magic bytes: first 4 bytes must be %PDF (0x25 0x50 0x44 0x46) */')
if start_def != -1:
    end_def = content.find('}', start_def)
    end_def = content.find('}', content.find('}', end_def + 1) + 1) + 1
    
    definition = content[start_def:end_def]
    content = content.replace(definition, '')

# Find and replace the usage
usage_snippet = """      // Magic byte validation \u2014 verify actual file signature is %PDF
      const validPdf = await isPdfMagicBytes(file);
      if (!validPdf) {
        return new Response(JSON.stringify({ error: 'File is not a valid PDF document.' }), {
          status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }"""
content = content.replace(usage_snippet, '')

with open('clean_index.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS")
