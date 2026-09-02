# Hatume Security — Guard Monitor

Two screens in one app:

- `/dashboard` — admin overview (you). Requires login (Supabase Auth).
- `/clock?site=<site_id>` — tablet clock-in/out PIN pad. One per site, bookmarked to that site's URL.

## Setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in your Supabase anon key
   (found in Supabase Studio → Project Settings → API).
3. `npm run dev` to preview locally.

## Creating your admin login

In Supabase Studio → Authentication → Users → Add user, create your email/password.
That's the only account needed — the dashboard treats any signed-in user as admin.

## Setting up a tablet

1. Find the site's `id` in the `sites` table (Supabase Studio → Table Editor).
2. On the tablet's browser, open: `https://your-deployed-url/clock?site=THE_SITE_ID`
3. Bookmark it / set it as the browser's home page / pin the tab. No login needed —
   the PIN pad talks only to the `clock` Edge Function.

## Deploying

Push this repo to GitHub, then deploy free on Vercel (connect the repo, add the two
env vars from `.env.local`, deploy). Vercel's free tier covers this comfortably.
