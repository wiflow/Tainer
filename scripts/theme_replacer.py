import os
import glob

src_dir = '/Users/NISO/Downloads/TainerV2/src'

replacements = {
    'bg-zinc-900/50': 'bg-[#111113]',
    'border-zinc-800': 'border-white/5',
    'bg-zinc-900/30': 'bg-[#111113]',
    'border-zinc-700': 'border-white/10',
    'bg-zinc-950/70': 'bg-black/40',
    'bg-zinc-900/60': 'bg-[#111113]',
    'bg-zinc-950/50': 'bg-black/20',
    'bg-zinc-900/40': 'bg-[#111113]',
}

files = glob.glob(f'{src_dir}/**/*.tsx', recursive=True)

modified_files_count = 0

for file_path in files:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        original_content = content
        
        for old, new in replacements.items():
            content = content.replace(old, new)
            
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            modified_files_count += 1
            print(f"Updated {os.path.basename(file_path)}")
            
    except Exception as e:
        print(f"Error processing {file_path}: {e}")

print(f"\\nSuccessfully updated {modified_files_count} files.")
