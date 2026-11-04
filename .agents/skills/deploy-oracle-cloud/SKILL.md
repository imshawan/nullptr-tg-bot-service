---
name: deploy-oracle-cloud
description: >-
  Use this skill when deploying, configuring firewalls, managing systemd services, or
  troubleshooting Oracle Cloud network connectivity for nullptr (NullPointer Bot).
---

# Deploying nullptr (NullPointer Bot) on Oracle Cloud

This runbook covers setting up, securing, and maintaining **nullptr (NullPointer Bot)** and an Ollama instance on an Oracle Cloud Compute VM.

---

## ☁️ 1. Ollama Configuration on Oracle Cloud

By default, Ollama binds only to `127.0.0.1`. If nullptr runs on a different machine or communicates over the public/VCN IP:

1. Create/edit the systemd override:
   ```bash
   sudo systemctl edit ollama.service
   ```
2. Insert:
   ```ini
   [Service]
   Environment="OLLAMA_HOST=0.0.0.0:11434"
   ```
3. Reload & restart:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```
4. Verify it is listening on all interfaces:
   ```bash
   ss -tulpn | grep 11434
   ```

---

## 🔒 2. Oracle Cloud Networking & Firewalls

### A. Oracle Cloud VCN Security List (Cloud Level)
1. Go to Oracle Cloud Console > **Networking** > **Virtual Cloud Networks**.
2. Select your VCN and click **Security Lists**.
3. Under **Ingress Rules**, click **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0` (or the IP of your bot host)
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `11434`

### B. Ubuntu OS Firewall (Host Level)
Oracle Cloud Ubuntu images run an aggressive default `iptables` table that blocks incoming ports even if allowed in the VCN:

```bash
# Allow incoming port 11434
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 11434 -j ACCEPT

# Persist iptables rules across reboots
sudo netfilter-persistent save
```

---

## 🚀 3. Deploying nullptr with systemd

1. Build the production bundle:
   ```bash
   npm run build
   ```
2. Copy the service unit:
   ```bash
   sudo cp nullptr-tg-bot.service /etc/systemd/system/
   ```
3. Reload systemd, enable, and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now nullptr-tg-bot
   ```
4. View live logs:
   ```bash
   journalctl -u nullptr-tg-bot -f
   ```

---

## 🩺 4. Diagnostic Commands

If nullptr reports connection errors:
```bash
# Test local Ollama endpoint
curl http://localhost:11434/api/tags

# Test from bot server to Oracle Cloud VM
curl http://<ORACLE_CLOUD_IP>:11434/api/tags
```
If `curl` hangs or times out, the issue is always either the **Oracle VCN Ingress Rule** or the **Ubuntu host `iptables` rule**.
