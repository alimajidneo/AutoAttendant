# Supabase database trust certificate

Public CA certificate, not a private key. Downloaded over HTTPS from the URL used by Supabase's own dashboard:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json (`ssl:certificate_url`).

SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
Valid until 2031-04-26. Review provider certificate rotation before expiry. The application trusts this CA only for Supabase database hosts, alongside standard system roots, and keeps certificate and hostname verification enabled.
