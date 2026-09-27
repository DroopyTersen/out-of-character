// Static asset delivery does not honor byte ranges, which native media controls
// need for seeking. These short recordings are small enough to slice in memory.
export async function serveBriefingAudio(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return assets.fetch(request);
  const assetRequest = new Request(request.url, { headers: request.headers });
  assetRequest.headers.delete('Range');
  assetRequest.headers.delete('If-Range');
  const asset = await assets.fetch(assetRequest);
  if (asset.status !== 200) return asset;

  const bytes = await asset.arrayBuffer();
  const headers = new Headers(asset.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(bytes.byteLength));
  if (request.method === 'HEAD') return new Response(null, { headers });

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  const ifRange = request.headers.get('If-Range');
  // Ignore unsupported/multiple ranges and stale validators, returning the full file.
  if (!range || (!range[1] && !range[2]) || (ifRange && ifRange !== headers.get('ETag'))) return new Response(bytes, { headers });
  const start = range[1] ? Number(range[1]) : Math.max(0, bytes.byteLength - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (start > end || start >= bytes.byteLength) {
    headers.set('Content-Range', `bytes */${bytes.byteLength}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
