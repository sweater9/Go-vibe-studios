# Keyless proxy (optional)

Some APIs block calls made straight from a browser (CORS). If the Create page says the browser blocked the call, deploy this tiny Cloudflare Worker and paste its URL into the "API key" window.

```
cd worker
npx wrangler deploy
```

Then set `ALLOWED_ORIGIN` in `wrangler.toml` to your site's address so only your site can use it.

What it does and does not do:
- Forwards only prediction create and poll requests to `api.replicate.com`, plus audio downloads from `replicate.delivery`.
- Passes the user's key through in memory. It does not store or log it, and the code has no logging.
- Costs nothing on Cloudflare's free tier for normal use.
