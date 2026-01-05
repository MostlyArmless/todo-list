# PWA Fix - Loose Ends

## Completed

1. **Service Worker Fetch Handler** (committed)
   - Added `fetch` event handler to `web/public/sw.js`
   - Uses network-first caching strategy for offline fallback
   - Required for browsers to consider PWA installable

2. **Websocket Accept-Before-Close** (committed)
   - Fixed `src/api/websocket.py` to accept connections before closing with error
   - This was causing test hangs and could cause client issues
   - Tests updated to use proper mocking

3. **Agent Environment Port Fix** (committed)
   - Fixed `scripts/agent-env.sh` sed patterns to match actual template ports
   - Agents now get unique ports instead of conflicting with agent-a

## Outstanding Issues

### 1. Cloudflare Access Bypass for PWA Assets

**Status:** Requires manual Cloudflare dashboard configuration

The manifest.json and other PWA assets are being blocked by Cloudflare Access, causing:
```
Access to manifest at '...cloudflareaccess.com/...' (redirected from 'https://thiemnet.ca/manifest.json')
has been blocked by CORS policy
```

**Solution:**
1. Go to Cloudflare Zero Trust dashboard
2. Create a new Self-hosted Application:
   - Name: "PWA Assets Bypass"
   - Domain: `thiemnet.ca`
   - Path: `/manifest.json` (create separate apps for each or use wildcards if supported)
3. Add a policy with Action: **Bypass** and Include: **Everyone**
4. **Important:** Ensure this app is ordered BEFORE your main protected app

Files that need bypass:
- `/manifest.json`
- `/sw.js`
- `/icon-192.png`
- `/icon-512.png`

### 2. Database Connection Pool Exhaustion

**Status:** Intermittent production issue

Observed error:
```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached, connection timed out
```

**Possible causes:**
- Connection leaks in long-running requests
- Too many concurrent connections
- WebSocket connections holding DB sessions

**Recommendations:**
- Monitor API logs for connection pool warnings
- Consider increasing pool size in `src/database.py`
- Audit code paths for proper `db.close()` calls
- Consider using async SQLAlchemy with connection pooling

### 3. Production Deployment

**Status:** Changes committed but not deployed

After configuring Cloudflare Access bypass, deploy the code changes:
```bash
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d pwa --force-recreate
docker compose restart api
```

### 4. Permissions-Policy Warnings

**Status:** Cosmetic/informational

The browser console shows warnings about unrecognized Permissions-Policy features:
- `attribution-reporting`
- `private-aggregation`
- `private-state-token-issuance`
- `browsing-topics`
- etc.

These are Cloudflare-injected headers for analytics and can be safely ignored. They don't affect functionality.
