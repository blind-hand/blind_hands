"""Download and verify all 33 anonymized Blind Hands review copies (Python 3.9+, stdlib only).

Run: python download_archive.py --base-url URL_OF_ANONYMOUS_PROJECT_PAGE
Files are written to ./blind-hands-recordings; matching existing files are skipped.
"""
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import urljoin
import hashlib, json, time

BASE = None
DEST = Path('blind-hands-recordings')

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def download_collection(base=BASE,destination=DEST):
    destination=Path(destination)
    destination.mkdir(parents=True,exist_ok=True)
    index_request=Request(urljoin(base,'archive/manifest.json'),headers={'User-Agent':'BlindHandsArchiveDownloader/1.0'})
    with urlopen(index_request,timeout=60) as response:
        manifest=json.load(response)
    for i,item in enumerate(manifest['originals'],1):
        filename=item['original_filename']
        if Path(filename).name!=filename or '/' in filename or '\\' in filename:
            raise ValueError('Unsafe filename in manifest')
        target=destination/filename
        if target.exists() and digest(target)==item['sha256']:
            print(f'[{i}/{len(manifest["originals"])}] Verified, skipping {filename}')
            continue
        if target.exists():
            raise FileExistsError(f'Existing file has a different checksum: {target}. Move it before retrying.')
        partial=target.with_suffix('.mp4.part')
        for attempt in range(3):
            try:
                request=Request(urljoin(base,item['original_url']),headers={'User-Agent':'BlindHandsArchiveDownloader/1.0'})
                with urlopen(request,timeout=120) as response, partial.open('wb') as f:
                    while True:
                        chunk=response.read(1024*1024)
                        if not chunk:break
                        f.write(chunk)
                if partial.stat().st_size!=item['bytes'] or digest(partial)!=item['sha256']:
                    raise ValueError(f'Incomplete transfer or checksum mismatch: {filename}')
                partial.rename(target)
                print(f'[{i}/{len(manifest["originals"])}] Downloaded and verified {filename}')
                break
            except Exception:
                if attempt==2:raise
                time.sleep(2)
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print('All anonymous review copies downloaded and verified.')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',required=True,help='Anonymous project-page URL, ending with /')
    args=parser.parse_args()
    if not args.base_url.startswith(('https://','http://')):parser.error('Use a complete project-page URL.')
    download_collection(base=args.base_url.rstrip('/')+'/')
