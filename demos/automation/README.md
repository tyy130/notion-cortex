# AI Lead Follow-Up Automation — Demo

## What It Does

When a new lead fills out a contact form, this workflow:
1. **Receives the lead data** via webhook (name, email, business, interest)
2. **Calls Claude AI** to write a personalized follow-up email based on their specific interest
3. **Sends the email** automatically via Gmail
4. **Returns confirmation** with the generated email preview

Zero human involvement. Fires in under 5 seconds.

## Live Demo

**Webhook URL:** `https://[your-instance].app.n8n.cloud/webhook/lead-followup`

**Test payload:**
```json
{
  "name": "Mike Chen",
  "email": "mike@example.com",
  "business": "Riverside Dental",
  "interest": "AI receptionist to handle appointment booking calls"
}
```

**What comes back:**
```json
{
  "success": true,
  "message": "Follow-up email sent to mike@example.com",
  "preview": "Hi Mike, thanks for reaching out about automating your appointment booking..."
}
```

## Workflow Nodes

| Node | Type | Purpose |
|------|------|---------|
| New Lead Webhook | Trigger | Receives form data via POST |
| Generate Personalized Email | HTTP Request | Calls Claude API to write email |
| Format Email Data | Set | Extracts and structures the output |
| Send Follow-Up Email | Gmail | Delivers the email to the lead |
| Respond to Webhook | Response | Returns confirmation + preview |

## How to Import

1. In n8n → **New Workflow** → click ⋮ menu → **Import from file**
2. Select `workflow.json`
3. Connect your Gmail account under **Credentials**
4. Add your Anthropic API key as an HTTP header credential
5. **Activate** the workflow — it's live

## Customization Per Client

- Swap the system prompt to match their voice and services
- Replace Gmail with any email provider (Outlook, SendGrid, Mailchimp)
- Add a CRM step (HubSpot, Pipedrive, Airtable) to log the lead
- Add a Slack notification so the owner knows instantly

## Technical Details

- **Platform:** n8n Cloud
- **AI:** Claude Haiku (claude-haiku-4-5-20251001) via Anthropic API
- **Trigger:** Webhook (POST)
- **Email:** Gmail OAuth2
- **Avg execution time:** 3-5 seconds
