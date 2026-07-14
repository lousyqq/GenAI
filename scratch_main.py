import os
import re

js_dir = r"C:\EQDashboard\EQDashboard\EQDashboard.V2.Web\wwwroot\js"

# 1. find all functions
functions_map = {}
files = []

for root, _, filenames in os.walk(js_dir):
    for f in filenames:
        if f.endswith('.js'):
            path = os.path.join(root, f)
            rel_path = os.path.relpath(path, js_dir).replace('\\\\', '/')
            files.append((path, rel_path))
            with open(path, 'r', encoding='utf-8') as file:
                content = file.read()
                matches = re.finditer(r'^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(', content, re.MULTILINE)
                for m in matches:
                    func_name = m.group(1)
                    functions_map[func_name] = rel_path

# 2. only process main.js
for path, rel_path in files:
    if rel_path != 'main.js':
        continue
    
    with open(path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    imports_needed = {}
    for func_name, source_file in functions_map.items():
        if source_file == rel_path:
            continue
        if re.search(r'\b' + func_name + r'\b', content):
            if source_file not in imports_needed:
                imports_needed[source_file] = set()
            imports_needed[source_file].add(func_name)
    
    import_block = ""
    for source_file, funcs in imports_needed.items():
        source_parts = source_file.split('/')
        target_parts = rel_path.split('/')
        i = 0
        while i < len(source_parts) - 1 and i < len(target_parts) - 1 and source_parts[i] == target_parts[i]:
            i += 1
        up_count = len(target_parts) - 1 - i
        if up_count == 0:
            rel_import = './' + '/'.join(source_parts[i:])
        else:
            rel_import = '../' * up_count + '/'.join(source_parts[i:])
        import_block += f"import {{ {', '.join(sorted(funcs))} }} from '{rel_import}?v=20260607d';\n"
    
    # We will just print the import block so we can manually replace it
    print("----- IMPORT BLOCK FOR main.js -----")
    print(import_block)
