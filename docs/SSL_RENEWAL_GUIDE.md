# SSL Certificate Renewal Guide for `app.lutin.org`

> **Note:** Because the certificate for `app.lutin.org` was generated using a manual DNS challenge on Network Solutions, **it will not auto-renew**. You must perform this manual renewal process every **90 days**.

---

## Quick Reference Summary

| Parameter | Value |
| --- | --- |
| **Domain** | `app.lutin.org` |
| **DNS Provider** | Network Solutions (Advanced DNS) |
| **Reverse Proxy** | Nginx Proxy Manager (NPM) |
| **Local Service** | `http://192.168.86.66:3005` |
| **Renewal Method** | Manual Certbot DNS-01 Challenge |

---

## Step-by-Step Renewal Instructions

### Step 1: Run Certbot Challenge on macOS Terminal

Open your Mac's **Terminal** and run:

```bash
sudo certbot certonly --manual --preferred-challenges dns -d app.lutin.org
```

Certbot will pause and prompt you to deploy a TXT record similar to:

```text
Please deploy a DNS TXT record under the name:
_acme-challenge.app.lutin.org
with the following value:
<NEW_RANDOM_HASH_STRING_HERE>
```

**IMPORTANT:** Do **not** press Enter in the terminal yet. Keep this window open.

---

### Step 2: Update DNS TXT Record in Network Solutions

1. Log in to your **Network Solutions** account.
2. Navigate to **Domain Name Management** → **Advanced DNS**.
3. Locate the `TXT` record for `_acme-challenge.app` (or add a new one if missing):
   - **Host Name:** `_acme-challenge.app`
   - **Type:** `TXT`
   - **Value:** Paste the new hash string provided by Certbot.
4. Click **Save / Commit Changes**.
5. Wait **2–3 minutes** for DNS propagation.
6. Optionally verify:

   ```bash
   dig TXT _acme-challenge.app.lutin.org +short
   ```

7. Return to your Mac Terminal and press **Enter**.

---

### Step 3: Export Renewed Certificates to Desktop

When Certbot displays `Successfully received certificate`, copy the updated files and relax permissions for upload:

```bash
# Copy certificate and private key to Desktop
sudo cp /etc/letsencrypt/live/app.lutin.org/fullchain.pem ~/Desktop/
sudo cp /etc/letsencrypt/live/app.lutin.org/privkey.pem ~/Desktop/

# Set read permissions so the browser can upload them
sudo chmod 644 ~/Desktop/fullchain.pem ~/Desktop/privkey.pem
```

Delete these Desktop copies after NPM upload (Step 6). Treat `privkey.pem` as a secret.

---

### Step 4: Upload New Certificate to Nginx Proxy Manager

1. Open the **Nginx Proxy Manager** UI (e.g. `http://192.168.86.66:81`).
2. Go to **SSL Certificates** → **Add Custom Certificate**.
3. Fill in:
   - **Name:** `app.lutin.org (Renewed YYYY-MM)`
   - **Certificate Key:** `privkey.pem` from Desktop
   - **Certificate:** `fullchain.pem` from Desktop
   - **Intermediate Certificate:** leave blank
4. Click **Save**.

---

### Step 5: Assign Certificate to Proxy Host

1. In NPM, go to **Hosts** → **Proxy Hosts**.
2. Click **⋮** next to `app.lutin.org` → **Edit**.
3. On the **SSL** tab:
   - **SSL Certificate:** select the newly uploaded certificate
   - Enable **Force SSL** and **HTTP/2 Support**
4. Click **Save**.

---

### Step 6: Cleanup and Verification

1. Delete the temporary files from the Desktop:

   ```bash
   rm ~/Desktop/fullchain.pem ~/Desktop/privkey.pem
   ```

2. Open `https://app.lutin.org` in a fresh browser tab.
3. Confirm the padlock shows a valid cert with a new expiration (~90 days out).

From a Mac you can also verify:

```bash
echo | openssl s_client -connect app.lutin.org:443 -servername app.lutin.org 2>/dev/null \
  | openssl x509 -noout -dates
```

---

## Troubleshooting Checklist

- [ ] **Certbot fails DNS check:** Confirm the TXT record with `dig TXT _acme-challenge.app.lutin.org +short` or [DNSChecker.org](https://dnschecker.org/). Wait longer for Network Solutions propagation before pressing Enter.
- [ ] **NPM upload fails ("Internal Error"):** Ensure you ran `chmod 644` on both `.pem` files before uploading.
- [ ] **Chrome "connection is not private":** Usually means the proxy host is still using the old expired cert — re-check Step 5 assignment, then hard-refresh.
- [ ] **Spotify OAuth errors:** Redirect URI in the Spotify Developer Dashboard must match exactly: `https://app.lutin.org/api/auth/spotify/callback`.
- [ ] **Google OAuth errors:** Authorized redirect URIs must include `https://app.lutin.org/api/auth/google/callback` (and Nest PCM callback if used).
